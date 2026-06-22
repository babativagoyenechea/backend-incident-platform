import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AlertDocument, AlertSchema } from './infrastructure/persistence/schemas/alert.schema';
import { MongoAlertRepository } from './infrastructure/persistence/mongo-alert.repository';
import { CreateAlertUseCase } from './application/use-cases/create-alert.use-case';
import { AlertWorker } from './infrastructure/queue/alert.worker';
import { ALERT_QUEUE_NAME, ALERT_DLQ_NAME } from './infrastructure/queue/bullmq.config';
import { DashboardModule } from '../dashboard/dashboard.module';
import { RedisModule } from '../shared/infrastructure/redis/redis.module';
import { MetricsBroadcastService } from '../shared/application/services/metrics-broadcast.service';


@Module({
  imports: [
    MongooseModule.forFeature([{ name: AlertDocument.name, schema: AlertSchema }]),
    BullModule.registerQueue(
      { name: ALERT_QUEUE_NAME },
      { name: ALERT_DLQ_NAME },
    ),
    RedisModule,
    forwardRef(() => DashboardModule),
  ],
  providers: [
    CreateAlertUseCase,
    AlertWorker,
    MetricsBroadcastService,
    {
      provide: 'IAlertRepository',
      useClass: MongoAlertRepository,
    },
  ],
  exports: ['IAlertRepository', CreateAlertUseCase, MetricsBroadcastService],
})
export class AlertsModule {}
