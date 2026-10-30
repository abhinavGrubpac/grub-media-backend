import { registerAs } from '@nestjs/config';

/**
 * S3 media storage. The government portal never buffers binaries: reviewers
 * upload reference documents via presigned PUT URLs, agency media arrives as
 * bucket keys through intake. Credentials are optional — without them the
 * storage layer runs in local mock mode.
 */
export default registerAs('storage', () => ({
  bucket: process.env.AWS_S3_BUCKET || undefined,
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
}));
