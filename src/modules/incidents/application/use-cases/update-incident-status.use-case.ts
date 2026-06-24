import { Injectable, Inject, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { UpdateStatusDto } from '../dtos/update-status.dto';
import { Incident } from '../../domain/entities/incident.entity';
import { IncidentAudit } from '../../domain/entities/incident-audit.entity';
import { IIncidentRepository } from '../../domain/repositories/i-incident.repository';
import { IncidentStatus } from '../../domain/value-objects/incident-status.vo';
import { MetricsBroadcastService } from '../../../shared/application/services/metrics-broadcast.service';
import { EventsGateway } from '../../../websockets/events.gateway';

@Injectable()
export class UpdateIncidentStatusUseCase {
  private readonly logger = new Logger(UpdateIncidentStatusUseCase.name);

  constructor(
    @Inject('IIncidentRepository')
    private readonly repo: IIncidentRepository,
    private readonly metricsBroadcast: MetricsBroadcastService,
    private readonly gateway: EventsGateway,
  ) {}

  async execute(dto: UpdateStatusDto, requestingUser: string, traceId: string): Promise<Incident> {
    const incident = await this.repo.findById(dto.id);
    if (!incident) throw new NotFoundException(`Incidente ${dto.id} no encontrado`);

    const current = new IncidentStatus(incident.status);
    const next = new IncidentStatus(dto.status);

    if (!current.canTransitionTo(next)) {
      throw new ConflictException(`La transición de ${current.getValue()} a ${next.getValue()} no está permitida`);
    }

    const oldStatus = incident.status;
    incident.status = next.getValue();
    incident.updatedAt = new Date();

    const audit = new IncidentAudit(incident.id, oldStatus, next.getValue(), requestingUser, traceId);
    const updated = await this.repo.saveWithAudit(incident, audit);

    await this.metricsBroadcast.invalidateAndBroadcast();
    this.gateway.emitIncidentUpdated(updated);

    this.logger.log(JSON.stringify({
      action: 'INCIDENT_STATUS_UPDATED',
      traceId,
      incidentId: incident.id,
      oldStatus,
      newStatus: next.getValue(),
      changedBy: requestingUser,
    }));

    return updated;
  }
}