import { createHash } from 'node:crypto';
import { certDer, parseCms, verifyCms } from '../pdfsig/cms-read.js';
import {
  coveredBytes,
  findSignatures,
  onlyAddsSignature,
} from '../pdfsig/signatures.js';
import { readToken } from './timestamp.js';

export interface SealCheck {
  /** Our seal is present and the bytes it covers are unchanged. */
  intact: boolean;
  /** Nothing was changed after the seal, other than later signatures being added (D-47). */
  coversWholeFile: boolean;
  /** The signing certificate is the one this server seals with. */
  sealedByUs: boolean;
  timestamp: { time: Date; matchesSignature: boolean } | null;
  /** Signatures added after the seal (for example the HR lead's DSC). */
  laterSignatures: number;
  reason?: string;
}

const none = (reason: string): SealCheck => ({
  intact: false,
  coversWholeFile: false,
  sealedByUs: false,
  timestamp: null,
  laterSignatures: 0,
  reason,
});

/**
 * Checks our organisation seal in a PDF with no outside help: digest, signature, certificate and
 * time-stamp. Signatures added after the seal are allowed when they only add a signature.
 */
export function verifySeal(pdf: Buffer, ourCertDerSha256: string): SealCheck {
  const sigs = findSignatures(pdf);
  if (!sigs.length) return none('No signature found');
  // The seal is the signature made with our certificate; later signatures belong to other people.
  let idx = -1;
  let parsed: ReturnType<typeof parseCms> | null = null;
  for (let i = 0; i < sigs.length; i++) {
    try {
      const p = parseCms(sigs[i]!.contents);
      if (
        p.certs.some(
          (c) =>
            createHash('sha256').update(certDer(c)).digest('hex') ===
            ourCertDerSha256,
        )
      ) {
        idx = i;
        parsed = p;
        break;
      }
    } catch {
      /* not a CMS signature we can read */
    }
  }
  if (idx < 0 || !parsed) {
    const last = sigs[sigs.length - 1]!;
    try {
      const p = parseCms(last.contents);
      return {
        ...none('Not sealed by this service'),
        sealedByUs: false,
        intact: verifyCms(p, coveredBytes(pdf, last)).signatureOk,
      };
    } catch {
      return none('Unreadable signature');
    }
  }
  const sig = sigs[idx]!;
  const check = verifyCms(parsed, coveredBytes(pdf, sig));
  const intact = check.digestOk && check.signatureOk;
  const sealedByUs =
    !!check.signer &&
    createHash('sha256').update(certDer(check.signer)).digest('hex') ===
      ourCertDerSha256;
  // Everything after the seal must be later signatures (and nothing else).
  let coversWholeFile = sig.coveredEnd === pdf.length;
  const later = sigs.slice(idx + 1);
  if (!coversWholeFile && later.length) {
    const lastEnd = later[later.length - 1]!.coveredEnd;
    coversWholeFile =
      lastEnd === pdf.length &&
      onlyAddsSignature(pdf.subarray(sig.coveredEnd, lastEnd)).ok;
  }
  let timestamp: SealCheck['timestamp'] = null;
  if (parsed.timestampToken) {
    try {
      const t = readToken(parsed.timestampToken);
      timestamp = {
        time: t.time,
        matchesSignature:
          t.imprintHex ===
          createHash('sha256').update(parsed.signature).digest('hex'),
      };
    } catch {
      timestamp = null;
    }
  }
  return {
    intact,
    coversWholeFile,
    sealedByUs,
    timestamp,
    laterSignatures: later.length,
  };
}
