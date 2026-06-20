import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    // Reutiliza el traceId enviado por el cliente en las cabeceras, o genera uno nuevo si no existe
    const traceId = request.headers['x-trace-id'] || uuidv4();

    request.traceId = traceId;
    response.setHeader('x-trace-id', traceId);

    return next.handle();
  }
}