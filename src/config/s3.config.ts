import { registerAs } from '@nestjs/config';

export default registerAs('s3', () => ({
  region: process.env.AWS_S3_REGION ?? 'us-east-1',
  bucket: process.env.AWS_S3_BUCKET ?? '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  /** Optional: custom endpoint for R2, MinIO, or LocalStack. */
  endpoint: process.env.AWS_S3_ENDPOINT,
  /** Optional: CloudFront distribution URL (no trailing slash). */
  cdnUrl: process.env.AWS_CLOUDFRONT_URL,
}));
