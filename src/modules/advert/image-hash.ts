import { BadRequestException } from '@nestjs/common';

/**
 * Reverse-image search primitives (difference hash, 64-bit).
 *
 * The frontend uploads an image; the backend hashes it and ranks adverts by
 * the Hamming distance of their stored `image_hash` (populated at schedule
 * time). dHash is resolution/format invariant for near-duplicates: distance
 * 0 = identical, <=5 = near-duplicate, <=10 = visually similar.
 */
export const IMAGE_HASH_RE = /^[0-9a-fA-F]{16}$/;

export const IMAGE_HASH_BITS = 64;

/** Default/maximum Hamming distance for by-image matches.
 * Industry standard for dHash visual similarity is typically 10 for near-duplicates,
 * but 15-20 provides much better real-world recall for compressed/resized web images. */
export const IMAGE_SEARCH_DEFAULT_MAX_DISTANCE = 18;
export const IMAGE_SEARCH_MAX_DISTANCE = 64;

/** Upper bound for scanned candidates per by-image query (test-phase scale). */
export const IMAGE_SEARCH_CANDIDATE_LIMIT = 500;

/** Max upload size for by-image search (5 MB). */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/** 64-bit difference hash over 9x8 grayscale pixels, as 16 lowercase hex chars. */
export function dHashFromGrayscale(pixels: Buffer, width: number, height: number): string {
  if (pixels.length < width * height) {
    throw new BadRequestException('pixel buffer too small for dHash dimensions');
  }
  let hash = 0n;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      hash = (hash << 1n) | (pixels[y * width + x] > pixels[y * width + x + 1] ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/** dHash for encoded image bytes in any format sharp can decode. */
export async function dHashFromImage(buffer: Buffer): Promise<string> {
  const sharp = (await import('sharp')).default;
  const pixels = await sharp(buffer).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  return dHashFromGrayscale(pixels, 9, 8);
}

/** Hamming distance between two 16-hex-char hashes (case-insensitive). */
export function hammingDistanceHex(a: string, b: string): number {
  if (!IMAGE_HASH_RE.test(a) || !IMAGE_HASH_RE.test(b)) {
    throw new BadRequestException('image hashes must be 16 lowercase hex chars');
  }
  let distance = 0;
  for (let i = 0; i < IMAGE_HASH_BITS; i += 4) {
    const nibble = parseInt(a[i / 4], 16) ^ parseInt(b[i / 4], 16);
    distance += (nibble & 1) + ((nibble >> 1) & 1) + ((nibble >> 2) & 1) + ((nibble >> 3) & 1);
  }
  return distance;
}

export function assertImageHash(value: string): void {
  if (!IMAGE_HASH_RE.test(value)) {
    throw new BadRequestException('image_hash must be a 64-bit dHash: 16 lowercase hex chars');
  }
}
