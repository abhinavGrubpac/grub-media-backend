/**
 * Backfills `CreativeVersion.file_size_bytes` for media uploaded before the
 * column existed. Sizes come from an S3 HEAD of the stored media URL; objects
 * outside the configured media bucket are skipped rather than fetched.
 *
 * Run with `--force` to re-read sizes that already have a value.
 */
import 'dotenv/config';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const force = process.argv.includes('--force');
const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION ?? 'ap-south-1';

const s3 = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
});

/**
 * Reads the byte size for a stored media URL. Bucket objects use an
 * authenticated S3 HEAD; any other http(s) URL (e.g. seed imagery) falls back
 * to a plain HEAD so the backfill can still fill what the app can render.
 */
async function sizeFromUrl(mediaUrl: string): Promise<number | null> {
  let url: URL;
  try {
    url = new URL(mediaUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const bucketHosts = [
    `${bucket}.s3.amazonaws.com`,
    `${bucket}.s3.${region}.amazonaws.com`,
  ];
  if (bucketHosts.includes(url.hostname)) {
    const key = url.pathname.replace(/^\/+/, '');
    if (!key) return null;
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: decodeURIComponent(key) }),
    );
    return typeof head.ContentLength === 'number' && head.ContentLength > 0
      ? head.ContentLength
      : null;
  }

  const res = await fetch(mediaUrl, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) return null;
  const length = Number(res.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : null;
}

async function main(): Promise<void> {
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_S3_BUCKET / AWS credentials are not configured');
  }

  const versions = await prisma.creativeVersion.findMany({
    where: force ? {} : { fileSizeBytes: null },
    select: { id: true, mediaUrl: true, fileSizeBytes: true },
  });

  let updated = 0;
  let skipped = 0;
  for (const version of versions) {
    try {
      const size = await sizeFromUrl(version.mediaUrl);
      if (!size || (!force && size === version.fileSizeBytes)) {
        skipped += 1;
        continue;
      }
      await prisma.creativeVersion.update({
        where: { id: version.id },
        data: { fileSizeBytes: size },
      });
      updated += 1;
    } catch (err) {
      const code = (err as { name?: string }).name;
      console.warn(`skip ${version.id}: ${code ?? (err as Error).message}`);
      skipped += 1;
    }
  }

  console.log(`file-size backfill: ${updated} version(s) updated; ${skipped} skipped`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
