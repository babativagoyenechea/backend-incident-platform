export class Alert {
  constructor(
    public readonly id: string | null,
    public readonly sourceTraceId: string,
    public readonly affectedApplication: string,
    public readonly severity: string,
    public readonly generatedAt: Date,
    public readonly processingStatus: string, // 'PENDING' | 'PROCESSED' | 'FAILED'
  ) {}
}