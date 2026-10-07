import { HttpException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { EmailAlreadyExistsException } from '../exceptions/domain.exceptions';

function host(holder: { code?: number; body?: Record<string, unknown> }) {
  const res = {
    status: (c: number) => {
      holder.code = c;
      return res;
    },
    json: (b: Record<string, unknown>) => {
      holder.body = b;
    },
  };
  const req = { url: '/api/v1/users', id: 'req-123' };
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as never;
}

describe('AllExceptionsFilter', () => {
  it('formats an HttpException into the standard envelope', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    new AllExceptionsFilter().catch(new BadRequestException('bad input'), host(holder));
    expect(holder.code).toBe(400);
    expect(holder.body).toMatchObject({
      success: false,
      statusCode: 400,
      errorCode: 'BAD_REQUEST',
      path: '/api/v1/users',
      requestId: 'req-123',
      message: 'bad input',
    });
    expect(holder.body?.timestamp).toBeDefined();
  });

  it('flattens class-validator message arrays and keeps VALIDATION_ERROR code', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    const exception = new BadRequestException({
      message: ['email must be an email', 'password too short'],
      errorCode: 'VALIDATION_ERROR',
    });
    new AllExceptionsFilter().catch(exception, host(holder));
    expect(holder.code).toBe(400);
    expect(holder.body?.errorCode).toBe('VALIDATION_ERROR');
    expect(holder.body?.message).toBe('email must be an email, password too short');
  });

  it('maps Prisma P2002 to 409 CONFLICT', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    const err = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      clientVersion: '6',
      name: 'PrismaClientKnownRequestError',
    });
    new AllExceptionsFilter().catch(err, host(holder));
    expect(holder.code).toBe(409);
    expect(holder.body?.errorCode).toBe('CONFLICT');
  });

  it('maps Prisma P2025 to 404 NOT_FOUND', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    const err = Object.assign(new Error('not found'), {
      code: 'P2025',
      clientVersion: '6',
      name: 'PrismaClientKnownRequestError',
    });
    new AllExceptionsFilter().catch(err, host(holder));
    expect(holder.code).toBe(404);
    expect(holder.body?.errorCode).toBe('NOT_FOUND');
  });

  it('maps a 429 HttpException (no errorCode in body) to TOO_MANY_REQUESTS', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    new AllExceptionsFilter().catch(new HttpException('rate limited', 429), host(holder));
    expect(holder.code).toBe(429);
    expect(holder.body?.errorCode).toBe('TOO_MANY_REQUESTS');
  });

  it('preserves a domain exception errorCode end to end (EmailAlreadyExists → CONFLICT)', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    new AllExceptionsFilter().catch(new EmailAlreadyExistsException(), host(holder));
    expect(holder.code).toBe(409);
    expect(holder.body?.errorCode).toBe('CONFLICT');
    expect(holder.body?.message).toBe('Email already in use');
  });

  it('falls back to a generic 500 for an unrecognised Prisma error code', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    const err = Object.assign(new Error('fk violation'), {
      code: 'P2003',
      clientVersion: '6',
      name: 'PrismaClientKnownRequestError',
    });
    new AllExceptionsFilter().catch(err, host(holder));
    expect(holder.code).toBe(500);
    expect(holder.body?.errorCode).toBe('INTERNAL_ERROR');
  });

  it('hides unexpected errors as a generic 500 (no internal detail leaked)', () => {
    const holder: { code?: number; body?: Record<string, unknown> } = {};
    new AllExceptionsFilter().catch(new Error('db password is hunter2'), host(holder));
    expect(holder.code).toBe(500);
    expect(holder.body?.message).toBe('Internal server error');
    expect(holder.body?.errorCode).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(holder.body)).not.toContain('hunter2');
  });
});
