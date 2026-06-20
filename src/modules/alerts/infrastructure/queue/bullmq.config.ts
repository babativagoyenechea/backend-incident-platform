import { JobsOptions } from 'bullmq';

export const ALERT_QUEUE_NAME = 'alert-processing';
export const ALERT_DLQ_NAME = 'alert-processing-failed';

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

export interface AlertJobPayload {
  eventId: string;
  traceId: string;
  severity: string;
  application: string;
}