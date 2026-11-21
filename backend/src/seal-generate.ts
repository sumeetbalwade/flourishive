import forge from 'node-forge';
import { generateSealKey } from './modules/signing/seal/seal.service.js';

/**
 * Makes the organisation seal key and certificate (D-41) and prints the two settings to put in the
 * server's environment. Nothing is written to disk. Run once, store the key as a server secret,
 * never commit it. Re-running makes a different key, so documents sealed earlier would report
 * "sealed by a different certificate".
 */
const { privateKey, certificate } = generateSealKey();
const b64 = (s: string) => Buffer.from(s).toString('base64');
console.log(`SEAL_KEY_BASE64=${b64(forge.pki.privateKeyToPem(privateKey))}`);
console.log(`SEAL_CERT_BASE64=${b64(forge.pki.certificateToPem(certificate))}`);
console.log(
  '\n# Optional RFC 3161 time-stamp server:\n# SEAL_TSA_URL=http://timestamp.digicert.com',
);
