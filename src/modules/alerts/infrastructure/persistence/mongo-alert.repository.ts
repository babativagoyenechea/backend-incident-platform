import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IAlertRepository } from '../../domain/repositories/i-alert.repository';
import { Alert } from '../../domain/entities/alert.entity';
import { AlertDocument } from './schemas/alert.schema';

@Injectable()
export class MongoAlertRepository implements IAlertRepository {
  constructor(
    @InjectModel(AlertDocument.name)
    private readonly model: Model<AlertDocument>,
  ) {}

  async save(alert: Alert): Promise<Alert> {
    const doc = await this.model.create({
      sourceTraceId: alert.sourceTraceId,
      affectedApplication: alert.affectedApplication,
      severity: alert.severity,
      generatedAt: alert.generatedAt,
      processingStatus: alert.processingStatus,
    });
    return this.toDomain(doc);
  }

  async findRecent(limit: number): Promise<Alert[]> {
    const docs = await this.model
      .find()
      .sort({ generatedAt: -1 })
      .limit(limit)
      .exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  private toDomain(doc: any): Alert {
    return new Alert(
      doc._id.toString(),
      doc.sourceTraceId,
      doc.affectedApplication,
      doc.severity,
      doc.generatedAt,
      doc.processingStatus,
    );
  }
}