import forge from 'node-forge';
import { Signer } from '@signpdf/utils';
import { requestTimestamp } from './timestamp.js';

const asn1 = forge.asn1;
const OID_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';

export interface SealKey {
  privateKey: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
}

/**
 * Builds the signature that goes inside the PDF: a detached CMS (PKCS#7) over the PDF bytes, with
 * an RFC 3161 time-stamp over the signature added when a time-stamp server is configured.
 */
export class SealSigner extends Signer {
  constructor(
    private readonly key: SealKey,
    private readonly tsaUrl?: string,
  ) {
    super();
  }

  async sign(pdfBuffer: Buffer, signingTime?: Date): Promise<Buffer> {
    const { privateKey, certificate } = this.key;
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(pdfBuffer.toString('binary'));
    p7.addCertificate(certificate);
    p7.addSigner({
      key: privateKey,
      certificate,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        {
          type: forge.pki.oids.signingTime,
          value: (signingTime ?? new Date()) as unknown as string,
        },
        { type: forge.pki.oids.messageDigest },
      ],
    });
    p7.sign({ detached: true });
    if (!this.tsaUrl)
      return Buffer.from(asn1.toDer(p7.toAsn1()).getBytes(), 'binary');

    const signature = Buffer.from(
      (p7 as unknown as { signers: { signature: string }[] }).signers[0]!
        .signature,
      'binary',
    );
    const token = await requestTimestamp(this.tsaUrl, signature);
    const root = p7.toAsn1();
    // ContentInfo > [0] > SignedData > signerInfos (last child) > SignerInfo
    const signedData = (
      (root.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[]
    )[0]!;
    const sd = signedData.value as forge.asn1.Asn1[];
    const signerInfos = sd[sd.length - 1]!;
    const info = (signerInfos.value as forge.asn1.Asn1[])[0]!;
    (info.value as forge.asn1.Asn1[]).push(
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
          asn1.create(
            asn1.Class.UNIVERSAL,
            asn1.Type.OID,
            false,
            asn1.oidToDer(OID_TIMESTAMP_TOKEN).getBytes(),
          ),
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [token]),
        ]),
      ]),
    );
    return Buffer.from(asn1.toDer(root).getBytes(), 'binary');
  }
}
