import { BadRequestException, ConflictException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface StatusHolder {
  code?: number;
  body?: unknown;
}

describe('AllExceptionsFilter', () => {
  const makeHost = (holder: StatusHolder) => {
    const res = {
      status: (code: number) => {
        holder.code = code;
        return res;
      },
      json: (body: unknown) => {
        holder.body = body;
      },
    };
    const req = { url: '/api/v1/brands', id: 'req-123' };
    return { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) };
  };

  it('formats an HttpException into the standard error envelope', () => {
    const holder: StatusHolder = {};
    new AllExceptionsFilter().catch(new BadRequestException('bad'), makeHost(holder) as never);

    expect(holder.code).toBe(400);
    expect(holder.body).toMatchObject({
      success: false,
      statusCode: 400,
      errorCode: 'BAD_REQUEST',
      path: '/api/v1/brands',
      requestId: 'req-123',
    });
    expect(holder.body).toHaveProperty('message', 'bad');
    expect(holder.body).toHaveProperty('timestamp');
  });

  it('keeps a domain errorCode and maps bare statuses to codes', () => {
    const holder: StatusHolder = {};
    new AllExceptionsFilter().catch(
      new ConflictException({ message: 'nope', errorCode: 'CONFLICT' }),
      makeHost(holder) as never,
    );

    expect(holder.code).toBe(409);
    expect(holder.body).toMatchObject({ statusCode: 409, errorCode: 'CONFLICT', message: 'nope' });
  });

  it('joins ValidationPipe message arrays', () => {
    const holder: StatusHolder = {};
    new AllExceptionsFilter().catch(
      new BadRequestException(['a must exist', 'b must be a string']),
      makeHost(holder) as never,
    );

    expect(holder.body).toHaveProperty('message', 'a must exist, b must be a string');
  });

  it('maps Prisma P2002 to 409 CONFLICT', () => {
    const holder: StatusHolder = {};
    const err = Object.assign(new Error('unique'), {
      code: 'P2002',
      clientVersion: '6',
      name: 'PrismaClientKnownRequestError',
    });
    new AllExceptionsFilter().catch(err, makeHost(holder) as never);

    expect(holder.code).toBe(409);
    expect(holder.body).toHaveProperty('errorCode', 'CONFLICT');
  });

  it('maps Prisma P2025 to 404 NOT_FOUND', () => {
    const holder: StatusHolder = {};
    const err = Object.assign(new Error('missing'), {
      code: 'P2025',
      clientVersion: '6',
      name: 'PrismaClientKnownRequestError',
    });
    new AllExceptionsFilter().catch(err, makeHost(holder) as never);

    expect(holder.code).toBe(404);
    expect(holder.body).toHaveProperty('errorCode', 'NOT_FOUND');
  });

  it('hides internal errors behind a generic 500 envelope', () => {
    const holder: StatusHolder = {};
    new AllExceptionsFilter().catch(new Error('db exploded'), makeHost(holder) as never);

    expect(holder.code).toBe(500);
    expect(holder.body).toMatchObject({
      message: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    });
  });
});
