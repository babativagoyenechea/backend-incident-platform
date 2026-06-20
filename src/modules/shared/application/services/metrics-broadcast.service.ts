import { Injectable, Inject, forwardRef } from '@nestjs/common';
import Redis from 'ioredis';
import { GetDashboardMetricsUseCase } from '../../../dashboard/application/use-cases/get-dashboard-metrics.use-case';
import { EventsGateway } from '../../../websockets/events.gateway';

@Injectable()
export class MetricsBroadcastService {
  constructor(
    @Inject('REDIS_CACHE') private readonly redis: Redis,
    @Inject(forwardRef(() => GetDashboardMetricsUseCase))
    private readonly getMetrics: GetDashboardMetricsUseCase,
    private readonly gateway: EventsGateway,
  ) {}

  async invalidateAndBroadcast(): Promise<void> {
    await this.redis.del('dashboard:metrics');
    const freshMetrics = await this.getMetrics.execute();
    this.gateway.emitMetricsUpdated(freshMetrics);
  }
}