import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ERROR_CODES } from '../constants/error-codes';

interface ErrorEnvelope {
  success: false;
  statusCode: number;
  message: string;
  errorCode: string;
  timestamp: string;
  path: string;
  requestId?: string;
}

interface ResolvedError {
  status: number;
  message: string;
  errorCode: string;
}

const STATUS_TO_CODE: Record<number, string> = {
  400: ERROR_CODES.BAD_REQUEST,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  429: ERROR_CODES.TOO_MANY_REQUESTS,
};

/**
 * Global exception filter. Produces a single consistent error envelope and
 * never leaks stack traces / internal detail in responses. Unexpected errors
 * are logged internally (with the request id) and returned as a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{ status: (c: number) => { json: (b: ErrorEnvelope) => void } }>();
    const req = http.getRequest<{ url: string; id?: string }>();

    const { status, message, errorCode } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { err: exception, requestId: req.id, path: req.url },
        'Unhandled exception',
      );
    }

    const body: ErrorEnvelope = {
      success: false,
      statusCode: status,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: req.url,
      requestId: req.id,
    };
    res.status(status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    const prisma = this.fromPrismaError(exception);
    if (prisma) {
      return prisma;
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorCode: ERROR_CODES.INTERNAL_ERROR,
    };
  }

  private fromHttpException(exception: HttpException): ResolvedError {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const body: Record<string, unknown> =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : { message: response };
    const rawMessage = body.message ?? exception.message;
    const message = Array.isArray(rawMessage)
      ? (rawMessage as string[]).join(', ')
      : String(rawMessage);
    const errorCode =
      typeof body.errorCode === 'string' ? body.errorCode : this.statusToCode(status);
    return { status, message, errorCode };
  }

  private fromPrismaError(exception: unknown): ResolvedError | null {
    if (!this.isPrismaKnownError(exception)) {
      return null;
    }
    const code = exception.code;
    if (code === 'P2002') {
      return { status: 409, message: 'Resource already exists', errorCode: ERROR_CODES.CONFLICT };
    }
    if (code === 'P2025') {
      return { status: 404, message: 'Resource not found', errorCode: ERROR_CODES.NOT_FOUND };
    }
    return null;
  }

  private isPrismaKnownError(e: unknown): e is { code: string; name: string } {
    return (
      typeof e === 'object' &&
      e !== null &&
      (e as { name?: unknown }).name === 'PrismaClientKnownRequestError' &&
      typeof (e as { code?: unknown }).code === 'string'
    );
  }

  private statusToCode(status: number): string {
    return STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;
  }
}
