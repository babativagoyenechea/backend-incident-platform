import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { IIncidentRepository } from '../../../incidents/domain/repositories/i-incident.repository';
import { IEventRepository } from '../../../events/domain/repositories/i-event.repository';
import { IAlertRepository } from '../../../alerts/domain/repositories/i-alert.repository';

export interface DashboardMetrics {
  openIncidents:     number;
  resolvedIncidents: number;
  eventsByApp:       Array<{ application: string; count: number }>;
  eventsBySeverity:  Array<{ severity: string; count: number }>;
  recentAlerts:      any[];
  cachedAt:          string;
}

@Injectable()
export class GetDashboardMetricsUseCase {
  private readonly CACHE_KEY   = 'dashboard:metrics';
  private readonly TTL_SECONDS = 30;

  constructor(
    @Inject('IIncidentRepository') private readonly incidentRepo: IIncidentRepository,
    @Inject('IEventRepository')    private readonly eventRepo:    IEventRepository,
    @Inject('IAlertRepository')    private readonly alertRepo:    IAlertRepository,
    @Inject('REDIS_CACHE')         private readonly redis:        Redis,
  ) {}

  async execute(): Promise<DashboardMetrics> {
    const cached = await this.redis.get(this.CACHE_KEY);
    if (cached) return JSON.parse(cached);

    const [openCount, resolvedCount, eventsByApp, eventsBySeverity, recentAlerts] =
      await Promise.all([
        this.incidentRepo.countByStatus('OPEN'),
        this.incidentRepo.countByStatus('RESOLVED'),
        this.eventRepo.groupByApplication(),
        this.eventRepo.groupBySeverity(),
        this.alertRepo.findRecent(10),
      ]);

    const metrics: DashboardMetrics = {
      openIncidents:     openCount,
      resolvedIncidents: resolvedCount,
      eventsByApp,
      eventsBySeverity,
      recentAlerts,
      cachedAt: new Date().toISOString(),
    };

    await this.redis.set(this.CACHE_KEY, JSON.stringify(metrics), 'EX', this.TTL_SECONDS);
    return metrics;
  }
}