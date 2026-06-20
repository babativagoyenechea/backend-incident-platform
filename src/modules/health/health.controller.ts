import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheckService, TypeOrmHealthIndicator, MongooseHealthIndicator, HealthCheck, HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly typeorm: TypeOrmHealthIndicator,
    private readonly mongo: MongooseHealthIndicator,
    @Inject('REDIS_CACHE') private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.typeorm.pingCheck('postgres'),
      () => this.mongo.pingCheck('mongodb'),
      async () => {
        try {
          await this.redis.ping();
          return { redis: { status: 'up' } };
        } catch {
          throw new HealthCheckError('Redis cache check failed', { redis: { status: 'down' } });
        }
      },
    ]);
  }
}
