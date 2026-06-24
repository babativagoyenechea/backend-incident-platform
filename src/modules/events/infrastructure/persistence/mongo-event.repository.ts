import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IEventRepository } from '../../domain/repositories/i-event.repository';
import { Event } from '../../domain/entities/event.entity';
import { EventDocument } from './schemas/event.schema';

@Injectable()
export class MongoEventRepository implements IEventRepository, OnModuleInit {
  private readonly logger = new Logger(MongoEventRepository.name);

  constructor(
    @InjectModel(EventDocument.name) private readonly eventModel: Model<EventDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      // Índice único para garantizar idempotencia al buscar por traceId
      await this.eventModel.collection.createIndex(
        { traceId: 1 },
        { unique: true, name: 'idx_traceId_unique' },
      );
      await this.eventModel.collection.createIndex(
        { application: 1, severity: 1, occurredAt: -1 },
        { name: 'idx_app_severity_occurredAt' },
      );
      await this.eventModel.collection.createIndex(
        { severity: 1 },
        { name: 'idx_severity' },
      );
      this.logger.log('MongoDB indexes created/verified for EventDocument');
    } catch (error) {
      this.logger.warn(`Index creation warning: ${(error as Error).message}`);
    }
  }

  async save(event: Event): Promise<Event> {
    const created = await this.eventModel.create({
      traceId:     event.traceId,
      application: event.application,
      eventType:   event.eventType,
      description: event.description,
      severity:    event.severity,
      occurredAt:  event.occurredAt,
      metadata:    event.metadata,
    });
    return this.toDomain(created);
  }

  async findByTraceId(traceId: string): Promise<Event | null> {
    const doc = await this.eventModel.findOne({ traceId }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async groupByApplication(): Promise<{ application: string; count: number }[]> {
    return this.eventModel.aggregate([
      { $group:   { _id: '$application', count: { $sum: 1 } } },
      { $project: { application: '$_id', count: 1, _id: 0 } },
      { $sort:    { count: -1 } },
    ]).exec();
  }

  async groupBySeverity(): Promise<{ severity: string; count: number }[]> {
    return this.eventModel.aggregate([
      { $group:   { _id: '$severity', count: { $sum: 1 } } },
      { $project: { severity: '$_id', count: 1, _id: 0 } },
    ]).exec();
  }

  private toDomain(doc: any): Event {
    return new Event(
      doc._id.toString(),
      doc.traceId,
      doc.application,
      doc.eventType,
      doc.description,
      doc.severity,
      doc.occurredAt,
      doc.metadata,
    );
  }
}