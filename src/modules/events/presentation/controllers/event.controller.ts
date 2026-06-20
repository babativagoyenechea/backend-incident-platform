import { Controller, Post, Body, Req } from '@nestjs/common';
import { ApiOperation, ApiBody, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RegisterEventUseCase } from '../../application/use-cases/register-event.use-case';
import { RegisterEventDto } from '../../application/dtos/register-event.dto';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Events')
@Controller('events')
export class EventController {
  constructor(private readonly registerEventUseCase: RegisterEventUseCase) {}

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 500 } }) // Decisión 5: Protección de ráfagas masivas
  @ApiOperation({ summary: 'Register a new operational event from external systems' })
  @ApiBody({
    type: RegisterEventDto, 
    examples: {
      example1: {
        summary: 'Ejemplo de evento crítico de negocio',
        value: {
          application: 'payment-service',
          eventType: 'TRANSACTION_TIMEOUT',
          description: 'Gateway de pagos no responde tras 5000ms',
          severity: 'CRITICAL',
          occurredAt: '2026-06-19T20:00:00Z',
          metadata: { gateway: 'Stripe', attempt: 3 }
        }
      }
    }
  })
  @ApiResponse({ status: 201, description: 'Event registered successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async register(@Body() dto: RegisterEventDto, @Req() req: any) {
    // Reutiliza el traceId inyectado en la request por el interceptor transversal
    return this.registerEventUseCase.execute(dto, req.traceId);
  }
}