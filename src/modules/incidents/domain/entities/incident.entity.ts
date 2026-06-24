export class Incident {
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly description: string,
    public readonly affectedApp: string,
    public readonly severity: string,
    public status: string,         // mutable: los cambios de estado van por UpdateIncidentStatusUseCase
    public readonly assignee: string,
    public readonly relatedEventTraceIds: string[],
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}
}