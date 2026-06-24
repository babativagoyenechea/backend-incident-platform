import { Incident } from '../entities/incident.entity';
import { IncidentAudit } from '../entities/incident-audit.entity';

export interface IIncidentRepository {
  saveWithAudit(incident: Incident, audit: IncidentAudit): Promise<Incident>;
  findById(id: string): Promise<Incident | null>;
  findByFilters(filters: any): Promise<any>;
  countByStatus(status: string): Promise<number>;
}