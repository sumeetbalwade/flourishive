import type { Readable } from 'node:stream';

export interface DownloadUrlOptions {
  filename: string;
  mimeType: string;
  disposition?: 'attachment' | 'inline';
  ttlSeconds?: number;
}

/** Where file bytes live. StorageService picks one by STORAGE_DRIVER. */
export interface StorageDriver {
  /** Writes once; refuses to overwrite an existing key. */
  save(key: string, data: Readable): Promise<void>;
  read(key: string): Readable;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** A short-lived direct link, or null when the API must stream the bytes itself. */
  downloadUrl(key: string, opts: DownloadUrlOptions): Promise<string | null>;
}

/** Keys are tenant-prefixed relative paths. Nothing may climb out of the root. */
export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error('Invalid storage key');
  }
}

/** Content-Disposition value with an ASCII fallback and an RFC 5987 filename. */
export function contentDisposition(
  disposition: 'attachment' | 'inline',
  filename: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
