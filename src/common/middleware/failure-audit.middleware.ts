import { LogType } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { getAuditSink, requestAuditAls, type RequestAuditState } from '../audit/request-audit';

/** Public LB probe (no actor — would flood the stream) + swagger UI assets. */
const EXCLUDED_PATHS = ['/api/health', '/api/v1/health'];
const EXCLUDED_PREFIXES = ['/api/docs'];

interface MaybeUser {
  user?: { id?: string };
}

/**
 * Audits FAILED API requests as SYSTEM / 'Request Failed' rows.
 *
 * Mounted first in main.ts so the whole request chain (including the
 * body-parser and any express-level rejection) runs inside an
 * AsyncLocalStorage context. On response finish:
 *  - status < 400 → nothing: endpoints audit their own successes;
 *  - health / swagger / non-/api paths → excluded (probes, docs, UI assets);
 *  - `state.audited` → skipped: the handler already wrote its own row for
 *    this request (e.g. 'Failed Login'), so no duplicate is added.
 */
export function failureAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const state: RequestAuditState = { audited: false };
  requestAuditAls.run(state, () => {
    // `state` is closed over explicitly: the finish event fires from the
    // socket's async context, where an ALS lookup is not guaranteed.
    res.on('finish', () => recordFailure(state, req, res));
    next();
  });
}

function recordFailure(state: RequestAuditState, req: Request, res: Response): void {
  if (state.audited || res.statusCode < 400) return;
  const path = req.path;
  if (!path.startsWith('/api')) return;
  if (EXCLUDED_PATHS.includes(path) || EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return;

  const userId = (req as unknown as MaybeUser).user?.id;
  const reason = humanReason(res.statusCode, Boolean(userId));
  const actionText =
    res.statusCode >= 500
      ? `A request to ${path} failed because ${reason}`
      : `A request to ${path} was rejected because ${reason}`;
  // The sentence above stays plain English; the machine details (HTTP method,
  // status code, IP, raw error message) live in newDetail, which free-text
  // search covers too. record() swallows its own errors; the extra .catch is
  // belt-and-braces so a fire-and-forget audit can never become an unhandled
  // rejection.
  void getAuditSink()
    ?.record({
      typeEnum: LogType.SYSTEM,
      categoryName: 'Request Failure',
      actionName: 'Request Failed',
      actionText,
      userId,
      target: userId ?? req.ip ?? 'unknown',
      newDetail: {
        method: req.method,
        path,
        status: res.statusCode,
        ip: req.ip,
        message: state.failure?.message,
        errorCode: state.failure?.errorCode,
      },
    })
    .catch(() => undefined);
}

/** Maps an HTTP status to a plain-English reason anyone can understand. */
function humanReason(status: number, signedIn: boolean): string {
  if (status >= 500) return 'an internal error occurred on the server';
  switch (status) {
    case 400:
      return 'the request was malformed or invalid';
    case 401:
      return 'no valid sign-in was presented';
    case 403:
      return signedIn
        ? 'the signed-in user does not have permission for this'
        : 'permission was denied';
    case 404:
      return 'that address does not exist';
    case 405:
      return 'that type of request is not allowed here';
    case 408:
      return 'the request took too long';
    case 409:
      return 'it conflicts with data that already exists';
    case 413:
      return 'the request was too large';
    case 422:
      return 'the request could not be processed as sent';
    case 429:
      return 'too many requests were sent in a short time';
    default:
      return 'the server would not accept the request';
  }
}
