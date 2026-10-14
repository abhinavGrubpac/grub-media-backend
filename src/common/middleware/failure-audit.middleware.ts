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
  const failure = state.failure;
  const who = userId ? ` for user ${userId}` : ` from ${req.ip ?? 'unknown'}`;
  const reason = failure ? ` — ${failure.message}` : '';
  // record() swallows its own errors; the extra .catch is belt-and-braces so
  // a fire-and-forget audit can never surface as an unhandled rejection.
  void getAuditSink()
    ?.record({
      typeEnum: LogType.SYSTEM,
      categoryName: 'Request Failure',
      actionName: 'Request Failed',
      actionText: `${req.method} ${path} failed with ${res.statusCode}${who}${reason}`,
      userId,
      target: userId ?? req.ip ?? 'unknown',
      newDetail: {
        method: req.method,
        path,
        status: res.statusCode,
        ip: req.ip,
        message: failure?.message,
        errorCode: failure?.errorCode,
      },
    })
    .catch(() => undefined);
}
