import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { RESPONSE_MESSAGE } from '../decorators/response-message.decorator';
import { SKIP_RESPONSE_WRAP } from '../decorators/skip-response-wrap.decorator';

export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  meta?: unknown;
}

function isPaginated(payload: unknown): payload is { data: unknown[]; meta: unknown } {
  // Require `data` to be an array so a non-paginated object that merely happens
  // to carry `data`/`meta` keys is NOT mistaken for a paginated result.
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'meta' in payload &&
    'data' in payload &&
    Array.isArray((payload as { data: unknown }).data)
  );
}

/**
 * Wraps controller return values in the standard success envelope at the HTTP
 * boundary. A paginated `{ data, meta }` payload is passed through with its meta
 * lifted; everything else becomes `data`. The message comes from @ResponseMessage.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<unknown> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<unknown> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_WRAP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'Success';

    return next.handle().pipe(
      map((payload): ApiSuccessResponse<unknown> => {
        if (isPaginated(payload)) {
          return { success: true, message, data: payload.data, meta: payload.meta };
        }
        return { success: true, message, data: payload };
      }),
    );
  }
}
