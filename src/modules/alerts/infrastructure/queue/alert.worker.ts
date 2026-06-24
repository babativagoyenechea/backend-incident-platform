import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { CreateAlertUseCase } from '../../application/use-cases/create-alert.use-case';
import { MetricsBroadcastService } from '../../../shared/application/services/metrics-broadcast.service';
import { EventsGateway } from '../../../websockets/events.gateway';
import { ALERT_QUEUE_NAME, ALERT_DLQ_NAME, AlertJobPayload } from './bullmq.config';

@Processor(ALERT_QUEUE_NAME)
@Injectable()
export class AlertWorker extends WorkerHost {
  private readonly logger = new Logger(AlertWorker.name);

  constructor(
    private readonly createAlert:      CreateAlertUseCase,
    private readonly metricsBroadcast: MetricsBroadcastService,
    private readonly gateway:          EventsGateway,
    @InjectQueue(ALERT_DLQ_NAME) private readonly dlq: Queue,
  ) {
    super();
  }

  async process(job: Job<AlertJobPayload>): Promise<void> {
    const { traceId, severity, application } = job.data;
    try {
      this.logger.log(
        JSON.stringify({ action: 'ALERT_PROCESSING_STARTED', traceId, jobId: job.id }),
      );

      const alert = await this.createAlert.execute({
        sourceTraceId:       traceId,
        affectedApplication: application,
        severity,
      });

      this.gateway.emitAlertCreated(alert);
      await this.metricsBroadcast.invalidateAndBroadcast();

      this.logger.log(
        JSON.stringify({ action: 'ALERT_PROCESSING_COMPLETED', alertId: alert.id, traceId }),
      );
    } catch (error: any) {
      this.logger.error(
        JSON.stringify({
          action:   'ALERT_PROCESSING_FAILED',
          traceId,
          error:    error.message,
          attempt:  job.attemptsMade,
        }),
      );

      // Mover a la DLQ solo cuando se agotaron todos los reintentos
      if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
        await this.dlq.add('failed-alert', job.data, { removeOnComplete: false });
      }
      throw error;
    }
  }
}