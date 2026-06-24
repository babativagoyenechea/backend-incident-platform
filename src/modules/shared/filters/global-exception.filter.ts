import {  ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger,} from '@nestjs/common';

const HttpStatusCodeName: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(exception: any, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse();
    const request  = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : exception.message || 'Internal Server Error';

    const traceId = (request as any).traceId || 'N/A';

    const errorResponse = {
      statusCode: status,
      error:      HttpStatusCodeName[status] || 'INTERNAL_SERVER_ERROR',
      message:    typeof message === 'object' ? (message as any).message : message,
      traceId,
      timestamp:  new Date().toISOString(),
    };

    this.logger.error(JSON.stringify({ ...errorResponse, stack: exception.stack }));
    response.status(status).json(errorResponse);
  }
}