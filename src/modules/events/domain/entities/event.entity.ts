export class Event {
  constructor(
    public readonly id: string | null,
    public readonly traceId: string,
    public readonly application: string,
    public readonly eventType: string,
    public readonly description: string,
    public readonly severity: string,
    public readonly occurredAt: Date,
    public readonly metadata: Record<string, any> = {},
  ) {}
}