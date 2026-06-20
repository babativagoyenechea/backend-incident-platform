import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RegisterEventDto } from '../dtos/register-event.dto';
import { Event } from '../../domain/entities/event.entity';
import type { IEventRepository } from '../../domain/repositories/i-event.repository';
import { defaultJobOptions } from '../../../alerts/infrastructure/queue/bullmq.config';

@Injectable()
export class RegisterEventUseCase {
  private readonly logger = new Logger(RegisterEventUseCase.name);

  constructor(
    @Inject('IEventRepository') private readonly eventRepo: IEventRepository,
    @InjectQueue('alert-processing') private readonly alertQueue: Queue,
  ) {}

  async execute(dto: RegisterEventDto, traceId: string): Promise<{ traceId: string }> {
    const event = new Event(
      null,
      traceId,
      dto.application,
      dto.eventType,
      dto.description,
      dto.severity,
      new Date(dto.occurredAt),
      dto.metadata || {},
    );

    const savedEvent = await this.eventRepo.save(event);
    this.logger.log(JSON.stringify({ action: 'EVENT_REGISTERED', traceId, severity: savedEvent.severity }));

    if (savedEvent.severity === 'CRITICAL') {
      await this.alertQueue.add('process-alert', {
        eventId: savedEvent.id,
        traceId: savedEvent.traceId,
        severity: savedEvent.severity,
        application: savedEvent.application,
      }, defaultJobOptions);

      this.logger.log(JSON.stringify({ action: 'ALERT_QUEUED', traceId }));
    }

    return { traceId };
  }
}
