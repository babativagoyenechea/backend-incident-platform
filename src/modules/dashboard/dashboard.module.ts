import { Module, forwardRef } from '@nestjs/common';
import { GetDashboardMetricsUseCase } from './application/use-cases/get-dashboard-metrics.use-case';
import { DashboardController } from './presentation/controllers/dashboard.controller';
import { IncidentsModule } from '../incidents/incidents.module';
import { EventsModule } from '../events/events.module';
import { AlertsModule } from '../alerts/alerts.module';
import { RedisModule } from '../shared/infrastructure/redis/redis.module';

@Module({
  imports: [
    forwardRef(() => IncidentsModule),
    forwardRef(() => EventsModule),
    forwardRef(() => AlertsModule),
    RedisModule,
  ],
  controllers: [DashboardController],
  providers: [GetDashboardMetricsUseCase],
  exports: [GetDashboardMetricsUseCase],
})
export class DashboardModule {}