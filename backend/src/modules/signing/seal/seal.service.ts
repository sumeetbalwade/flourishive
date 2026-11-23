import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import forge from 'node-forge';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { RuntimeConfigService } from '../../../platform/config/runtime-config.service.js';
import { APP_CONFIG, type AppConfig } from '../../../platform/config/config.js';
import { SealSigner, type SealKey } from './cms.js';
import { verifySeal, type SealCheck } from './verify.js';

/** Room for the signature and the time-stamp token inside the PDF. */
const SIGNATURE_BYTES = 16384;

/**
 * Seals a finished PDF with the organisation's certificate (D-41) so any later edit is detectable.
 * This is a seal, not a legal signature: viewers show "signer unknown" until they trust our
 * certificate. Swapping to a purchased certificate is a change of the key and certificate settings.
 */
@Injectable()
export class SealService {
  private readonly log = new Logger(SealService.name);
  private key?: SealKey;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly runtime?: RuntimeConfigService,
  ) {}

  private load(): SealKey {
    if (this.key) return this.key;
    if (this.config.SEAL_KEY_BASE64 && this.config.SEAL_CERT_BASE64) {
      this.key = {
        privateKey: forge.pki.privateKeyFromPem(
          Buffer.from(this.config.SEAL_KEY_BASE64, 'base64').toString(),
        ) as forge.pki.rsa.PrivateKey,
        certificate: forge.pki.certificateFromPem(
          Buffer.from(this.config.SEAL_CERT_BASE64, 'base64').toString(),
        ),
      };
    } else if (this.config.NODE_ENV === 'production') {
      throw new Error(
        'The seal key is not configured (SEAL_KEY_BASE64, SEAL_CERT_BASE64)',
      );
    } else {
      this.log.warn(
        'No seal key configured: using a temporary one (development only)',
      );
      this.key = generateSealKey();
    }
    return this.key;
  }

  /** The public certificate people can install to trust our seals. */
  certificatePem(): string {
    return forge.pki.certificateToPem(this.load().certificate);
  }

  private certSha256(): string {
    const der = forge.asn1
      .toDer(forge.pki.certificateToAsn1(this.load().certificate))
      .getBytes();
    return createHash('sha256')
      .update(Buffer.from(der, 'binary'))
      .digest('hex');
  }

  async seal(
    pdf: Buffer,
    info: { reason: string; location?: string },
  ): Promise<Buffer> {
    const doc = await PDFDocument.load(pdf);
    pdflibAddPlaceholder({
      pdfDoc: doc,
      reason: info.reason,
      contactInfo: this.config.APP_NAME,
      name: 'Flourishive Document Seal',
      location: info.location ?? 'India',
      signatureLength: SIGNATURE_BYTES,
    });
    const withPlaceholder = Buffer.from(
      await doc.save({ useObjectStreams: false }),
    );
    const signer = new SealSigner(
      this.load(),
      (await this.runtime?.get('SEAL_TSA_URL')) ?? this.config.SEAL_TSA_URL,
    );
    return new SignPdf().sign(withPlaceholder, signer);
  }

  verify(pdf: Buffer): SealCheck {
    return verifySeal(pdf, this.certSha256());
  }
}

/** A fresh RSA-2048 self-signed seal certificate (10 years). */
export function generateSealKey(): SealKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const key = forge.pki.privateKeyFromPem(
    privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ) as forge.pki.rsa.PrivateKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }) as string,
  );
  cert.serialNumber = forge.util
    .bytesToHex(forge.random.getBytesSync(12))
    .replace(/^[89a-f]/, '1');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'organizationName', value: 'Flourishive' },
    { name: 'commonName', value: 'Flourishive Document Seal' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      critical: true,
      digitalSignature: true,
      nonRepudiation: true,
    },
  ]);
  cert.sign(key, forge.md.sha256.create());
  return { privateKey: key, certificate: cert };
}
