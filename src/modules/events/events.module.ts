import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EventController } from './presentation/controllers/event.controller';
import { RegisterEventUseCase } from './application/use-cases/register-event.use-case';
import { EventDocument, EventSchema } from './infrastructure/persistence/schemas/event.schema';
import { MongoEventRepository } from './infrastructure/persistence/mongo-event.repository';

@Module({
  imports: [
    // 1. Vincular el esquema de Mongoose para persistencia en MongoDB
    MongooseModule.forFeature([{ name: EventDocument.name, schema: EventSchema }]),
    
    // 2. Registrar la cola de BullMQ de forma asíncrona pasando la conexión directa (Decisión 3 - Corrección #5)
    BullModule.registerQueueAsync({
      name: 'alert-processing',
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
          db: config.get<number>('REDIS_QUEUE_DB', 1), // DB 1 dedicada a colas
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [EventController],
  providers: [
    RegisterEventUseCase,
    // Inversión de dependencias (SOLID): Vincula la interfaz del dominio con el repositorio real de infraestructura
    {
      provide: 'IEventRepository',
      useClass: MongoEventRepository,
    },
  ],
  // Exportamos el repositorio por si el módulo de incidentes o el dashboard necesitan consultar eventos
  exports: ['IEventRepository'],
})
export class EventsModule {}