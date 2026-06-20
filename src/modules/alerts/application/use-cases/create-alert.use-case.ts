import { Injectable, Inject } from '@nestjs/common';
import { Alert } from '../../domain/entities/alert.entity';
import type { IAlertRepository } from '../../domain/repositories/i-alert.repository';

export interface CreateAlertDto {
  sourceTraceId: string;
  affectedApplication: string;
  severity: string;
}

@Injectable()
export class CreateAlertUseCase {
  constructor(
    @Inject('IAlertRepository')
    private readonly alertRepo: IAlertRepository,
  ) {}

  async execute(dto: CreateAlertDto): Promise<Alert> {
    const alert = new Alert(
      null,
      dto.sourceTraceId,
      dto.affectedApplication,
      dto.severity,
      new Date(),
      'PROCESSED',
    );

    return this.alertRepo.save(alert);
  }
}