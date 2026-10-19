import { plainToInstance } from 'class-transformer';
import { CreateCreativeDto } from './create-creative.dto';
import { CreativeFinalizeDto } from './creative-finalize.dto';

/**
 * Pasted Postman variables often carry invisible leading/trailing whitespace,
 * which makes valid ids miss (clean 404s). These transforms strip it at the
 * DTO boundary, mirroring ValidationPipe(transform: true) behavior.
 */
describe('creative id trimming', () => {
  it('trims brand_id/creative_id on finalize', () => {
    const dto = plainToInstance(CreativeFinalizeDto, {
      brand_id: '  b1  ',
      creative_id: '\tc1\n',
      s3_key: 'k',
      media_type: 'Image',
    });
    expect(dto.brand_id).toBe('b1');
    expect(dto.creative_id).toBe('c1');
  });

  it('trims brand_id on create', () => {
    const dto = plainToInstance(CreateCreativeDto, {
      brand_id: '  b2  ',
      creative_name: 'N',
    });
    expect(dto.brand_id).toBe('b2');
  });

  it('leaves non-strings untouched', () => {
    const dto = plainToInstance(CreativeFinalizeDto, {
      s3_key: 'k',
      media_type: 'Image',
    });
    expect(dto.brand_id).toBeUndefined();
  });
});
