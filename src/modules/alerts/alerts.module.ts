import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AlertDocument, AlertSchema } from './infrastructure/persistence/schemas/alert.schema';
import { MongoAlertRepository } from './infrastructure/persistence/mongo-alert.repository';
import { CreateAlertUseCase } from './application/use-cases/create-alert.use-case';
import { AlertWorker } from './infrastructure/queue/alert.worker';
import { ALERT_QUEUE_NAME, ALERT_DLQ_NAME } from './infrastructure/queue/bullmq.config';
import { WebsocketsModule } from '../websockets/websockets.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { RedisModule } from '../shared/infrastructure/redis/redis.module';
import { MetricsBroadcastService } from '../shared/application/services/metrics-broadcast.service';

@Module({
  imports: [
    // Registro de Schemas Mongoose para Alertas
    MongooseModule.forFeature([{ name: AlertDocument.name, schema: AlertSchema }]),
    
    // Configuración y registro de colas asíncronas con BullMQ
    BullModule.registerQueue(
      { name: ALERT_QUEUE_NAME },
      { name: ALERT_DLQ_NAME }
    ),
    
    // Módulos requeridos para resolver las dependencias de MetricsBroadcastService
    RedisModule, // Proveedor del token 'REDIS_CACHE' (DB0)
    WebsocketsModule, // Proveedor de EventsGateway
    forwardRef(() => DashboardModule), // Proveedor de GetDashboardMetricsUseCase
  ],
  providers: [
    CreateAlertUseCase,
    AlertWorker,
    MetricsBroadcastService, // Registrado para que AlertWorker pueda inyectarlo de forma limpia
    {
      provide: 'IAlertRepository',
      useClass: MongoAlertRepository,
    },
  ],
  exports: ['IAlertRepository', CreateAlertUseCase, MetricsBroadcastService], // Exportado para que IncidentsModule pueda consumirlo
})
export class AlertsModule {}