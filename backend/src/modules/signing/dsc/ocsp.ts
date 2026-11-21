import forge from 'node-forge';
import { createHash } from 'node:crypto';

const asn1 = forge.asn1;
type Node = forge.asn1.Asn1;
const kids = (n: Node) => n.value as Node[];
const C = asn1.Class;
const T = asn1.Type;
const oid = (o: string) =>
  asn1.create(C.UNIVERSAL, T.OID, false, asn1.oidToDer(o).getBytes());
const AIA = '1.3.6.1.5.5.7.1.1';
const OCSP_METHOD = '1.3.6.1.5.5.7.48.1';
const BASIC = '1.3.6.1.5.5.7.48.1.1';
const SIG_HASH: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'sha1',
  '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512',
};
const FORGE_MD: Record<string, () => forge.md.MessageDigest> = {
  sha1: () => forge.md.sha1.create(),
  sha256: () => forge.md.sha256.create(),
  sha384: () => forge.md.sha384.create(),
  sha512: () => forge.md.sha512.create(),
};

export class RevocationUnavailable extends Error {}
export class CertificateRevoked extends Error {
  constructor(readonly at: Date | null) {
    super('The certificate has been revoked');
  }
}

/** Where the certificate's authority answers revocation questions, from its Authority Information Access. */
export function ocspUrl(cert: forge.pki.Certificate): string | null {
  const ext = cert.getExtension({ id: AIA as unknown as number }) as {
    value?: string;
  } | null;
  if (!ext?.value) return null;
  try {
    for (const d of kids(asn1.fromDer(ext.value))) {
      const f = kids(d);
      if (
        asn1.derToOid(f[0]!.value as string) === OCSP_METHOD &&
        f[1]!.type === 6
      )
        return f[1]!.value as string;
    }
  } catch {
    /* fall through */
  }
  return null;
}

const sha1 = (b: string) =>
  createHash('sha1')
    .update(Buffer.from(b, 'binary'))
    .digest()
    .toString('binary');

export function certId(
  cert: forge.pki.Certificate,
  issuer: forge.pki.Certificate,
): Node {
  const nameDer = asn1
    .toDer(forge.pki.distinguishedNameToAsn1(cert.issuer))
    .getBytes();
  // The key hash is over the issuer's public key bits (for RSA, the DER of the RSAPublicKey).
  const keyBits = asn1
    .toDer(
      forge.pki.publicKeyToRSAPublicKey(
        issuer.publicKey as forge.pki.rsa.PublicKey,
      ),
    )
    .getBytes();
  let serial = forge.util.hexToBytes(cert.serialNumber);
  if (serial.charCodeAt(0) & 0x80) serial = '\x00' + serial;
  return asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
    asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
      oid('1.3.14.3.2.26'),
      asn1.create(C.UNIVERSAL, T.NULL, false, ''),
    ]),
    asn1.create(C.UNIVERSAL, T.OCTETSTRING, false, sha1(nameDer)),
    asn1.create(C.UNIVERSAL, T.OCTETSTRING, false, sha1(keyBits)),
    asn1.create(C.UNIVERSAL, T.INTEGER, false, serial),
  ]);
}

export function buildOcspRequest(
  cert: forge.pki.Certificate,
  issuer: forge.pki.Certificate,
): Buffer {
  const req = asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
    asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
      asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
        asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [certId(cert, issuer)]),
      ]),
    ]),
  ]);
  return Buffer.from(asn1.toDer(req).getBytes(), 'binary');
}

export interface OcspAnswer {
  status: 'good' | 'revoked' | 'unknown';
  thisUpdate: Date;
  nextUpdate: Date | null;
  revokedAt: Date | null;
}

const time = (n: Node) =>
  n.type === T.UTCTIME
    ? asn1.utcTimeToDate(n.value as string)
    : asn1.generalizedTimeToDate(n.value as string);

/** Reads an OCSP answer about `cert`, checking it is signed by the issuer (or a responder it delegated to). */
export function parseOcspResponse(
  der: Buffer,
  cert: forge.pki.Certificate,
  issuer: forge.pki.Certificate,
): OcspAnswer {
  const root = asn1.fromDer(der.toString('binary'));
  const top = kids(root);
  const code = (top[0]!.value as string).charCodeAt(0);
  if (code !== 0)
    throw new RevocationUnavailable(
      `The revocation server answered with status ${code}`,
    );
  const bytes = kids(kids(top[1]!)[0]!);
  if (asn1.derToOid(bytes[0]!.value as string) !== BASIC)
    throw new RevocationUnavailable('Unsupported revocation answer');
  const basic = kids(asn1.fromDer(bytes[1]!.value as string));
  const tbs = basic[0]!;
  const alg = asn1.derToOid(kids(basic[1]!)[0]!.value as string);
  const hash = SIG_HASH[alg];
  if (!hash)
    throw new RevocationUnavailable(
      'Unsupported signature on the revocation answer',
    );
  const signature = (basic[2]!.value as string).slice(1);
  const certsNode = basic.find(
    (n) => n.tagClass === C.CONTEXT_SPECIFIC && n.type === 0,
  );
  const embedded = certsNode ? kids(kids(certsNode)[0]!) : [];
  const candidates: forge.pki.Certificate[] = [];
  for (const e of embedded) {
    try {
      const c = forge.pki.certificateFromAsn1(e);
      if (issuer.verify(c)) candidates.push(c);
    } catch {
      /* ignore */
    }
  }
  const md = FORGE_MD[hash]!();
  md.update(asn1.toDer(tbs).getBytes());
  const digest = md.digest().bytes();
  const signers = [...candidates, issuer];
  const ok = signers.some((s) => {
    try {
      return (s.publicKey as forge.pki.rsa.PublicKey).verify(digest, signature);
    } catch {
      return false;
    }
  });
  if (!ok)
    throw new RevocationUnavailable(
      'The revocation answer is not signed by the issuer',
    );
  const data = kids(tbs);
  const responses = data.find(
    (n) =>
      n.tagClass === C.UNIVERSAL &&
      n.type === T.SEQUENCE &&
      kids(n).length &&
      kids(n)[0]!.type === T.SEQUENCE &&
      kids(kids(n)[0]!).length >= 3 &&
      kids(kids(n)[0]!)[0]!.type === T.SEQUENCE,
  )!;
  const wanted = asn1.toDer(certId(cert, issuer)).getBytes();
  for (const single of kids(responses)) {
    const f = kids(single);
    if (asn1.toDer(f[0]!).getBytes() !== wanted) continue;
    const st = f[1]!;
    const thisUpdate = time(f[2]!);
    // nextUpdate is the [0] after thisUpdate; the status (also [0] when good) comes before it
    const nextNode = f
      .slice(3)
      .find((n) => n.tagClass === C.CONTEXT_SPECIFIC && n.type === 0);
    const nextUpdate = nextNode ? time(kids(nextNode)[0]!) : null;
    if (st.type === 0)
      return { status: 'good', thisUpdate, nextUpdate, revokedAt: null };
    if (st.type === 1)
      return {
        status: 'revoked',
        thisUpdate,
        nextUpdate,
        revokedAt: time(kids(st)[0]!),
      };
    return { status: 'unknown', thisUpdate, nextUpdate, revokedAt: null };
  }
  throw new RevocationUnavailable(
    'The revocation answer is about a different certificate',
  );
}

/** Asks the certificate authority whether the certificate is still good. Anything but a clear answer is "unavailable". */
export async function checkOcsp(
  cert: forge.pki.Certificate,
  issuer: forge.pki.Certificate,
  now = new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<OcspAnswer> {
  const url = ocspUrl(cert);
  if (!url)
    throw new RevocationUnavailable(
      'The certificate has no revocation server address',
    );
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ocsp-request' },
      body: new Uint8Array(buildOcspRequest(cert, issuer)),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new RevocationUnavailable(
      'The revocation server could not be reached',
    );
  }
  if (!res.ok)
    throw new RevocationUnavailable(
      `The revocation server answered ${res.status}`,
    );
  const answer = parseOcspResponse(
    Buffer.from(await res.arrayBuffer()),
    cert,
    issuer,
  );
  const skew = 5 * 60_000;
  if (answer.thisUpdate.getTime() - skew > now.getTime())
    throw new RevocationUnavailable(
      'The revocation answer is dated in the future',
    );
  if (answer.nextUpdate && answer.nextUpdate.getTime() + skew < now.getTime())
    throw new RevocationUnavailable('The revocation answer is out of date');
  if (answer.status === 'revoked')
    throw new CertificateRevoked(answer.revokedAt);
  if (answer.status === 'unknown')
    throw new RevocationUnavailable(
      'The authority does not know this certificate',
    );
  return answer;
}
