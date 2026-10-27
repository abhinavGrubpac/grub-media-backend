import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap, catchError } from 'rxjs';
import type { Request } from 'express';
import { LogType } from '@prisma/client';
import { LogsService } from '../../modules/logs/services/logs.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

/**
 * Logs EMPLOYEE activities for all successful authenticated requests.
 * Records actions like profile views, updates, login, logout, etc.
 *
 * Mapped to routes via @UseInterceptors(EmployeeActivityLogInterceptor)
 * or globally in app.module.
 */
@Injectable()
export class EmployeeActivityLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EmployeeActivityLogInterceptor.name);

  constructor(private readonly logs: LogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const res = context.switchToHttp().getResponse();
    const userId = req.user?.id;

    if (!userId) {
      return next.handle();
    }

    const { method, path, route } = req;
    const fullPath = route?.path || path || 'unknown';
    const pathLower = fullPath.toLowerCase();

    // Skip logging for these endpoints - they generate too much noise or shouldn't be audited
    if (
      pathLower.includes('/logs/') ||
      pathLower.includes('/auth/me') ||
      pathLower.includes('/auth/refresh') ||
      pathLower.includes('/health')
    ) {
      return next.handle();
    }

    const statusCode = res.statusCode ?? 200;

    return next.handle().pipe(
      tap(() => {
        // Only log successful requests (2xx status)
        if (statusCode >= 200 && statusCode < 300) {
          this.recordEmployeeActivity(userId, method, fullPath).catch((err) => {
            this.logger.warn(
              `Failed to record employee activity: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }),
      catchError((err) => {
        throw err;
      }),
    );
  }

  private async recordEmployeeActivity(
    userId: string,
    method: string,
    path: string,
  ): Promise<void> {
    // Map endpoint to user-friendly action names
    const actionInfo = this.mapEndpointToAction(method, path);

    // Skip if no mapping found
    if (!actionInfo) {
      return;
    }

    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: actionInfo.category,
      actionName: actionInfo.action,
      actionText: actionInfo.description,
      userId,
    });
  }

  /**
   * Maps HTTP method + path to human-readable action descriptions.
   * Customize this based on your actual endpoints.
   */
  private mapEndpointToAction(
    method: string,
    path: string,
  ): { category: string; action: string; description: string } {
    const pathLower = path.toLowerCase();

    // Authentication flows
    if (pathLower.includes('/auth/login') && method === 'POST') {
      return {
        category: 'Authentication',
        action: 'Login',
        description: 'Successfully logged into the system',
      };
    }
    if (pathLower.includes('/auth/logout')) {
      return {
        category: 'Authentication',
        action: 'Logout',
        description: 'Logged out from the system',
      };
    }

    // Profile management
    if (pathLower.includes('/users/profile')) {
      if (method === 'GET') {
        return {
          category: 'Profile',
          action: 'View Profile',
          description: 'Viewed personal profile',
        };
      }
      if (method === 'PATCH') {
        return {
          category: 'Profile',
          action: 'Update Profile',
          description: 'Updated profile information',
        };
      }
    }

    // Password management
    if (pathLower.includes('/users/profile/password')) {
      if (method === 'POST') {
        return {
          category: 'Security',
          action: 'Change Password',
          description: 'Changed password',
        };
      }
    }
    if (pathLower.includes('/users/profile/set-password')) {
      return {
        category: 'Security',
        action: 'Set Password',
        description: 'Set new password',
      };
    }

    // OTP verification
    if (pathLower.includes('/users/profile/otp-verify')) {
      return {
        category: 'Security',
        action: 'Verify OTP',
        description: 'Verified OTP for contact verification',
      };
    }
    if (pathLower.includes('/users/profile/otp-request')) {
      return {
        category: 'Security',
        action: 'Request OTP',
        description: 'Requested OTP for contact verification',
      };
    }

    // User listing (for admins/employees with permission)
    if (pathLower.includes('/users') && method === 'GET' && !pathLower.includes('/profile')) {
      return {
        category: 'Employment',
        action: 'List Users',
        description: 'Viewed the employee directory',
      };
    }

    // Generic fallback (only for significant methods)
    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
      return {
        category: 'System',
        action: `${method} Request`,
        description: `Performed ${method} on ${path}`,
      };
    }

    // Don't log GET requests that weren't already mapped
    return null as never;
  }
}
