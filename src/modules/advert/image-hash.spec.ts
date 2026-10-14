import { BadRequestException } from '@nestjs/common';
import { assertImageHash, dHashFromGrayscale, hammingDistanceHex } from './image-hash';

describe('dHashFromGrayscale', () => {
  it('hashes a uniform field to zero', () => {
    const pixels = Buffer.alloc(9 * 8, 128);
    expect(dHashFromGrayscale(pixels, 9, 8)).toBe('0000000000000000');
  });

  it('hashes a right-to-left gradient to all ones', () => {
    const pixels = Buffer.alloc(9 * 8);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        pixels[y * 9 + x] = 224 - x * 28;
      }
    }
    expect(dHashFromGrayscale(pixels, 9, 8)).toBe('ffffffffffffffff');
  });

  it('rejects undersized buffers', () => {
    expect(() => dHashFromGrayscale(Buffer.alloc(10), 9, 8)).toThrow(BadRequestException);
  });
});

describe('hammingDistanceHex', () => {
  it('measures bit differences', () => {
    expect(hammingDistanceHex('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistanceHex('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistanceHex('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistanceHex('ff00ff00ff00ff00', '00ff00ff00ff00ff')).toBe(64);
  });

  it('rejects malformed hashes', () => {
    expect(() => hammingDistanceHex('xyz', '0000000000000000')).toThrow(BadRequestException);
    expect(() => assertImageHash('ABCDEF1234567890')).not.toThrow();
    expect(() => assertImageHash('too-short')).toThrow(BadRequestException);
  });
});
