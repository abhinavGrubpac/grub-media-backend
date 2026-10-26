/**
 * Backfills perceptual image hashes used by reverse-image search.
 *
 * - APPROVED creative versions missing image_hash (government approvals that
 *   have no Advert row yet).
 * - Adverts missing image_hash (bookings created before auto-indexing).
 *
 * Only objects in the configured media bucket are fetched; other URLs are
 * skipped. Run with `--force` to recompute hashes that already exist (useful
 * after switching hash algorithms or clearing placeholder seed values).
 */
import 'dotenv/config';
import { PrismaClient, ReviewStatus } from '@prisma/client';
import { allowedImageHosts, dHashFromImageUrl } from '../src/modules/advert/image-hash-indexer';

const prisma = new PrismaClient();
const force = process.argv.includes('--force');
const bucket = process.env.AWS_S3_BUCKET;
const region = process.env.AWS_REGION ?? 'ap-south-1';
const allowedHosts = allowedImageHosts(bucket, region);

async function main(): Promise<void> {
  if (allowedHosts.length === 0) {
    throw new Error('AWS_S3_BUCKET is not configured; cannot index media URLs');
  }

  const versions = await prisma.creativeVersion.findMany({
    where: {
      status: ReviewStatus.APPROVED,
      ...(force ? {} : { imageHash: null }),
    },
    select: { id: true, mediaUrl: true, imageHash: true },
  });

  let versionUpdates = 0;
  let skipped = 0;
  for (const version of versions) {
    const hash = await dHashFromImageUrl(version.mediaUrl, allowedHosts);
    if (!hash || hash === version.imageHash) {
      skipped += 1;
      continue;
    }
    await prisma.creativeVersion.update({
      where: { id: version.id },
      data: { imageHash: hash },
    });
    versionUpdates += 1;
  }

  const adverts = await prisma.advert.findMany({
    where: force ? {} : { imageHash: null },
    select: { id: true, imageHash: true, version: { select: { mediaUrl: true } } },
  });

  let advertUpdates = 0;
  for (const advert of adverts) {
    const hash = await dHashFromImageUrl(advert.version.mediaUrl, allowedHosts);
    if (!hash || hash === advert.imageHash) {
      skipped += 1;
      continue;
    }
    await prisma.advert.update({
      where: { id: advert.id },
      data: { imageHash: hash },
    });
    advertUpdates += 1;
  }

  console.log(
    `image-hash backfill: ${versionUpdates} version(s), ${advertUpdates} advert(s) updated; ${skipped} skipped`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
