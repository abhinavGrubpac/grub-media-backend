import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const makeContext = () => ({
    switchToHttp: () => ({ getResponse: () => ({}), getRequest: () => ({}) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  });

  it('wraps plain data', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('OK msg') };
    const interceptor = new ResponseInterceptor(reflector as never);
    const next = { handle: () => of({ id: '1' }) };

    const result = await lastValueFrom(
      interceptor.intercept(makeContext() as never, next as never),
    );

    expect(result).toEqual({ success: true, message: 'OK msg', data: { id: '1' } });
  });

  it('uses the default message when no @ResponseMessage is present', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const interceptor = new ResponseInterceptor(reflector as never);
    const next = { handle: () => of('value') };

    const result = await lastValueFrom(
      interceptor.intercept(makeContext() as never, next as never),
    );

    expect(result).toEqual({ success: true, message: 'Success', data: 'value' });
  });

  it('lifts meta out of the paginated shape', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const interceptor = new ResponseInterceptor(reflector as never);
    const next = { handle: () => of({ data: [1], meta: { page: 1 } }) };

    const result = await lastValueFrom(
      interceptor.intercept(makeContext() as never, next as never),
    );

    expect(result).toEqual({ success: true, message: 'Success', data: [1], meta: { page: 1 } });
  });
});
