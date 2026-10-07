import { isValidRequestId, RequestIdMiddleware } from './request-id.middleware';

describe('isValidRequestId', () => {
  it('accepts a safe token id', () => {
    expect(isValidRequestId('abc_123-XY')).toBe(true);
  });

  it('accepts a uuid', () => {
    expect(isValidRequestId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('rejects too-short, too-long, and injection-y values', () => {
    expect(isValidRequestId('short1')).toBe(false); // < 8 chars
    expect(isValidRequestId('x'.repeat(200))).toBe(false);
    expect(isValidRequestId('bad\ninjection')).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(['a', 'b'])).toBe(false);
  });
});

describe('RequestIdMiddleware', () => {
  it('reuses a valid client-supplied id and echoes it', () => {
    const req = { headers: { 'x-request-id': 'client_1234' } } as never;
    const setHeader = jest.fn();
    const next = jest.fn();
    new RequestIdMiddleware().use(req, { setHeader } as never, next);
    expect((req as { id: string }).id).toBe('client_1234');
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', 'client_1234');
    expect(next).toHaveBeenCalled();
  });

  it('generates a uuid when the client id is invalid', () => {
    const req = { headers: { 'x-request-id': 'bad\nvalue' } } as never;
    const setHeader = jest.fn();
    new RequestIdMiddleware().use(req, { setHeader } as never, jest.fn());
    expect((req as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates a uuid when no header is present and echoes it', () => {
    const req = { headers: {} } as never;
    const setHeader = jest.fn();
    new RequestIdMiddleware().use(req, { setHeader } as never, jest.fn());
    const id = (req as { id: string }).id;
    expect(id).toHaveLength(36);
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', id);
  });

  it('uses the first value when the header is delivered as an array', () => {
    const req = { headers: { 'x-request-id': ['valid_id_abc', 'other'] } } as never;
    const setHeader = jest.fn();
    new RequestIdMiddleware().use(req, { setHeader } as never, jest.fn());
    expect((req as { id: string }).id).toBe('valid_id_abc');
  });
});
