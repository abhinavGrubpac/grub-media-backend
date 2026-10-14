import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Shared media storage abstraction (cutover target for the per-module copies).
 * Without S3 credentials the service runs in local mock mode so the API is
 * fully usable in development. When credentials are configured but the
 * presigner is not wired yet, upload-url requests fail fast instead of
 * silently issuing unusable URLs. File URLs are bucket-scoped in production
 * to prevent path-injection into reviewer-facing media.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

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

  async presignedUploadUrl(key: string): Promise<string> {
    if (!this.isConfigured) {
      return `https://mock-storage.local/uploads/${key}?mock=1`;
    }
    throw new BadRequestException(
      'S3 presigned uploads are not wired yet; contact an administrator',
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
}
