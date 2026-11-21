import forge from 'node-forge';
import { createHash } from 'node:crypto';
import { readToken } from './timestamp.js';

const asn1 = forge.asn1;

export interface SealCheck {
  /** A signature of ours is present and the bytes it covers are unchanged. */
  intact: boolean;
  /** Nothing was added after the signature (an edit saved on top would be). */
  coversWholeFile: boolean;
  /** The signing certificate is the one this server seals with. */
  sealedByUs: boolean;
  timestamp: { time: Date; matchesSignature: boolean } | null;
  reason?: string;
}

const none = (reason: string): SealCheck => ({
  intact: false,
  coversWholeFile: false,
  sealedByUs: false,
  timestamp: null,
  reason,
});

/** The byte ranges and signature hex of the last signature in a PDF. */
function findSignature(pdf: Buffer) {
  const text = pdf.toString('latin1');
  const at = text.lastIndexOf('/ByteRange');
  if (at < 0) return null;
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
    text.slice(at, at + 200),
  );
  if (!m) return null;
  const [a, b, c, d] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  // The signature value sits in the gap: <hex...> between the two ranges.
  const gap = text.slice(a + b, c);
  const hex = /<([0-9a-fA-F]+)>/.exec(gap)?.[1];
  if (!hex) return null;
  return { a, b, c, d, hex };
}

/** Checks a sealed PDF with no outside help: digest, signature, certificate and time-stamp. */
export function verifySeal(pdf: Buffer, ourCertDerSha256: string): SealCheck {
  const sig = findSignature(pdf);
  if (!sig) return none('No signature found');
  const { a, b, c, d, hex } = sig;
  if (a !== 0 || c + d > pdf.length) return none('Malformed byte range');
  const coversWholeFile = c + d === pdf.length;
  const signed = Buffer.concat([
    pdf.subarray(a, a + b),
    pdf.subarray(c, c + d),
  ]);
  let cms: forge.asn1.Asn1;
  try {
    cms = asn1.fromDer(
      forge.util.createBuffer(Buffer.from(hex, 'hex').toString('binary')),
      // the signature field is zero padded after the DER bytes
      { strict: true, parseAllBytes: false } as never,
    );
  } catch {
    return none('Unreadable signature');
  }
  try {
    const signedData = (
      (cms.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[]
    )[0]!;
    const sd = signedData.value as forge.asn1.Asn1[];
    const certs = sd.find(
      (n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 0,
    )!;
    const certAsn1 = (certs.value as forge.asn1.Asn1[])[0]!;
    const cert = forge.pki.certificateFromAsn1(certAsn1);
    const certDer = asn1.toDer(certAsn1).getBytes();
    const sealedByUs =
      createHash('sha256')
        .update(Buffer.from(certDer, 'binary'))
        .digest('hex') === ourCertDerSha256;
    const info = (sd[sd.length - 1]!.value as forge.asn1.Asn1[])[0]!
      .value as forge.asn1.Asn1[];
    const authAttrs = info.find(
      (n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 0,
    )!;
    const unauth = info.find(
      (n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 1,
    );
    const signature = info.find(
      (n) =>
        n.type === asn1.Type.OCTETSTRING && n.tagClass === asn1.Class.UNIVERSAL,
    )!.value as string;

    // 1. The messageDigest attribute must equal the hash of the signed bytes.
    let digestOk = false;
    for (const attr of authAttrs.value as forge.asn1.Asn1[]) {
      const f = attr.value as forge.asn1.Asn1[];
      if (
        asn1.derToOid(f[0]!.value as string) === forge.pki.oids.messageDigest
      ) {
        const got = (f[1]!.value as forge.asn1.Asn1[])[0]!.value as string;
        digestOk =
          Buffer.from(got, 'binary').toString('hex') ===
          createHash('sha256').update(signed).digest('hex');
      }
    }
    // 2. The signature must verify over the authenticated attributes (re-tagged as a SET).
    const attrsAsSet = asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.SET,
      true,
      authAttrs.value as forge.asn1.Asn1[],
    );
    const md = forge.md.sha256.create();
    md.update(asn1.toDer(attrsAsSet).getBytes());
    const sigOk = (cert.publicKey as forge.pki.rsa.PublicKey).verify(
      md.digest().bytes(),
      signature,
    );

    let timestamp: SealCheck['timestamp'] = null;
    if (unauth) {
      for (const attr of unauth.value as forge.asn1.Asn1[]) {
        const f = attr.value as forge.asn1.Asn1[];
        if (
          asn1.derToOid(f[0]!.value as string) === '1.2.840.113549.1.9.16.2.14'
        ) {
          const token = (f[1]!.value as forge.asn1.Asn1[])[0]!;
          const t = readToken(token);
          timestamp = {
            time: t.time,
            matchesSignature:
              t.imprintHex ===
              createHash('sha256')
                .update(Buffer.from(signature, 'binary'))
                .digest('hex'),
          };
        }
      }
    }
    return {
      intact: digestOk && sigOk,
      coversWholeFile,
      sealedByUs,
      timestamp,
    };
  } catch (e) {
    return none(`Unreadable signature: ${(e as Error).message}`);
  }
}
