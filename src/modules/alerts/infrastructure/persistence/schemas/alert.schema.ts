import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'alerts', timestamps: false })
export class AlertDocument extends Document {
  @Prop({ required: true, index: true })
  sourceTraceId!: string;

  @Prop({ required: true })
  affectedApplication!: string;

  @Prop({ required: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  severity!: string;

  @Prop({ required: true, type: Date, default: Date.now })
  generatedAt!: Date;

  @Prop({
    required: true,
    enum:    ['PENDING', 'PROCESSED', 'FAILED'],
    default: 'PENDING',
  })
  processingStatus!: string;
}

export const AlertSchema = SchemaFactory.createForClass(AlertDocument);