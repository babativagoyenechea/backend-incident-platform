import { Injectable, Inject } from '@nestjs/common';
import { CreateIncidentDto } from '../dtos/create-incident.dto';
import { Incident } from '../../domain/entities/incident.entity';
import { IncidentAudit } from '../../domain/entities/incident-audit.entity';
import { IIncidentRepository } from '../../domain/repositories/i-incident.repository';
import { MetricsBroadcastService } from '../../../shared/application/services/metrics-broadcast.service';

@Injectable()
export class CreateIncidentUseCase {
  constructor(
    @Inject('IIncidentRepository')
    private readonly incidentRepo: IIncidentRepository,
    private readonly metricsBroadcast: MetricsBroadcastService,
  ) {}

  async execute(dto: CreateIncidentDto, traceId: string): Promise<Incident> {
    const incident = new Incident(
      '', // Postgres generará el UUID automáticamente
      dto.title,
      dto.description || '',
      dto.affectedApplication,
      dto.severity,
      'OPEN',
      dto.assignee || 'UNASSIGNED',
      dto.relatedEventTraceIds || [],
      new Date(),
      new Date(),
    );

    const audit = new IncidentAudit('', 'OPEN', 'OPEN', 'SYSTEM', traceId);
    const saved = await this.incidentRepo.saveWithAudit(incident, audit);

    // Invalida el caché de Redis DB0 y emite "metrics.updated" por WebSockets (Decisión 7)
    await this.metricsBroadcast.invalidateAndBroadcast();
    return saved;
  }
}