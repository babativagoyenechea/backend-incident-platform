export class IncidentAudit {
  constructor(
    public readonly incidentId: string,
    public readonly oldStatus: string,
    public readonly newStatus: string, 
    public readonly changedBy: string,
    public readonly traceId: string,
  ) {}
}
