import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import {
  assertSafeKey,
  contentDisposition,
  type DownloadUrlOptions,
  type StorageDriver,
} from './storage-driver.js';
import type { LocalDriver } from './local.driver.js';

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const isMissing = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err?.name === 'NotFound' ||
    err?.name === 'NoSuchKey' ||
    err?.$metadata?.httpStatusCode === 404
  );
};

/** Files in a private Cloudflare R2 bucket. Downloads go straight from R2 through short presigned links. */
export class R2Driver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    settings: R2Settings,
    private readonly local: LocalDriver | null,
    private readonly onFallback: (key: string) => void = () => undefined,
    client?: S3Client,
  ) {
    this.bucket = settings.bucket;
    this.client =
      client ??
      new S3Client({
        region: 'auto',
        endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: settings.accessKeyId,
          secretAccessKey: settings.secretAccessKey,
        },
        maxAttempts: 3, // the first try and 2 retries on network errors
        requestHandler: { requestTimeout: 30_000, connectionTimeout: 30_000 },
      });
  }

  private async existsInR2(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (e) {
      if (isMissing(e)) return false;
      throw e;
    }
  }

  async save(key: string, data: Readable): Promise<void> {
    assertSafeKey(key);
    if (await this.existsInR2(key)) throw new Error('Storage key exists');
    // Multipart for anything over 8 MB, a single put below that.
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: data },
      partSize: 8 * 1024 * 1024,
      queueSize: 2,
    });
    await upload.done();
  }

  /** Lazy: nothing is fetched until the stream is consumed. */
  read(key: string): Readable {
    assertSafeKey(key);
    return Readable.from(this.stream(key));
  }

  private async *stream(key: string): AsyncGenerator<Uint8Array> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      yield* res.Body as AsyncIterable<Uint8Array>;
    } catch (e) {
      if (isMissing(e) && this.local && (await this.local.exists(key))) {
        this.onFallback(key);
        yield* this.local.read(key) as AsyncIterable<Uint8Array>;
        return;
      }
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    if (await this.existsInR2(key)) return true;
    if (this.local && (await this.local.exists(key))) {
      this.onFallback(key);
      return true;
    }
    return false;
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    await this.local?.remove(key);
  }

  /** Null when the object is only on local disk, so the caller streams it instead. */
  async downloadUrl(
    key: string,
    opts: DownloadUrlOptions,
  ): Promise<string | null> {
    assertSafeKey(key);
    if (!(await this.existsInR2(key))) return null;
    return await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(
          opts.disposition ?? 'attachment',
          opts.filename,
        ),
        ResponseContentType: opts.mimeType,
      }),
      { expiresIn: opts.ttlSeconds ?? 300 },
    );
  }

  /** For the migration command: the object's presence in R2 itself, with no fallback. */
  has(key: string): Promise<boolean> {
    return this.existsInR2(key);
  }

  /** For the migration command: reads from R2 only. */
  async readR2Only(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return res.Body as Readable;
  }
}
