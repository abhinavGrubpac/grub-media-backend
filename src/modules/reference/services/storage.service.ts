import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Max uploaded doc size: 99 MB or less (portal rule). */
export const REFERENCE_MAX_FILE_BYTES = 99 * 1024 * 1024;

/**
 * Drops query string and fragment from a URL (presigned SigV4 params must
 * never be stored). Non-URLs pass through for downstream validators.
 */
export function stripUrlQuery(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

/** True when an S3 error means "no object at this key" (vs S3 unreachable). */
export function isS3NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * Media storage abstraction. Without S3 credentials the service runs in local
 * mock mode so the API is fully usable in development. With credentials it
 * issues real SigV4 presigned PUT URLs: the client uploads bytes straight to
 * S3, then confirms via finalize. File URLs are bucket-scoped in production
 * to prevent path-injection into reviewer-facing media.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

  private s3: S3Client | null = null;

  get isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('storage.bucket') &&
      this.config.get<string>('storage.accessKeyId') &&
      this.config.get<string>('storage.secretAccessKey'),
    );
  }

  /** Builds a collision-safe bucket key from a human title. */
  buildKey(prefix: string, title: string, ext: string): string {
    const slug = title
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    return `${prefix}/${Date.now()}-${slug || 'file'}.${ext}`;
  }

  /**
   * Ready-to-store public URL for an issued key. Copy this straight into
   * finalize `file_url` — never the presigned `upload_url` (its SigV4 query
   * string expires in 15 minutes and would rot the stored link).
   */
  publicUrlForKey(key: string): string {
    if (!this.isConfigured) return `https://mock-storage.local/uploads/${key}`;
    const bucket = this.config.get<string>('storage.bucket');
    const region = this.config.get<string>('storage.region') ?? 'ap-south-1';
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  /**
   * Finalize input -> canonical stored URL. Accepts a bare bucket key or a
   * full object URL; presigned query strings are stripped so a pasted
   * `upload_url` still resolves to the permanent object URL.
   */
  resolveStoredFileUrl(input: string): string {
    const clean = stripUrlQuery((input ?? '').trim());
    if (!clean) throw new BadRequestException('file_key/file_url must not be empty');
    if (!this.isConfigured) return clean;
    return this.resolveCreativeFileUrl(clean);
  }

  private client(): S3Client {
    if (!this.s3) {
      this.s3 = new S3Client({
        region: this.config.get<string>('storage.region') ?? 'ap-south-1',
        credentials: {
          accessKeyId: this.config.get<string>('storage.accessKeyId') || '',
          secretAccessKey: this.config.get<string>('storage.secretAccessKey') || '',
        },
        // Presigned PUTs must work with plain Content-Type uploads (Postman /
        // curl / browsers). The SDK default (WHEN_SUPPORTED) bakes CRC32
        // checksum headers into the signature, failing uploads that omit them.
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
    }
    return this.s3;
  }

  /**
   * Presigned S3 PUT URL for a bucket key. Signed without a Content-Type
   * restriction so the same URL accepts JPEG/PNG/PDF bytes; valid 15 minutes.
   */
  async presignedUploadUrl(key: string): Promise<string> {
    if (!this.isConfigured) {
      return `https://mock-storage.local/uploads/${key}?mock=1`;
    }
    return getSignedUrl(
      this.client(),
      new PutObjectCommand({
        Bucket: this.config.get<string>('storage.bucket'),
        Key: key,
      }),
      { expiresIn: 900 },
    );
  }

  /** Restricts stored file URLs to the approved media bucket in production. */
  assertFileUrlAllowed(fileUrl: string): void {
    if (this.config.get<string>('app.nodeEnv') !== 'production') return;
    const bucket = this.config.get<string>('storage.bucket');
    if (!bucket) throw new BadRequestException('Storage bucket is not configured');
    let host: string;
    try {
      host = new URL(fileUrl).hostname;
    } catch {
      throw new BadRequestException('file_url must be a valid URL');
    }
    const region = this.config.get<string>('storage.region') ?? 'ap-south-1';
    const allowed = [`${bucket}.s3.amazonaws.com`, `${bucket}.s3.${region}.amazonaws.com`];
    if (!allowed.includes(host)) {
      throw new BadRequestException('file_url must point at the approved media bucket');
    }
  }

  /** Rejects declared uploads larger than 99 MB. */
  assertFileSizeAllowed(size: number | undefined | null, field = 'file_size_bytes'): void {
    if (size === undefined || size === null) return;
    if (!Number.isInteger(size) || size <= 0) {
      throw new BadRequestException(`${field} must be a positive integer (bytes)`);
    }
    if (size > REFERENCE_MAX_FILE_BYTES) {
      throw new BadRequestException(`${field} must be 99 MB or less (got ${size} bytes)`);
    }
  }

  /** Extracts the bucket key from a stored file URL (null when unparseable). */
  extractKeyFromUrl(fileUrl: string): string | null {
    try {
      const path = new URL(fileUrl).pathname.replace(/^\/+/, '');
      return path ? decodeURIComponent(path) : null;
    } catch {
      return null;
    }
  }

  /**
   * Authoritative size check: HEADs the finalized object so a spoofed
   * file_size_bytes cannot bypass the 99 MB rule. Null in mock mode.
   */
  async getObjectSize(key: string): Promise<number | null> {
    if (!this.isConfigured) return null;
    const out = await this.client().send(
      new HeadObjectCommand({
        Bucket: this.config.get<string>('storage.bucket'),
        Key: key,
      }),
    );
    return typeof out.ContentLength === 'number' ? out.ContentLength : null;
  }

  /**
   * Presigned S3 GET URL for downloads. Falls back to the stored file URL in
   * mock mode so the API stays usable without credentials.
   */
  async presignedDownloadUrl(key: string, filename?: string): Promise<string> {
    if (!this.isConfigured) {
      return `https://mock-storage.local/downloads/${key}?mock=1`;
    }
    return getSignedUrl(
      this.client(),
      new GetObjectCommand({
        Bucket: this.config.get<string>('storage.bucket'),
        Key: key,
        ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
      }),
      { expiresIn: 900 },
    );
  }

  /**
   * Normalizes a finalize `s3_key` into the media URL stored on the version.
   * Accepts a bare bucket key (`agency/x.png`, stored as the full bucket URL
   * so renderers can use it directly) or a full URL (must point at the
   * configured bucket). Anything else is rejected — an uploader typo must
   * fail here, not surface as a broken image downstream.
   */
  resolveCreativeFileUrl(input: string): string {
    const value = input?.trim();
    if (!value) throw new BadRequestException('s3_key is required');
    if (/^https?:\/\//i.test(value)) {
      let host: string;
      try {
        host = new URL(value).hostname;
      } catch {
        throw new BadRequestException('s3_key must be a valid bucket key or URL');
      }
      const bucket = this.config.get<string>('storage.bucket') || '';
      const region = this.config.get<string>('storage.region') ?? 'ap-south-1';
      const allowed = [`${bucket}.s3.amazonaws.com`, `${bucket}.s3.${region}.amazonaws.com`];
      if (!bucket || !allowed.includes(host)) {
        throw new BadRequestException('s3_key URL must point at the configured media bucket');
      }
      return value;
    }
    if (value.startsWith('/') || value.includes('..') || /\s/.test(value)) {
      throw new BadRequestException('s3_key must be a relative bucket key (e.g. agency/x.png)');
    }
    const bucket = this.config.get<string>('storage.bucket');
    if (!bucket) return value; // mock mode: nothing to normalize against
    const region = this.config.get<string>('storage.region') ?? 'ap-south-1';
    return `https://${bucket}.s3.${region}.amazonaws.com/${value}`;
  }
}
