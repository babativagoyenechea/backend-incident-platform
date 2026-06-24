import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('incident_audit')
export class IncidentAuditOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId!: string;

  @Column({ name: 'old_status', type: 'enum', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] })
  oldStatus!: string;

  @Column({ name: 'new_status', type: 'enum', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] })
  newStatus!: string;

  @Column({ name: 'changed_by', length: 150, nullable: true })
  changedBy!: string;

  @Column({ name: 'trace_id', length: 36, nullable: true })
  traceId!: string;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt!: Date;
}