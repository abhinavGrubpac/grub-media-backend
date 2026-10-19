import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { ActivityLogService } from '../activity-log/activity-log.service';

export const UPSTREAM_EVENT_ID_HEADER = 'x-upstream-event-id';
export const UPSTREAM_PORTAL_HEADER = 'x-upstream-portal';

/**
 * Upstream attribution (UPSTREAM_INTEGRATION_API.md §10.3). Captures the
 * agency/admin portal headers into ActivityLog after a successful handler
 * run. Requests without upstream headers pass through untouched.
 */
@Injectable()
export class UpstreamAttributionInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(async () => {
        const req = context.switchToHttp().getRequest() as {
          headers?: Record<string, unknown>;
          id?: unknown;
          ip?: string;
          method?: string;
          route?: { path?: string };
        };
        const headers = req.headers ?? {};
        const eventId = headers[UPSTREAM_EVENT_ID_HEADER];
        const portal = headers[UPSTREAM_PORTAL_HEADER];
        if (typeof eventId !== 'string' && typeof portal !== 'string') return;
        await this.activity.record({
          action: `${req.method ?? 'UNKNOWN'} ${req.route?.path ?? 'unknown-route'}`,
          entityType: 'UpstreamCall',
          requestId: typeof req.id === 'string' ? req.id : null,
          ip: req.ip ?? null,
          upstreamEventId: typeof eventId === 'string' ? eventId : null,
          upstreamPortal: typeof portal === 'string' ? portal : null,
        });
      }),
    );
  }
}
