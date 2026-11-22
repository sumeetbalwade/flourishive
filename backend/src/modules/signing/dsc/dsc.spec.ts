import forge from 'node-forge';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { onlyAddsSignature } from '../pdfsig/signatures.js';
import { certDer } from '../pdfsig/cms-read.js';
import { verifySeal } from '../seal/verify.js';
import {
  DscRejected,
  DscValidator,
  RevocationChecker,
  RevocationUnavailable,
} from './dsc-validator.js';
import { CertificateRevoked } from './ocsp.js';

const dir = resolve(process.cwd(), 'test/fixtures/dsc');
const file = (n: string) => readFileSync(resolve(dir, n));
const input = file('input.pdf');
const base = {
  NODE_ENV: 'test',
  TRUSTED_ROOTS_DIR: resolve(dir, 'trust'),
  TRUSTED_TSA_DIR: resolve(dir, 'trust'),
  ALLOW_EXPIRED_SIGNER_CERT: false,
};

class Revocation extends RevocationChecker {
  constructor(
    private readonly outcome: 'good' | 'revoked' | 'unavailable' = 'good',
  ) {
    super();
  }
  async check() {
    if (this.outcome === 'revoked') throw new CertificateRevoked(new Date());
    if (this.outcome === 'unavailable')
      throw new RevocationUnavailable(
        'The revocation server could not be reached',
      );
  }
}
const make = (
  config: object = {},
  rev: 'good' | 'revoked' | 'unavailable' = 'good',
) => new DscValidator({ ...base, ...config } as never, new Revocation(rev));
const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DscRejected) return e.code;
    throw e;
  }
  return 'accepted';
};

describe('DSC validation (D-48)', () => {
  it('accepts a certificate-signed PDF that extends the file we sent, and reads the signer', async () => {
    const r = await make().validate({
      sent: input,
      signed: file('signed-ok.pdf'),
    });
    expect(r.signer).toMatchObject({
      commonName: 'Noah Brooks (Test DSC)',
      organisation: 'Flourisense Test',
      issuer: 'Test Issuing CA',
    });
    expect(r.test).toBe(false);
    expect(Math.abs(r.signedAt.getTime() - Date.now())).toBeLessThan(
      24 * 3600_000 * 30,
    );
  });

  it('keeps our seal valid after the DSC is added (D-47)', () => {
    const sealCert = forge.pki.certificateFromPem(file('seal.pem').toString());
    const ours = createHash('sha256').update(certDer(sealCert)).digest('hex');
    expect(verifySeal(input, ours)).toMatchObject({
      intact: true,
      laterSignatures: 0,
    });
    expect(verifySeal(file('signed-ok.pdf'), ours)).toMatchObject({
      intact: true,
      coversWholeFile: true,
      sealedByUs: true,
      laterSignatures: 1,
    });
  });

  it('refuses a file that is not an extension of the one that was sent', async () => {
    const other = Buffer.from(input);
    other[other.indexOf('stream\n') + 8] ^= 1;
    expect(
      await reject(
        make().validate({ sent: other, signed: file('signed-ok.pdf') }),
      ),
    ).toBe('not-an-extension');
    expect(await reject(make().validate({ sent: input, signed: input }))).toBe(
      'not-an-extension',
    );
    const cut = file('signed-ok.pdf');
    expect(
      await reject(
        make().validate({
          sent: input,
          signed: cut.subarray(0, cut.length - 40),
        }),
      ),
    ).toBe('no-signature');
  });

  it('refuses a signed file whose content was changed after signing', async () => {
    const signed = Buffer.from(file('signed-ok.pdf'));
    // change a byte inside the covered new section (the added signature field), not the signature value
    const i = signed.indexOf('/Reason', input.length);
    expect(i).toBeGreaterThan(input.length);
    signed[i + 9] ^= 1;
    expect(await reject(make().validate({ sent: input, signed }))).toBe(
      'digest',
    );
  });

  it('requires a CA time-stamp', async () => {
    expect(
      await reject(
        make().validate({
          sent: input,
          signed: file('signed-no-timestamp.pdf'),
        }),
      ),
    ).toBe('no-timestamp');
  });

  it('requires the certificate to chain to a trusted authority', async () => {
    expect(
      await reject(
        make().validate({ sent: input, signed: file('signed-untrusted.pdf') }),
      ),
    ).toBe('chain');
    expect(
      await reject(
        make({ TRUSTED_ROOTS_DIR: undefined }).validate({
          sent: input,
          signed: file('signed-ok.pdf'),
        }),
      ),
    ).toBe('chain');
  });

  it('refuses an expired certificate, and only the development switch lets it through as TEST', async () => {
    const signed = file('signed-expired.pdf');
    expect(await reject(make().validate({ sent: input, signed }))).toBe(
      'certificate-dates',
    );
    expect(
      await reject(
        make({
          NODE_ENV: 'production',
          ALLOW_EXPIRED_SIGNER_CERT: true,
        }).validate({ sent: input, signed }),
      ),
    ).toBe('certificate-dates');
    // the switch relaxes the dates only: revocation is still asked, and only an expired certificate may skip an unreachable answer
    const r = await make(
      { ALLOW_EXPIRED_SIGNER_CERT: true },
      'unavailable',
    ).validate({ sent: input, signed });
    expect(r.test).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Revocation not checked/);
    expect(
      await reject(
        make({ ALLOW_EXPIRED_SIGNER_CERT: true }, 'revoked').validate({
          sent: input,
          signed,
        }),
      ),
    ).toBe('revoked');
    // a valid certificate is never labelled TEST just because the switch is on
    expect(
      (
        await make({ ALLOW_EXPIRED_SIGNER_CERT: true }).validate({
          sent: input,
          signed: file('signed-ok.pdf'),
        })
      ).test,
    ).toBe(false);
  });

  it('refuses a revoked certificate and holds the file when revocation cannot be checked', async () => {
    expect(
      await reject(
        make({}, 'revoked').validate({
          sent: input,
          signed: file('signed-ok.pdf'),
        }),
      ),
    ).toBe('revoked');
    await expect(
      make({}, 'unavailable').validate({
        sent: input,
        signed: file('signed-ok.pdf'),
      }),
    ).rejects.toBeInstanceOf(RevocationUnavailable);
  });
});

describe('what may be added after a signature', () => {
  it('accepts exactly what a signature adds', () => {
    expect(
      onlyAddsSignature(file('signed-ok.pdf').subarray(input.length)).ok,
    ).toBe(true);
  });
  it('refuses new page content, annotations and hidden object streams', () => {
    const wrap = (body: string) =>
      Buffer.from(
        `1 0 obj\n<< /Type /Sig /ByteRange [0 1 2 3] >>\nendobj\n${body}`,
      );
    expect(
      onlyAddsSignature(
        wrap(
          '9 0 obj\n<< /Length 20 >>\nstream\nBT /F1 12 Tf (FAKE) Tj ET\nendstream\nendobj\n',
        ),
      ).ok,
    ).toBe(false);
    expect(
      onlyAddsSignature(
        wrap(
          '9 0 obj\n<< /Type /Annot /Subtype /FreeText /Contents (fake) >>\nendobj\n',
        ),
      ).ok,
    ).toBe(false);
    expect(
      onlyAddsSignature(
        wrap(
          '9 0 obj\n<< /Type /ObjStm /N 1 /Length 5 >>\nstream\nabcde\nendstream\nendobj\n',
        ),
      ).ok,
    ).toBe(false);
    expect(onlyAddsSignature(Buffer.from('%%EOF\n')).ok).toBe(false);
  });
});
