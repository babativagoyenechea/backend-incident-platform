/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UpdateIncidentStatusUseCase } from '../update-incident-status.use-case';
import { MetricsBroadcastService } from '../../../../shared/application/services/metrics-broadcast.service';
import { EventsGateway } from '../../../../websockets/events.gateway';
import { Incident } from '../../../domain/entities/incident.entity';
import { IncidentAudit } from '../../../domain/entities/incident-audit.entity';

const buildIncident = (status: string, id = 'incident-uuid-001'): Incident =>
  new Incident(
    id,
    'Fallo en gateway de pagos',
    'El servicio no responde',
    'payment-service',
    'CRITICAL',
    status,
    'ops@empresa.com',
    ['trace-001', 'trace-002'],
    new Date('2024-03-15T08:00:00Z'),
    new Date('2024-03-15T08:00:00Z'),
  );

const fakeRepo = {
  saveWithAudit: jest.fn(),
  findById: jest.fn(),
  findByFilters: jest.fn(),
  countByStatus: jest.fn(),
};

const stubBroadcaster = {
  invalidateAndBroadcast: jest.fn(),
};

const mockEventsGateway = {
  emitIncidentUpdated: jest.fn(),
  emitAlertCreated: jest.fn(),
  emitMetricsUpdated: jest.fn(),
};

describe('[Integración] UpdateIncidentStatusUseCase', () => {
  let useCase: UpdateIncidentStatusUseCase;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateIncidentStatusUseCase,
        { provide: 'IIncidentRepository', useValue: fakeRepo },
        { provide: MetricsBroadcastService, useValue: stubBroadcaster },
        { provide: EventsGateway, useValue: mockEventsGateway },
      ],
    }).compile();

    useCase = module.get<UpdateIncidentStatusUseCase>(UpdateIncidentStatusUseCase);
    jest.clearAllMocks();
  });

  describe('execute() — transiciones de estado permitidas por el dominio', () => {
    it('debe transicionar correctamente de OPEN a IN_PROGRESS y registrar auditoría', async () => {
      const incident = buildIncident('OPEN');
      const updatedIncident = buildIncident('IN_PROGRESS');
      fakeRepo.findById.mockResolvedValue(incident);
      fakeRepo.saveWithAudit.mockResolvedValue(updatedIncident);
      stubBroadcaster.invalidateAndBroadcast.mockResolvedValue(undefined);

      const result = await useCase.execute(
        { id: 'incident-uuid-001', status: 'IN_PROGRESS' },
        'operador@empresa.com',
        'trace-upd-001',
      );

      expect(result.status).toBe('IN_PROGRESS');
      const [, auditArg] = fakeRepo.saveWithAudit.mock.calls[0] as [Incident, IncidentAudit];
      expect(auditArg.oldStatus).toBe('OPEN');
      expect(auditArg.newStatus).toBe('IN_PROGRESS');
      expect(auditArg.changedBy).toBe('operador@empresa.com');
    });

    it('debe transicionar correctamente de IN_PROGRESS a RESOLVED', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('IN_PROGRESS'));
      fakeRepo.saveWithAudit.mockResolvedValue(buildIncident('RESOLVED'));
      stubBroadcaster.invalidateAndBroadcast.mockResolvedValue(undefined);

      const result = await useCase.execute(
        { id: 'incident-uuid-001', status: 'RESOLVED' },
        'supervisor@empresa.com',
        'trace-resolved-001',
      );

      expect(result.status).toBe('RESOLVED');
    });

    it('debe permitir reabrir un incidente de IN_PROGRESS a OPEN (reapertura)', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('IN_PROGRESS'));
      fakeRepo.saveWithAudit.mockResolvedValue(buildIncident('OPEN'));
      stubBroadcaster.invalidateAndBroadcast.mockResolvedValue(undefined);

      const result = await useCase.execute(
        { id: 'incident-uuid-001', status: 'OPEN' },
        'admin@empresa.com',
        'trace-reopen-001',
      );

      expect(result.status).toBe('OPEN');
    });
  });

  describe('execute() — transiciones de estado prohibidas (ConflictException)', () => {
    it('debe lanzar ConflictException al intentar ir de OPEN directamente a RESOLVED', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('OPEN'));
      await expect(
        useCase.execute(          { id: 'incident-uuid-001', status: 'RESOLVED' },
          'ops@empresa.com',
          'trace-invalid-001',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('debe contener el mensaje descriptivo de transición en el ConflictException', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('OPEN'));
      await expect(
        useCase.execute(
          { id: 'incident-uuid-001', status: 'RESOLVED' },
          'ops@empresa.com',
          'trace-invalid-002',
        ),
      ).rejects.toThrow('La transición de OPEN a RESOLVED no está permitida');
    });

    it('debe lanzar ConflictException al intentar mover un incidente RESOLVED a IN_PROGRESS', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('RESOLVED'));
      await expect(
        useCase.execute(
          { id: 'incident-uuid-001', status: 'IN_PROGRESS' },
          'ops@empresa.com',
          'trace-frozen-001',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('debe lanzar ConflictException al intentar reabrir un incidente RESOLVED', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('RESOLVED'));
      await expect(
        useCase.execute(
          { id: 'incident-uuid-001', status: 'OPEN' },
          'ops@empresa.com',
          'trace-frozen-002',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('no debe persistir ni emitir cuando la transición es inválida', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('OPEN'));
      try {
        await useCase.execute(
          { id: 'incident-uuid-001', status: 'RESOLVED' },
          'ops@empresa.com',
          'trace-no-persist',
        );
      } catch {
        // error esperado
      }
      expect(fakeRepo.saveWithAudit).not.toHaveBeenCalled();
      expect(stubBroadcaster.invalidateAndBroadcast).not.toHaveBeenCalled();
      expect(mockEventsGateway.emitIncidentUpdated).not.toHaveBeenCalled();
    });
  });

  describe('execute() — incidente inexistente', () => {
    it('debe lanzar NotFoundException si el id no existe en el repositorio', async () => {
      fakeRepo.findById.mockResolvedValue(null);
      await expect(
        useCase.execute(
          { id: 'uuid-inexistente', status: 'IN_PROGRESS' },
          'ops@empresa.com',
          'trace-notfound',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe incluir el id en el mensaje del NotFoundException', async () => {
      fakeRepo.findById.mockResolvedValue(null);
      await expect(
        useCase.execute(
          { id: 'uuid-fantasma-123', status: 'IN_PROGRESS' },
          'ops@empresa.com',
          'trace-notfound-2',
        ),
      ).rejects.toThrow('uuid-fantasma-123');
    });
  });

  describe('execute() — efectos secundarios tras actualización exitosa', () => {
    it('debe invocar invalidateAndBroadcast después de persistir el incidente', async () => {
      fakeRepo.findById.mockResolvedValue(buildIncident('OPEN'));
      fakeRepo.saveWithAudit.mockResolvedValue(buildIncident('IN_PROGRESS'));
      stubBroadcaster.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(
        { id: 'incident-uuid-001', status: 'IN_PROGRESS' },
        'ops@empresa.com',
        'trace-cache-001',
      );

      expect(stubBroadcaster.invalidateAndBroadcast).toHaveBeenCalledTimes(1);
    });
  });
});