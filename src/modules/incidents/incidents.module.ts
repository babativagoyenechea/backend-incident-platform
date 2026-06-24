import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncidentController } from './presentation/controllers/incident.controller';
import { CreateIncidentUseCase } from './application/use-cases/create-incident.use-case';
import { UpdateIncidentStatusUseCase } from './application/use-cases/update-incident-status.use-case';
import { IncidentOrmEntity } from './infrastructure/persistence/entities/incident.orm-entity';
import { IncidentAuditOrmEntity } from './infrastructure/persistence/entities/incident-audit.orm-entity';
import { TypeOrmIncidentRepository } from './infrastructure/persistence/typeorm-incident.repository';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../shared/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentOrmEntity, IncidentAuditOrmEntity]),
    forwardRef(() => AlertsModule),
    AuthModule,
  ],
  controllers: [IncidentController],
  providers: [
    CreateIncidentUseCase,
    UpdateIncidentStatusUseCase,
    {
      provide:  'IIncidentRepository',
      useClass: TypeOrmIncidentRepository,
    },
  ],
  exports: ['IIncidentRepository'],
})
export class IncidentsModule {}