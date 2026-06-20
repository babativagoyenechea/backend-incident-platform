import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import * as Joi from 'joi';

import { RedisModule } from './modules/shared/infrastructure/redis/redis.module';
import { WebsocketsModule } from './modules/websockets/websockets.module';
import { AuthModule } from './modules/shared/auth.module';
import { EventsModule } from './modules/events/events.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.development',
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
        PORT: Joi.number().default(3000),
        POSTGRES_HOST: Joi.string().required(),
        POSTGRES_PORT: Joi.number().required(),
        POSTGRES_DB: Joi.string().required(),
        POSTGRES_USER: Joi.string().required(),
        POSTGRES_PASSWORD: Joi.string().required(),
        MONGO_URI: Joi.string().required(),
        REDIS_HOST: Joi.string().required(),
        REDIS_PORT: Joi.number().required(),
        REDIS_CACHE_DB: Joi.number().default(0),
        REDIS_QUEUE_DB: Joi.number().default(1),
        JWT_SECRET: Joi.string().required(),
        LEGACY_API_KEY: Joi.string().required(),
      }),
    }),

    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST'),
        port: config.get<number>('POSTGRES_PORT'),
        username: config.get<string>('POSTGRES_USER'),
        password: config.get<string>('POSTGRES_PASSWORD'),
        database: config.get<string>('POSTGRES_DB'),
        autoLoadEntities: true,
        synchronize: false,
      }),
      inject: [ConfigService],
    }),

    MongooseModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI'),
      }),
      inject: [ConfigService],
    }),

    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
          db: config.get<number>('REDIS_QUEUE_DB'),
        },
      }),
      inject: [ConfigService],
    }),

    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),

    RedisModule,
    WebsocketsModule,
    AuthModule,
    EventsModule,
    AlertsModule,
    DashboardModule,
    IncidentsModule,
    HealthModule,
  ],
})
export class AppModule {}