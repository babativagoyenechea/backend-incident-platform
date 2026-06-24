import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { IIncidentRepository } from '../../domain/repositories/i-incident.repository';
import { Incident } from '../../domain/entities/incident.entity';
import { IncidentAudit } from '../../domain/entities/incident-audit.entity';
import { IncidentOrmEntity } from './entities/incident.orm-entity';
import { IncidentAuditOrmEntity } from './entities/incident-audit.orm-entity';

@Injectable()
export class TypeOrmIncidentRepository implements IIncidentRepository {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(IncidentOrmEntity)
    private readonly repo: Repository<IncidentOrmEntity>,
    @InjectRepository(IncidentAuditOrmEntity)
    private readonly auditRepo: Repository<IncidentAuditOrmEntity>,
  ) {}

  async saveWithAudit(incident: Incident, audit: IncidentAudit): Promise<Incident> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const ormEntity = new IncidentOrmEntity();
      if (incident.id) ormEntity.id = incident.id;
      ormEntity.title                = incident.title;
      ormEntity.description          = incident.description;
      ormEntity.affectedApp          = incident.affectedApp;
      ormEntity.severity             = incident.severity;
      ormEntity.status               = incident.status;
      ormEntity.assignee             = incident.assignee;
      ormEntity.relatedEventTraceIds = incident.relatedEventTraceIds;

      const saved = await queryRunner.manager.save(IncidentOrmEntity, ormEntity);

      const ormAudit       = new IncidentAuditOrmEntity();
      ormAudit.incidentId  = saved.id;
      ormAudit.oldStatus   = audit.oldStatus;
      ormAudit.newStatus   = audit.newStatus;
      ormAudit.changedBy   = audit.changedBy;
      ormAudit.traceId     = audit.traceId;

      await queryRunner.manager.save(IncidentAuditOrmEntity, ormAudit);
      await queryRunner.commitTransaction();
      return this.toDomain(saved);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findById(id: string): Promise<Incident | null> {
    const entity = await this.repo.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByFilters(filters: any): Promise<any> {
    const page  = Math.max(Number(filters.page  ?? 1), 1);
    const limit = Math.min(Number(filters.limit ?? 20), 100);
    const qb = this.repo.createQueryBuilder('incident');

    if (filters.status)
      qb.andWhere('incident.status = :status', { status: filters.status });
    if (filters.severity)
      qb.andWhere('incident.severity = :severity', { severity: filters.severity });
    if (filters.application) 
      qb.andWhere('incident.affectedApp = :application', { application: filters.application });

    qb.orderBy('incident.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return {
      data: data.map((e) => this.toDomain(e)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async countByStatus(status: string): Promise<number> {
    return this.repo.count({ where: { status: status as any } });
  }

  private toDomain(entity: IncidentOrmEntity): Incident {
    return new Incident(
      entity.id,
      entity.title,
      entity.description,
      entity.affectedApp,
      entity.severity,
      entity.status,
      entity.assignee,
      entity.relatedEventTraceIds || [],
      entity.createdAt,
      entity.updatedAt,
    );
  }
}