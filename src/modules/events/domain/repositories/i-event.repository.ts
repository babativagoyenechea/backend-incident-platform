import { Event } from '../entities/event.entity';

export interface IEventRepository {
  save(event: Event): Promise<Event>;
  findByTraceId(traceId: string): Promise<Event | null>;
  groupByApplication(): Promise<{ application: string; count: number }[]>;
  groupBySeverity(): Promise<{ severity: string; count: number }[]>;
}