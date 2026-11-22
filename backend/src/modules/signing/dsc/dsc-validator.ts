import { Inject, Injectable } from '@nestjs/common';
import forge from 'node-forge';
import { APP_CONFIG, type AppConfig } from '../../../platform/config/config.js';
import { parseCms, sha256Hex, verifyCms } from '../pdfsig/cms-read.js';
import {
  coveredBytes,
  findSignatures,
  onlyAddsSignature,
} from '../pdfsig/signatures.js';
import { readToken } from '../seal/timestamp.js';
import {
  CertificateRevoked,
  RevocationUnavailable,
  checkOcsp,
} from './ocsp.js';
import { loadCertificates } from './trust.js';

export type DscRejection =
  | 'not-an-extension'
  | 'bad-structure'
  | 'no-signature'
  | 'weak-algorithm'
  | 'digest'
  | 'signature'
  | 'no-timestamp'
  | 'timestamp-invalid'
  | 'timestamp-untrusted'
  | 'certificate-dates'
  | 'certificate-use'
  | 'chain'
  | 'revoked';

/** The signed file cannot be accepted. The message is safe to show to the person signing. */
export class DscRejected extends Error {
  constructor(
    readonly code: DscRejection,
    message: string,
  ) {
    super(message);
  }
}
export { RevocationUnavailable };

export interface DscResult {
  signer: {
    commonName: string;
    organisation: string | null;
    serialHex: string;
    notBefore: Date;
    notAfter: Date;
    issuer: string;
  };
  signedAt: Date;
  /** The certificate was outside its dates and the development switch let it through (D-38). */
  test: boolean;
  warnings: string[];
}

/** Revocation is a separate piece so tests and a later cache can replace it. */
export abstract class RevocationChecker {
  abstract check(
    cert: forge.pki.Certificate,
    issuer: forge.pki.Certificate,
    at: Date,
  ): Promise<void>;
}
@Injectable()
export class OcspRevocationChecker extends RevocationChecker {
  async check(
    cert: forge.pki.Certificate,
    issuer: forge.pki.Certificate,
  ): Promise<void> {
    await checkOcsp(cert, issuer);
  }
}

const field = (c: forge.pki.Certificate, f: 'CN' | 'O') =>
  (c.subject.getField(f) as { value?: string } | null)?.value ?? null;

/** Orders certificates leaf first by following issuers through a pool. */
const chainTo = (
  leaf: forge.pki.Certificate,
  pool: forge.pki.Certificate[],
) => {
  const chain = [leaf];
  for (let i = 0; i < 6; i++) {
    const top = chain[chain.length - 1]!;
    const parent = pool.find(
      (c) =>
        c !== top && top.isIssuer(c) && c.subject.hash !== top.subject.hash,
    );
    if (!parent) break;
    chain.push(parent);
  }
  return chain;
};

class ChainProblem extends Error {
  constructor(
    readonly kind: 'dates' | 'other',
    message: string,
  ) {
    super(message);
  }
}

const KNOWN_CRITICAL = [
  'keyUsage',
  'basicConstraints',
  'nameConstraints',
  'extKeyUsage',
];

/**
 * Checks a certificate chain against trusted roots at a given time. forge refuses critical
 * extended-key-usage extensions (every time-stamp certificate has one), so that is let through;
 * anything else it finds wrong is a failure. `relaxLeafDates` lets only the first certificate be
 * outside its dates (the development switch) and is called when it does.
 */
function verifyChain(
  roots: forge.pki.Certificate[],
  chain: forge.pki.Certificate[],
  at: Date,
  relaxLeafDates?: () => void,
): void {
  const E = (
    forge.pki as unknown as { certificateError: Record<string, string> }
  ).certificateError;
  let failedOnDates = false;
  try {
    forge.pki.verifyCertificateChain(forge.pki.createCaStore(roots), chain, {
      validityCheckDate: at,
      verify: (vfd: unknown, depth: number) => {
        if (vfd === true) return true;
        if (vfd === E.unsupported_certificate) {
          const extensions = (chain[depth]?.extensions ?? []) as {
            critical?: boolean;
            name?: string;
          }[];
          if (
            !extensions.some(
              (x) => x.critical && !KNOWN_CRITICAL.includes(x.name ?? ''),
            )
          )
            return true;
        }
        if (vfd === E.certificate_expired && depth === 0) {
          if (relaxLeafDates) {
            relaxLeafDates();
            return true;
          }
          failedOnDates = true;
        }
        return vfd as never;
      },
    } as never);
  } catch (e) {
    throw new ChainProblem(
      failedOnDates ? 'dates' : 'other',
      (e as { message?: string }).message ??
        'The certificate chain could not be verified',
    );
  }
}

/**
 * Accepts a PDF signed by the HR lead's certificate only if it extends the exact file we sent and
 * the signature holds up under the checks in D-48. Anything doubtful is refused; if only the
 * revocation answer is missing it throws RevocationUnavailable so the upload can be held and retried.
 */
@Injectable()
export class DscValidator {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly revocation: RevocationChecker,
  ) {}

  private get allowExpired() {
    return (
      this.config.ALLOW_EXPIRED_SIGNER_CERT &&
      this.config.NODE_ENV !== 'production'
    );
  }

  async validate(input: { sent: Buffer; signed: Buffer }): Promise<DscResult> {
    const { sent, signed } = input;
    const warnings: string[] = [];
    // 1. It must be our file with something added on the end, never a rewritten file.
    if (
      signed.length <= sent.length ||
      !signed.subarray(0, sent.length).equals(sent)
    )
      throw new DscRejected(
        'not-an-extension',
        'The signed file is not the document that was sent for signing.',
      );
    const added = findSignatures(signed).filter(
      (s) => s.coveredEnd > sent.length,
    );
    if (added.length !== 1 || added[0]!.coveredEnd !== signed.length)
      throw new DscRejected(
        'no-signature',
        'The file must carry exactly one new signature covering the whole file.',
      );
    const sig = added[0]!;
    const structure = onlyAddsSignature(signed.subarray(sent.length));
    if (!structure.ok)
      throw new DscRejected(
        'bad-structure',
        `The signed file changed the document: ${structure.reason}.`,
      );

    // 2. The signature itself.
    let parsed;
    try {
      parsed = parseCms(sig.contents);
    } catch {
      throw new DscRejected(
        'no-signature',
        'The signature in the file could not be read.',
      );
    }
    const check = verifyCms(parsed, coveredBytes(signed, sig));
    if (check.weakAlgorithm)
      throw new DscRejected(
        'weak-algorithm',
        'The signature uses a hash that is not accepted (use SHA-256 or stronger).',
      );
    if (!check.digestOk)
      throw new DscRejected(
        'digest',
        'The signature does not match the file contents.',
      );
    if (!check.signatureOk || !check.signer)
      throw new DscRejected('signature', 'The signature is not valid.');
    const leaf = check.signer;

    // 3. A time-stamp from a trusted time-stamp authority fixes when it was signed.
    if (!parsed.timestampToken)
      throw new DscRejected(
        'no-timestamp',
        'The signature has no CA time-stamp.',
      );
    const signedAt = this.checkTimestamp(
      parsed.timestampToken,
      parsed.signature,
    );

    // 4. The certificate: its use, its dates at signing time, and a chain to a trusted root.
    const ku = leaf.getExtension('keyUsage') as {
      digitalSignature?: boolean;
      nonRepudiation?: boolean;
    } | null;
    if (ku && !ku.digitalSignature && !ku.nonRepudiation)
      throw new DscRejected(
        'certificate-use',
        'The certificate is not meant for signing documents.',
      );
    const roots = loadCertificates(this.config.TRUSTED_ROOTS_DIR);
    if (!roots.length)
      throw new DscRejected(
        'chain',
        'No trusted certificate authorities are configured on the server.',
      );
    const chain = chainTo(leaf, [...parsed.certs, ...roots]);
    let test = false;
    try {
      verifyChain(
        roots,
        chain,
        signedAt,
        this.allowExpired ? () => (test = true) : undefined,
      );
    } catch (e) {
      if (e instanceof ChainProblem && e.kind === 'dates')
        throw new DscRejected(
          'certificate-dates',
          'The signing certificate was not valid when the document was signed.',
        );
      throw new DscRejected(
        'chain',
        `The certificate does not chain to a trusted authority (${(e as Error).message}).`,
      );
    }

    // 5. Revocation. Not being able to ask is not a pass (except for a development-only expired certificate).
    const issuer = chain[1];
    if (!issuer)
      throw new DscRejected(
        'chain',
        'The issuing authority certificate is missing from the signature.',
      );
    try {
      await this.revocation.check(leaf, issuer, signedAt);
    } catch (e) {
      if (e instanceof CertificateRevoked)
        throw new DscRejected(
          'revoked',
          'The signing certificate has been revoked.',
        );
      if (e instanceof RevocationUnavailable && test)
        warnings.push(`Revocation not checked: ${e.message}`);
      else throw e;
    }
    return {
      signer: {
        commonName: field(leaf, 'CN') ?? 'Unknown',
        organisation: field(leaf, 'O'),
        serialHex: leaf.serialNumber,
        notBefore: leaf.validity.notBefore,
        notAfter: leaf.validity.notAfter,
        issuer: field(issuer, 'CN') ?? 'Unknown',
      },
      signedAt,
      test,
      warnings,
    };
  }

  /** The token must be about this signature, signed by a time-stamp authority we trust, valid at that time. */
  private checkTimestamp(token: forge.asn1.Asn1, signature: Buffer): Date {
    let t: { time: Date; imprintHex: string };
    let parsed;
    try {
      t = readToken(token);
      parsed = parseCms(token);
    } catch {
      throw new DscRejected(
        'timestamp-invalid',
        'The time-stamp in the signature could not be read.',
      );
    }
    if (t.imprintHex !== sha256Hex(signature))
      throw new DscRejected(
        'timestamp-invalid',
        'The time-stamp is not about this signature.',
      );
    if (!parsed.content)
      throw new DscRejected(
        'timestamp-invalid',
        'The time-stamp has no content.',
      );
    const c = verifyCms(parsed, parsed.content);
    if (!c.digestOk || !c.signatureOk || !c.signer)
      throw new DscRejected(
        'timestamp-invalid',
        'The time-stamp signature is not valid.',
      );
    const tsaRoots = [
      ...loadCertificates(this.config.TRUSTED_TSA_DIR),
      ...loadCertificates(this.config.TRUSTED_ROOTS_DIR),
    ];
    if (!tsaRoots.length)
      throw new DscRejected(
        'timestamp-untrusted',
        'No trusted time-stamp authorities are configured on the server.',
      );
    try {
      verifyChain(
        tsaRoots,
        chainTo(c.signer, [...parsed.certs, ...tsaRoots]),
        t.time,
      );
    } catch {
      throw new DscRejected(
        'timestamp-untrusted',
        'The time-stamp authority is not trusted or its certificate was not valid at that time.',
      );
    }
    return t.time;
  }
}
