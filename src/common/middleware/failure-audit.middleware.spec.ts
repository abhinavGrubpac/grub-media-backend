import { EventEmitter } from 'node:events';
import { LogType } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  getAuditSink,
  requestAuditAls,
  setAuditSink,
  type AuditSink,
  type RequestAuditState,
} from '../audit/request-audit';
import { failureAuditMiddleware } from './failure-audit.middleware';

type SinkCall = Parameters<AuditSink['record']>[0];
let calls: SinkCall[] = [];

const sink: AuditSink = {
  record: async (input) => {
    calls.push(input);
  },
};

type FireOptions = {
  path?: string;
  method?: string;
  status?: number;
  ip?: string;
  user?: { id?: string };
  audited?: boolean;
  failure?: { message: string; errorCode: string };
};

/** Runs the middleware, executes `afterNext` inside its ALS context, then finishes the response. */
function fire(opts: FireOptions = {}): SinkCall[] {
  calls = [];
  setAuditSink(sink);
  const req = {
    path: opts.path ?? '/api/v1/users',
    method: opts.method ?? 'GET',
    ip: opts.ip ?? '9.9.9.9',
    user: opts.user,
  } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: opts.status ?? 401,
  }) as unknown as Response;

  failureAuditMiddleware(req, res, () => {
    const state = requestAuditAls.getStore() as RequestAuditState;
    if (opts.audited) state.audited = true;
    if (opts.failure) state.failure = opts.failure;
  });
  res.emit('finish');
  return calls;
}

afterEach(() => {
  setAuditSink(null);
});

describe('failureAuditMiddleware', () => {
  it('records a SYSTEM/Request Failed row for a 401 with no actor', () => {
    const rows = fire({ status: 401 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      typeEnum: LogType.SYSTEM,
      categoryName: 'Request Failure',
      actionName: 'Request Failed',
      actionText: 'GET /api/v1/users failed with 401 from 9.9.9.9',
      target: '9.9.9.9',
      newDetail: { method: 'GET', path: '/api/v1/users', status: 401, ip: '9.9.9.9' },
    });
  });

  it('carries the actor and the stashed failure detail', () => {
    const rows = fire({
      status: 403,
      user: { id: 'u1' },
      failure: { message: 'Forbidden resource', errorCode: 'FORBIDDEN' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].actionText).toBe(
      'GET /api/v1/users failed with 403 for user u1 — Forbidden resource',
    );
    expect(rows[0].userId).toBe('u1');
    expect(rows[0].target).toBe('u1');
    expect(rows[0].newDetail).toMatchObject({
      message: 'Forbidden resource',
      errorCode: 'FORBIDDEN',
    });
  });

  it('audits 5xx responses too', () => {
    expect(fire({ status: 500 })).toHaveLength(1);
  });

  it('still audits when no failure detail was stashed (e.g. unmatched-route 404)', () => {
    const rows = fire({ path: '/api/v1/nope', status: 404 });
    expect(rows).toHaveLength(1);
    expect(rows[0].actionText).toBe('GET /api/v1/nope failed with 404 from 9.9.9.9');
  });

  it('ignores successful responses (endpoints audit their own successes)', () => {
    expect(fire({ status: 200 })).toHaveLength(0);
    expect(fire({ status: 201 })).toHaveLength(0);
    expect(fire({ status: 204 })).toHaveLength(0);
  });

  it('skips requests that already produced their own audit row', () => {
    expect(fire({ status: 401, audited: true })).toHaveLength(0);
  });

  it('excludes health probes, swagger docs and non-api paths', () => {
    expect(fire({ path: '/api/health', status: 503 })).toHaveLength(0);
    expect(fire({ path: '/api/v1/health', status: 503 })).toHaveLength(0);
    expect(fire({ path: '/api/docs', status: 500 })).toHaveLength(0);
    expect(fire({ path: '/api/docs/json', status: 404 })).toHaveLength(0);
    expect(fire({ path: '/favicon.ico', status: 404 })).toHaveLength(0);
    expect(fire({ path: '/', status: 404 })).toHaveLength(0);
  });

  it('has no sink registered → stays silent (never throws)', () => {
    setAuditSink(null);
    expect(getAuditSink()).toBeNull();
    expect(() => fireWithNoSink()).not.toThrow();
  });
});

function fireWithNoSink(): void {
  const req = { path: '/api/v1/users', method: 'GET', ip: '1.1.1.1' } as unknown as Request;
  const res = Object.assign(new EventEmitter(), { statusCode: 401 }) as unknown as Response;
  setAuditSink(null);
  failureAuditMiddleware(req, res, () => undefined);
  res.emit('finish');
}
