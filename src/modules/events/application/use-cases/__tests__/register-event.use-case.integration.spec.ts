/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { RegisterEventUseCase } from '../register-event.use-case';
import { IEventRepository } from '../../../domain/repositories/i-event.repository';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { ALERT_QUEUE_NAME } from '../../../../alerts/infrastructure/queue/bullmq.config';
import { Event } from '../../../domain/entities/event.entity';

describe('[Integración] RegisterEventUseCase', () => {
  let useCase: RegisterEventUseCase;
  let eventRepository: IEventRepository;
  let bullQueue: Queue;

  const mockEventRepository = {
    save: jest.fn(),
  };

  // stub de la cola — sin BullMQ real
  const stubQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterEventUseCase,
        { provide: 'IEventRepository', useValue: mockEventRepository },
        { provide: getQueueToken(ALERT_QUEUE_NAME), useValue: stubQueue },
      ],
    }).compile();

    useCase = module.get<RegisterEventUseCase>(RegisterEventUseCase);
    eventRepository = module.get<IEventRepository>('IEventRepository');
    bullQueue = module.get<Queue>(getQueueToken(ALERT_QUEUE_NAME));
    jest.clearAllMocks();
  });

  it('registra el evento en MongoDB y encola en BullMQ si la severidad es CRITICAL', async () => {
    const dto = {
      application: 'payment-service',
      eventType: 'GATEWAY_TIMEOUT',
      description: 'Timeout masivo',
      severity: 'CRITICAL',
      occurredAt: new Date().toISOString(),
      metadata: { gateway: 'Stripe' },
    };

    const savedEvent = new Event(
      'mongo-id-123',
      'trace-test-uuid-1',
      dto.application,
      dto.eventType,
      dto.description,
      dto.severity,
      new Date(dto.occurredAt),
      dto.metadata,
    );

    mockEventRepository.save.mockResolvedValue(savedEvent);
    stubQueue.add.mockResolvedValue({ id: 'job-123' });

    const result = await useCase.execute(dto, 'trace-test-uuid-1');

    expect(result.traceId).toBe('trace-test-uuid-1');
    expect(mockEventRepository.save).toHaveBeenCalledTimes(1);
    expect(stubQueue.add).toHaveBeenCalledTimes(1);
  });
});