import { AsyncLocalStorage } from 'node:async_hooks';
import type { RecordLogInput } from '../../modules/logs/dto/log.types';

/**
 * Per-request audit state shared between the HTTP layer and LogsService.
 *
 * Every failed request (HTTP >= 400) is audited generically as
 * SYSTEM/'Request Failed', but endpoints that already record their own row
 * for a failure (e.g. 'Failed Login', 'Failed OTP') must not receive a
 * second, duplicate row — LogsService.record() flips `audited` for the
 * current request. The global exception filter also stashes the resolved
 * error detail here so the generic row can carry the message/errorCode the
 * client saw.
 */
export interface RequestAuditState {
  /** True once LogsService.record() has produced a row for this request. */
  audited: boolean;
  /** Resolved error detail, set by AllExceptionsFilter before it responds. */
  failure?: { message: string; errorCode: string };
}

export const requestAuditAls = new AsyncLocalStorage<RequestAuditState>();

/**
 * Marks the current request as already audited (idempotent; a no-op when
 * called outside an HTTP request, e.g. from seeds or scripts).
 */
export function markRequestAudited(): void {
  const store = requestAuditAls.getStore();
  if (store) store.audited = true;
}

/** Minimal writer surface the failure auditor needs — LogsService registers itself. */
export interface AuditSink {
  record(input: RecordLogInput): Promise<void>;
}

let sink: AuditSink | null = null;

export function setAuditSink(instance: AuditSink | null): void {
  sink = instance;
}

export function getAuditSink(): AuditSink | null {
  return sink;
}
