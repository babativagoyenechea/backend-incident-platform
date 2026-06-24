import {  Entity, PrimaryGeneratedColumn, Column,  CreateDateColumn, UpdateDateColumn,} from 'typeorm';

@Entity('incidents')
export class IncidentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ nullable: true, type: 'text' })
  description!: string;

  @Column({ name: 'affected_app', length: 100 })
  affectedApp!: string;

  @Column({ type: 'enum', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  severity!: string;

  @Column({ type: 'enum', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'], default: 'OPEN' })
  status!: string;

  @Column({ nullable: true, length: 150 })
  assignee!: string;

  // TEXT[] nativo de Postgres para conservar el tipado y evitar bugs
  @Column({ name: 'related_event_trace_ids', type: 'text', array: true, nullable: true })
  relatedEventTraceIds!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}