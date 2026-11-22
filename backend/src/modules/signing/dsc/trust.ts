import forge from 'node-forge';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Reads every certificate (PEM, one or many per file) from a folder. Missing folder means none. */
export function loadCertificates(dir?: string): forge.pki.Certificate[] {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: forge.pki.Certificate[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.(pem|crt|cer)$/i.test(f)) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    )) {
      try {
        out.push(forge.pki.certificateFromPem(m[0]));
      } catch {
        /* skip a file we cannot read; it simply is not trusted */
      }
    }
  }
  return out;
}
