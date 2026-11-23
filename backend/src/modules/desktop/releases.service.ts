import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { StorageService } from '../../platform/storage/storage.service.js';

export const MANIFEST_KEY = 'releases/desktop/manifest.json';

const file = z.object({
  key: z.string().min(1),
  sha256: z.string().length(64),
});
/** Written by `desktop/packaging/publish.py` when a new Flourishive Desktop is released. */
export const manifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  notes: z.string().max(2000).optional(),
  /** Computers older than this must update before they can sign. */
  minVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  /** Where the desktop app reports crashes; left out to report nowhere. */
  sentryDsn: z.string().url().optional(),
  files: z.object({ windows: file.optional(), macos: file.optional() }),
});
export type Manifest = z.infer<typeof manifestSchema>;

const parts = (v: string) => v.split('.').map((n) => Number(n) || 0);
/** True when `a` is older than `b` (both like 1.2.3). */
export function isOlder(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}

@Injectable()
export class ReleasesService {
  constructor(private readonly storage: StorageService) {}

  /** The newest published release, or null when none has been published. */
  async manifest(): Promise<Manifest | null> {
    if (!(await this.storage.exists(MANIFEST_KEY))) return null;
    let text = '';
    for await (const c of this.storage.read(MANIFEST_KEY)) text += c;
    const parsed = manifestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  }

  async check(platform: 'windows' | 'macos', current: string) {
    const m = await this.manifest();
    const f = m?.files[platform];
    if (!m || !f)
      return {
        updateAvailable: false as const,
        sentryDsn: m?.sentryDsn ?? null,
      };
    const newer = isOlder(current, m.version);
    const url = newer
      ? await this.storage.downloadUrl(f.key, {
          filename: `FlourishiveDesktop-${m.version}-${platform}.zip`,
          mimeType: 'application/zip',
          ttlSeconds: 900,
        })
      : null;
    return {
      updateAvailable: newer,
      latest: m.version,
      notes: m.notes ?? '',
      mandatory: !!m.minVersion && isOlder(current, m.minVersion),
      sha256: f.sha256,
      url,
      // Local storage has no direct link, so the app downloads through the API.
      downloadPath:
        newer && !url
          ? `/v1/desktop/update/download?platform=${platform}`
          : null,
      sentryDsn: m.sentryDsn ?? null,
    };
  }

  async fileFor(platform: 'windows' | 'macos') {
    const f = (await this.manifest())?.files[platform];
    return f ? { key: f.key, stream: this.storage.read(f.key) } : null;
  }
}
