import { Alert } from '../entities/alert.entity';

export interface IAlertRepository {
  save(alert: Alert): Promise<Alert>;
  findRecent(limit: number): Promise<Alert[]>;
}