import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'events', timestamps: false })
export class EventDocument extends Document {
  @Prop({ required: true, unique: true, index: true })
  traceId!: string;

  @Prop({ required: true, index: true })
  application!: string;

  @Prop({ required: true })
  eventType!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  severity!: string;

  @Prop({ required: true, type: Date, index: true })
  occurredAt!: Date;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, any>;
}

export const EventSchema = SchemaFactory.createForClass(EventDocument);