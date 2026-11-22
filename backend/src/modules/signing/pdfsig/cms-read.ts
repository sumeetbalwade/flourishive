import forge from 'node-forge';
import { createHash } from 'node:crypto';

const asn1 = forge.asn1;
type Node = forge.asn1.Asn1;
const kids = (n: Node) => n.value as Node[];

export const OID = {
  messageDigest: forge.pki.oids.messageDigest,
  signingTime: forge.pki.oids.signingTime,
  timestampToken: '1.2.840.113549.1.9.16.2.14',
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
};
const HASHES: Record<string, string> = {
  [OID.sha256]: 'sha256',
  [OID.sha384]: 'sha384',
  [OID.sha512]: 'sha512',
};
const FORGE_MD: Record<string, () => forge.md.MessageDigest> = {
  sha256: () => forge.md.sha256.create(),
  sha384: () => forge.md.sha384.create(),
  sha512: () => forge.md.sha512.create(),
};

export interface ParsedCms {
  certs: forge.pki.Certificate[];
  /** The embedded content (time-stamp tokens carry it); null for a detached PDF signature. */
  content: Buffer | null;
  digestOid: string;
  authAttrs: Node | null;
  unauthAttrs: Node | null;
  signature: Buffer;
  messageDigest: Buffer | null;
  signingTime: Date | null;
  issuer: Node | null;
  timestampToken: Node | null;
}

export function parseCms(der: Buffer | Node): ParsedCms {
  const root = Buffer.isBuffer(der)
    ? asn1.fromDer(forge.util.createBuffer(der.toString('binary')), {
        strict: true,
        parseAllBytes: false,
      } as never)
    : (der as Node);
  const signedData = kids(kids(root)[1]!)[0]!;
  const sd = kids(signedData);
  const encap = sd[2]!;
  const eContent = kids(encap)[1];
  const content = eContent
    ? Buffer.from(kids(eContent)[0]!.value as string, 'binary')
    : null;
  const certNode = sd.find(
    (n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 0,
  );
  const certs = certNode
    ? kids(certNode).map((c) => forge.pki.certificateFromAsn1(c))
    : [];
  const info = kids(kids(sd[sd.length - 1]!)[0]!);
  const ctx = (t: number) =>
    info.find(
      (n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === t,
    ) ?? null;
  const authAttrs = ctx(0);
  const unauthAttrs = ctx(1);
  const signature = Buffer.from(
    info.find(
      (n) =>
        n.tagClass === asn1.Class.UNIVERSAL && n.type === asn1.Type.OCTETSTRING,
    )!.value as string,
    'binary',
  );
  const dOid = asn1.derToOid(kids(info[2]!)[0]!.value as string);
  let messageDigest: Buffer | null = null;
  let signingTime: Date | null = null;
  for (const attr of authAttrs ? kids(authAttrs) : []) {
    const f = kids(attr);
    const oid = asn1.derToOid(f[0]!.value as string);
    const v = kids(f[1]!)[0]!;
    if (oid === OID.messageDigest)
      messageDigest = Buffer.from(v.value as string, 'binary');
    if (oid === OID.signingTime)
      signingTime =
        v.type === asn1.Type.UTCTIME
          ? asn1.utcTimeToDate(v.value as string)
          : asn1.generalizedTimeToDate(v.value as string);
  }
  let timestampToken: Node | null = null;
  for (const attr of unauthAttrs ? kids(unauthAttrs) : []) {
    const f = kids(attr);
    if (asn1.derToOid(f[0]!.value as string) === OID.timestampToken)
      timestampToken = kids(f[1]!)[0]!;
  }
  return {
    certs,
    content,
    digestOid: dOid,
    authAttrs,
    unauthAttrs,
    signature,
    messageDigest,
    signingTime,
    issuer: kids(info[1]!)[0] ?? null,
    timestampToken,
  };
}

export type CmsCheck = {
  digestOk: boolean;
  signatureOk: boolean;
  signer: forge.pki.Certificate | null;
  weakAlgorithm: boolean;
};

/**
 * Checks one CMS signature: the signed attributes carry the right hash of `content`, and the
 * signature over those attributes verifies with the signer's certificate (found among the
 * embedded certificates by trying each, since issuer matching differs between producers).
 */
export function verifyCms(p: ParsedCms, content: Buffer): CmsCheck {
  const hash = HASHES[p.digestOid];
  if (!hash)
    return {
      digestOk: false,
      signatureOk: false,
      signer: null,
      weakAlgorithm: true,
    };
  const digestOk =
    !!p.messageDigest &&
    createHash(hash).update(content).digest().equals(p.messageDigest);
  let signer: forge.pki.Certificate | null = null;
  let signatureOk = false;
  if (p.authAttrs) {
    const set = asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.SET,
      true,
      kids(p.authAttrs),
    );
    const md = FORGE_MD[hash]!();
    md.update(asn1.toDer(set).getBytes());
    const sig = p.signature.toString('binary');
    for (const c of p.certs) {
      try {
        if (
          (c.publicKey as forge.pki.rsa.PublicKey).verify(
            md.digest().bytes(),
            sig,
          )
        ) {
          signer = c;
          signatureOk = true;
          break;
        }
      } catch {
        /* not this certificate */
      }
    }
  }
  return { digestOk, signatureOk, signer, weakAlgorithm: false };
}

export const sha256Hex = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
export const certDer = (c: forge.pki.Certificate) =>
  Buffer.from(asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary');
