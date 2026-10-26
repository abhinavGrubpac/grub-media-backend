import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdvertListQueryDto } from './advert-list-query.dto';

async function validateQuery(value: Record<string, unknown>) {
  return validate(plainToInstance(AdvertListQueryDto, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('AdvertListQueryDto status filter', () => {
  it('accepts a single status', async () => {
    const query = plainToInstance(AdvertListQueryDto, { status: 'REVOKED' });

    await expect(validateQuery({ status: 'REVOKED' })).resolves.toHaveLength(0);
    expect(query.status).toEqual(['REVOKED']);
  });

  it('accepts comma-separated and repeated multi-status values', async () => {
    const comma = plainToInstance(AdvertListQueryDto, { status: 'live,PAUSED' });
    const repeated = plainToInstance(AdvertListQueryDto, { status: ['LIVE', 'PAUSED'] });

    await expect(validateQuery({ status: 'LIVE,PAUSED' })).resolves.toHaveLength(0);
    expect(comma.status).toEqual(['LIVE', 'PAUSED']);
    expect(repeated.status).toEqual(['LIVE', 'PAUSED']);
  });

  it('rejects unknown statuses and empty values are treated as no filter', async () => {
    await expect(validateQuery({ status: 'LIVE,ENDED' })).resolves.toHaveLength(1);
    const empty = plainToInstance(AdvertListQueryDto, { status: '' });
    await expect(validateQuery({ status: '' })).resolves.toHaveLength(0);
    expect(empty.status).toBeUndefined();
  });
});
