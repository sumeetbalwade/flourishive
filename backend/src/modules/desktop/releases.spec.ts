import { Readable } from 'node:stream';
import { MANIFEST_KEY, ReleasesService, isOlder } from './releases.service.js';

const sha = 'a'.repeat(64);
function service(manifest: object | null, url: string | null = 'https://r2.test/x') {
  const storage = {
    exists: async (k: string) => k === MANIFEST_KEY && manifest !== null,
    read: () => Readable.from([JSON.stringify(manifest)]),
    downloadUrl: async () => url,
  };
  return new ReleasesService(storage as never);
}

describe('desktop releases', () => {
  it('compares versions as numbers, not text', () => {
    expect(isOlder('0.9.0', '0.10.0')).toBe(true);
    expect(isOlder('1.2.3', '1.2.3')).toBe(false);
    expect(isOlder('2.0.0', '1.9.9')).toBe(false);
  });

  it('says nothing is available when no release is published', async () => {
    expect(await service(null).check('windows', '0.2.0')).toMatchObject({ updateAvailable: false });
  });

  it('offers a newer release with its hash, and forces it below the minimum', async () => {
    const m = {
      version: '0.3.0',
      minVersion: '0.2.5',
      sentryDsn: 'https://k@o.ingest.sentry.io/1',
      files: { windows: { key: 'releases/desktop/0.3.0/w.zip', sha256: sha } },
    };
    const old = await service(m).check('windows', '0.2.0');
    expect(old).toMatchObject({ updateAvailable: true, latest: '0.3.0', mandatory: true, sha256: sha });
    const ok = await service(m).check('windows', '0.2.9');
    expect(ok).toMatchObject({ updateAvailable: true, mandatory: false });
    expect(await service(m).check('windows', '0.3.0')).toMatchObject({ updateAvailable: false });
    // no file for this platform: nothing to offer, but the crash-report address still goes out
    expect(await service(m).check('macos', '0.1.0')).toMatchObject({ updateAvailable: false, sentryDsn: m.sentryDsn });
  });

  it('falls back to downloading through the API when storage has no direct link', async () => {
    const m = { version: '0.3.0', files: { macos: { key: 'k', sha256: sha } } };
    const r = await service(m, null).check('macos', '0.1.0');
    expect(r).toMatchObject({ url: null, downloadPath: '/v1/desktop/update/download?platform=macos' });
  });
});
