import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, REQUEST_ID_RESPONSE_HEADER } from '../constants/request.constants';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A client-supplied request id is only reused if it matches a strict, bounded
 * format (UUID, or 8-64 chars of [A-Za-z0-9_-]). This prevents log injection and
 * unbounded/garbage ids from untrusted clients; otherwise a fresh UUID is used.
 */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && (SAFE_ID.test(value) || UUID.test(value));
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    // Prefer a valid client id; otherwise keep an id already assigned upstream
    // (e.g. by pino-http's genReqId, which runs first) so logs and the response
    // header always carry the same value; generate only as a last resort.
    req.id = isValidRequestId(candidate) ? candidate : (req.id ?? randomUUID());
    res.setHeader(REQUEST_ID_RESPONSE_HEADER, req.id);
    next();
  }
}
