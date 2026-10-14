import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const ALLOWED_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl: string | undefined;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.region = config.get<string>('s3.region', 'us-east-1');
    this.bucket = config.get<string>('s3.bucket', '');
    this.cdnUrl = config.get<string | undefined>('s3.cdnUrl');

    const endpoint = config.get<string | undefined>('s3.endpoint');
    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: config.get<string>('s3.accessKeyId', ''),
        secretAccessKey: config.get<string>('s3.secretAccessKey', ''),
      },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  /**
   * Uploads a file buffer to S3 and returns the public URL.
   *
   * Key format: {env}/{resourceType}/{ownerId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
   *
   * resourceType examples: "avatars", "org-logos"
   * — env prefix  → isolates prod/staging/dev with IAM prefix policies
   * — ownerId     → per-owner IAM scoping + GDPR bulk-delete by prefix
   * — date path   → S3 lifecycle rules fire on prefix; cost-explorer drill-down by day
   */
  async uploadImage(
    resourceType: string,
    ownerId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    this.assertConfigured();

    const ext = ALLOWED_EXTENSIONS[file.mimetype] ?? 'bin';
    const env = this.config.get<string>('app.nodeEnv', 'development');
    const now = new Date();
    const key = [
      env,
      resourceType,
      ownerId,
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      `${randomUUID()}.${ext}`,
    ].join('/');

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          // Immutable cache — URL changes on every upload so old URLs never stale
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (err) {
      this.logger.error('S3 upload failed', { key, error: (err as Error).message });
      throw new InternalServerErrorException('Avatar upload failed');
    }

    return this.toPublicUrl(key);
  }

  /** Deletes an object by its S3 key (extracted from a previously stored URL). */
  async deleteByUrl(url: string): Promise<void> {
    const key = this.keyFromUrl(url);
    if (!key) return;

    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      // Non-fatal: log and continue. Old object orphaned but upload must not fail.
      if ((err as S3ServiceException).name !== 'NoSuchKey') {
        this.logger.warn('S3 delete failed (non-fatal)', {
          key,
          error: (err as Error).message,
        });
      }
    }
  }

  private toPublicUrl(key: string): string {
    if (this.cdnUrl) return `${this.cdnUrl}/${key}`;
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private keyFromUrl(url: string): string | null {
    try {
      return new URL(url).pathname.replace(/^\//, '');
    } catch {
      return null;
    }
  }

  private assertConfigured(): void {
    if (!this.bucket || !this.config.get<string>('s3.accessKeyId')) {
      throw new InternalServerErrorException('S3 is not configured on this server');
    }
  }
}
