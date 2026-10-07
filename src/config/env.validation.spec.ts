import { validate } from './env.validation';

const base = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  JWT_REFRESH_SECRET: 'y'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  CORS_ORIGINS: 'http://localhost:3000',
};

describe('validate', () => {
  it('passes with valid env', () => {
    expect(() => validate(base)).not.toThrow();
  });

  it('coerces numeric strings to numbers', () => {
    const result = validate(base);
    expect(result.PORT).toBe(3000);
    expect(result.REDIS_PORT).toBe(6379);
  });

  it('throws when JWT_ACCESS_SECRET too short', () => {
    expect(() => validate({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow();
  });

  it('throws when DATABASE_URL missing', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => validate(rest)).toThrow();
  });

  it('throws when NODE_ENV is not a known environment', () => {
    expect(() => validate({ ...base, NODE_ENV: 'staging' })).toThrow();
  });

  it('allows optional REDIS_PASSWORD and LOG_LEVEL to be absent', () => {
    expect(() => validate(base)).not.toThrow();
  });
});
