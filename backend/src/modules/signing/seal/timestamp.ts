import forge from 'node-forge';

const asn1 = forge.asn1;
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

/** An RFC 3161 request for the SHA-256 of `data`, asking the TSA to include its certificate. */
export function buildTimestampRequest(data: Buffer): Buffer {
  const digest = forge.md.sha256
    .create()
    .update(data.toString('binary'))
    .digest()
    .getBytes();
  const req = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '\x01'),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(OID_SHA256).getBytes(),
        ),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
    ]),
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.INTEGER,
      false,
      forge.random.getBytesSync(8).replace(/^[\x80-\xff]/, '\x7f'),
    ),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, '\xff'),
  ]);
  return Buffer.from(asn1.toDer(req).getBytes(), 'binary');
}

/** Reads a TimeStampResp and returns the timeStampToken (a CMS ContentInfo) or throws. */
export function tokenFromResponse(resp: Buffer): forge.asn1.Asn1 {
  const root = asn1.fromDer(resp.toString('binary'));
  const parts = root.value as forge.asn1.Asn1[];
  const status = (parts[0]!.value as forge.asn1.Asn1[])[0]!;
  const code = (status.value as string).charCodeAt(0);
  if (code !== 0 && code !== 1)
    throw new Error(`The time-stamp server refused (status ${code})`);
  const token = parts[1];
  if (!token) throw new Error('The time-stamp server sent no token');
  return token;
}

/** Asks a time-stamp authority to vouch for `data` existing now. */
export async function requestTimestamp(
  url: string,
  data: Buffer,
  timeoutMs = 10_000,
): Promise<forge.asn1.Asn1> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/timestamp-query' },
    body: new Uint8Array(buildTimestampRequest(data)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Time-stamp server answered ${res.status}`);
  return tokenFromResponse(Buffer.from(await res.arrayBuffer()));
}

/** genTime and message imprint of a timestamp token, for checking it belongs to a signature. */
export function readToken(token: forge.asn1.Asn1): {
  time: Date;
  imprintHex: string;
} {
  // ContentInfo { oid, [0] SignedData { version, digests, encapContentInfo { oid, [0] OCTET STRING } } }
  const signedData = (
    (token.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[]
  )[0]!;
  const encap = (signedData.value as forge.asn1.Asn1[])[2]!;
  const octets = (
    (encap.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[]
  )[0]!;
  const tst = asn1.fromDer(octets.value as string);
  const f = tst.value as forge.asn1.Asn1[];
  const imprint = (f[2]!.value as forge.asn1.Asn1[])[1]!.value as string;
  const gen = f[4]!.value as string;
  return {
    time: asn1.generalizedTimeToDate(gen),
    imprintHex: forge.util.bytesToHex(imprint),
  };
}
