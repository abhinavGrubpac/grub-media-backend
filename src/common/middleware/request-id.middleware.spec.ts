import { RequestIdMiddleware, isValidRequestId } from './request-id.middleware';

describe('isValidRequestId', () => {
  it('accepts safe ids', () => {
    expect(isValidRequestId('abc_123-XY')).toBe(true);
    expect(isValidRequestId('0e0c4d64-ed41-4d3f-8f5f-0e6e26a1b9c3')).toBe(true);
  });

  it('rejects too-long / injection values', () => {
    expect(isValidRequestId('x'.repeat(200))).toBe(false);
    expect(isValidRequestId('bad\ninjection')).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
  });
});

describe('RequestIdMiddleware', () => {
  const makeRes = () => ({ setHeader: jest.fn() });

  it('reuses a valid client id', () => {
    const req: { headers: Record<string, string>; id?: string } = {
      headers: { 'x-request-id': 'client_1234' },
    };
    const res = makeRes();
    new RequestIdMiddleware().use(req as never, res as never, () => {});

    expect(req.id).toBe('client_1234');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'client_1234');
  });

  it('generates a uuid when the client id is invalid', () => {
    const req: { headers: Record<string, string>; id?: string } = {
      headers: { 'x-request-id': 'bad\nvalue' },
    };
    const res = makeRes();
    new RequestIdMiddleware().use(req as never, res as never, () => {});

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
  });

  it('generates a uuid when no header is sent', () => {
    const req: { headers: Record<string, string>; id?: string } = { headers: {} };
    new RequestIdMiddleware().use(req as never, makeRes() as never, () => {});

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
