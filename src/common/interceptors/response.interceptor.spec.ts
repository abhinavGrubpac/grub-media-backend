import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function ctx() {
  return {
    switchToHttp: () => ({ getResponse: () => ({}), getRequest: () => ({}) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

describe('ResponseInterceptor', () => {
  it('wraps plain data with the @ResponseMessage value', async () => {
    const reflector = { getAllAndOverride: () => 'OK msg' } as never;
    const interceptor = new ResponseInterceptor(reflector);
    const next = { handle: () => of({ id: '1' }) };
    const result = await lastValueFrom(interceptor.intercept(ctx(), next as never));
    expect(result).toEqual({ success: true, message: 'OK msg', data: { id: '1' } });
  });

  it('defaults the message to "Success" when no decorator is set', async () => {
    const reflector = { getAllAndOverride: () => undefined } as never;
    const interceptor = new ResponseInterceptor(reflector);
    const next = { handle: () => of(42) };
    const result = await lastValueFrom(interceptor.intercept(ctx(), next as never));
    expect(result).toEqual({ success: true, message: 'Success', data: 42 });
  });

  it('lifts meta out of a paginated {data,meta} payload', async () => {
    const reflector = { getAllAndOverride: () => undefined } as never;
    const interceptor = new ResponseInterceptor(reflector);
    const next = { handle: () => of({ data: [1, 2], meta: { page: 1 } }) };
    const result = await lastValueFrom(interceptor.intercept(ctx(), next as never));
    expect(result).toEqual({ success: true, message: 'Success', data: [1, 2], meta: { page: 1 } });
  });

  it('does NOT treat a plain {data,meta} object as paginated unless data is an array', async () => {
    const reflector = { getAllAndOverride: () => undefined } as never;
    const interceptor = new ResponseInterceptor(reflector);
    const payload = { data: { id: 'u1' }, meta: { note: 'not pagination' } };
    const next = { handle: () => of(payload) };
    const result = await lastValueFrom(interceptor.intercept(ctx(), next as never));
    expect(result).toEqual({ success: true, message: 'Success', data: payload });
  });

  it('wraps null payloads as data:null', async () => {
    const reflector = { getAllAndOverride: () => 'done' } as never;
    const interceptor = new ResponseInterceptor(reflector);
    const next = { handle: () => of(null) };
    const result = await lastValueFrom(interceptor.intercept(ctx(), next as never));
    expect(result).toEqual({ success: true, message: 'done', data: null });
  });
});
