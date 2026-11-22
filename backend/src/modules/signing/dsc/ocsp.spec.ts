import forge from 'node-forge';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CertificateRevoked,
  RevocationUnavailable,
  certId,
  checkOcsp,
  ocspUrl,
  parseOcspResponse,
} from './ocsp.js';

const asn1 = forge.asn1;
const C = asn1.Class;
const T = asn1.Type;
const dir = resolve(process.cwd(), 'test/fixtures/dsc');
const cert = (n: string) =>
  forge.pki.certificateFromPem(readFileSync(resolve(dir, `${n}.pem`), 'utf8'));
const leaf = cert('leaf');
const inter = cert('inter');
const interKey = forge.pki.privateKeyFromPem(
  readFileSync(resolve(dir, 'inter.key'), 'utf8'),
) as forge.pki.rsa.PrivateKey;
const oid = (o: string) =>
  asn1.create(C.UNIVERSAL, T.OID, false, asn1.oidToDer(o).getBytes());
const gt = (d: Date) =>
  asn1.create(
    C.UNIVERSAL,
    T.GENERALIZEDTIME,
    false,
    asn1.dateToGeneralizedTime(d),
  );

/** An OCSP answer as an authority would send it, signed by `signKey`. */
function answer(
  opts: {
    status?: 'good' | 'revoked' | 'unknown';
    next?: Date;
    forCert?: forge.pki.Certificate;
    signKey?: forge.pki.rsa.PrivateKey;
    ready?: boolean;
  } = {},
): Buffer {
  const now = new Date();
  const st =
    opts.status === 'revoked'
      ? asn1.create(C.CONTEXT_SPECIFIC, 1, true, [
          gt(new Date(now.getTime() - 86400000)),
        ])
      : opts.status === 'unknown'
        ? asn1.create(C.CONTEXT_SPECIFIC, 2, false, '')
        : asn1.create(C.CONTEXT_SPECIFIC, 0, false, '');
  const single = asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
    certId(opts.forCert ?? leaf, inter),
    st,
    gt(new Date(now.getTime() - 60000)),
    asn1.create(C.CONTEXT_SPECIFIC, 0, true, [
      gt(opts.next ?? new Date(now.getTime() + 86400000)),
    ]),
  ]);
  const tbs = asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
    asn1.create(C.CONTEXT_SPECIFIC, 1, true, [
      forge.pki.distinguishedNameToAsn1(inter.subject),
    ]),
    gt(now),
    asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [single]),
  ]);
  const md = forge.md.sha256.create();
  md.update(asn1.toDer(tbs).getBytes());
  const sig = (opts.signKey ?? interKey).sign(md);
  const basic = asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
    tbs,
    asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
      oid('1.2.840.113549.1.1.11'),
      asn1.create(C.UNIVERSAL, T.NULL, false, ''),
    ]),
    asn1.create(C.UNIVERSAL, T.BITSTRING, false, '\x00' + sig),
  ]);
  const resp = asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
    asn1.create(C.UNIVERSAL, T.ENUMERATED, false, '\x00'),
    asn1.create(C.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(C.UNIVERSAL, T.SEQUENCE, true, [
        oid('1.3.6.1.5.5.7.48.1.1'),
        asn1.create(
          C.UNIVERSAL,
          T.OCTETSTRING,
          false,
          asn1.toDer(basic).getBytes(),
        ),
      ]),
    ]),
  ]);
  return Buffer.from(asn1.toDer(resp).getBytes(), 'binary');
}
const serve = (body: Buffer, ok = true): typeof fetch =>
  (async () => ({
    ok,
    status: ok ? 200 : 503,
    arrayBuffer: async () => body,
  })) as never;

describe('OCSP revocation', () => {
  it('finds the revocation server address in the certificate', () => {
    expect(ocspUrl(leaf)).toBe('http://ocsp.test.invalid/');
    expect(ocspUrl(inter)).toBeNull();
  });

  it('reads good, revoked and unknown answers', () => {
    expect(parseOcspResponse(answer(), leaf, inter).status).toBe('good');
    const revoked = parseOcspResponse(
      answer({ status: 'revoked' }),
      leaf,
      inter,
    );
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(
      parseOcspResponse(answer({ status: 'unknown' }), leaf, inter).status,
    ).toBe('unknown');
  });

  it('does not trust an answer that the issuer did not sign, or one about another certificate', () => {
    const other = forge.pki.rsa.generateKeyPair(1024).privateKey;
    expect(() =>
      parseOcspResponse(answer({ signKey: other }), leaf, inter),
    ).toThrow(RevocationUnavailable);
    expect(() =>
      parseOcspResponse(answer({ forCert: cert('expired') }), leaf, inter),
    ).toThrow(RevocationUnavailable);
  });

  it('turns every failure into "unavailable" and a revoked answer into a refusal', async () => {
    expect(
      (await checkOcsp(leaf, inter, new Date(), serve(answer()))).status,
    ).toBe('good');
    await expect(
      checkOcsp(leaf, inter, new Date(), serve(answer({ status: 'revoked' }))),
    ).rejects.toBeInstanceOf(CertificateRevoked);
    await expect(
      checkOcsp(leaf, inter, new Date(), serve(answer({ status: 'unknown' }))),
    ).rejects.toBeInstanceOf(RevocationUnavailable);
    await expect(
      checkOcsp(leaf, inter, new Date(), serve(Buffer.from('x'), false)),
    ).rejects.toBeInstanceOf(RevocationUnavailable);
    await expect(
      checkOcsp(leaf, inter, new Date(), (async () => {
        throw new Error('down');
      }) as never),
    ).rejects.toBeInstanceOf(RevocationUnavailable);
    await expect(
      checkOcsp(
        leaf,
        inter,
        new Date(Date.now() + 3 * 86400000),
        serve(answer()),
      ),
    ).rejects.toBeInstanceOf(RevocationUnavailable); // stale
    await expect(
      checkOcsp(inter, cert('root'), new Date(), serve(answer())),
    ).rejects.toBeInstanceOf(RevocationUnavailable); // no address
  });
});
