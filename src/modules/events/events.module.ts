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
    MongooseModule.forFeature([{ name: EventDocument.name, schema: EventSchema }]),
    BullModule.registerQueueAsync({
      name: 'alert-processing',
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
          db:   config.get<number>('REDIS_QUEUE_DB', 1),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [EventController],
  providers: [
    RegisterEventUseCase,
    {
      provide:  'IEventRepository',
      useClass: MongoEventRepository,
    },
  ],
  exports: ['IEventRepository'],
})
export class EventsModule {}