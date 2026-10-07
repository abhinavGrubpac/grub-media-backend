import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ERROR_CODES } from '../constants/error-codes';

interface ErrorRequest {
  url?: string;
  id?: string;
}

interface ErrorResponse {
  status(code: number): { json(body: unknown): void };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<ErrorResponse>();
    const req = http.getRequest<ErrorRequest>();
    const { status, message, errorCode } = this.resolve(exception);
    if (status >= 500) {
      this.logger.error(
        `Unhandled exception (requestId=${req.id ?? 'n/a'})`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    res.status(status).json({
      success: false,
      statusCode: status,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: req.url,
      requestId: req.id,
    });
  }

  private resolve(exception: unknown): { status: number; message: string; errorCode: string } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();
      const body =
        typeof response === 'object' && response !== null
          ? (response as Record<string, unknown>)
          : { message: response };
      const rawMessage = body.message ?? exception.message;
      return {
        status,
        message: Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage),
        errorCode: typeof body.errorCode === 'string' ? body.errorCode : this.statusToCode(status),
      };
    }
    if (this.isPrismaKnownError(exception)) {
      const code = (exception as { code: string }).code;
      if (code === 'P2002')
        return { status: 409, message: 'Resource already exists', errorCode: ERROR_CODES.CONFLICT };
      if (code === 'P2025')
        return { status: 404, message: 'Resource not found', errorCode: ERROR_CODES.NOT_FOUND };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorCode: ERROR_CODES.INTERNAL_ERROR,
    };
  }

  private isPrismaKnownError(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      (e as { name?: string }).name === 'PrismaClientKnownRequestError'
    );
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
    };
    return map[status] ?? ERROR_CODES.INTERNAL_ERROR;
  }
}
