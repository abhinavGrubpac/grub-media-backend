import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreativeQueryDto } from './creative-query.dto';

async function validateQuery(value: Record<string, unknown>) {
  return validate(plainToInstance(CreativeQueryDto, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreativeQueryDto sorting aliases', () => {
  it('accepts the documented snake_case sort query parameters', async () => {
    await expect(validateQuery({ sort_by: 'brand_name', sort_order: 'asc' })).resolves.toHaveLength(
      0,
    );
  });

  it('keeps the camelCase sort aliases working', async () => {
    await expect(validateQuery({ sortBy: 'created_at', sortOrder: 'desc' })).resolves.toHaveLength(
      0,
    );
  });

  it('rejects unknown sort keys', async () => {
    const errors = await validateQuery({ sort_by: 'bogus' });
    expect(errors).toHaveLength(1);
  });
});
