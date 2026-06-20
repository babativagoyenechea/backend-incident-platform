/// <reference types="jest" />
/**
 * PRUEBA DE INTEGRACIÓN — UpdateIncidentStatusUseCase
 *
 * Valida la orquestación completa del cambio de estado:
 * 1. Búsqueda del incidente existente (findById)
 * 2. Validación de transiciones mediante IncidentStatus (Value Object real)
 * 3. Persistencia ACID con registro de auditoría (saveWithAudit)
 * 4. Invalidación de caché Redis + broadcast WebSocket
 *
 * Estrategia: el Value Object IncidentStatus se usa sin mock para validar
 * las reglas de negocio reales. Solo la infraestructura queda mockeada.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UpdateIncidentStatusUseCase } from '../update-incident-status.use-case';
import { MetricsBroadcastService } from '../../../../shared/application/services/metrics-broadcast.service';
import { EventsGateway } from '../../../../websockets/events.gateway';
import { Incident } from '../../../domain/entities/incident.entity';
import { IncidentAudit } from '../../../domain/entities/incident-audit.entity';

// ── Fábrica de entidades ───────────────────────────────────────────────────────

const buildIncident = (status: string, id = 'incident-uuid-001'): Incident =>
  new Incident(
    id,
    'Fallo en gateway de pagos',
    'El servicio de Stripe no responde',
    'payment-service',
    'CRITICAL',
    status,
    'ops@coordinadora.com',
    ['trace-001', 'trace-002'],
    new Date('2026-01-15T08:00:00Z'),
    new Date('2026-01-15T08:00:00Z'),
  );

// ── Mocks de infraestructura ───────────────────────────────────────────────────

const mockIncidentRepository = {
  saveWithAudit: jest.fn(),
  findById: jest.fn(),
  findByFilters: jest.fn(),
  countByStatus: jest.fn(),
};

const mockMetricsBroadcast = {
  invalidateAndBroadcast: jest.fn(),
};

const mockEventsGateway = {
  emitIncidentUpdated: jest.fn(),
  emitAlertCreated: jest.fn(),
  emitMetricsUpdated: jest.fn(),
};

// ── Suite principal ────────────────────────────────────────────────────────────

describe('[Integración] UpdateIncidentStatusUseCase', () => {
  let useCase: UpdateIncidentStatusUseCase;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateIncidentStatusUseCase,
        { provide: 'IIncidentRepository', useValue: mockIncidentRepository },
        { provide: MetricsBroadcastService, useValue: mockMetricsBroadcast },
        { provide: EventsGateway, useValue: mockEventsGateway },
      ],
    }).compile();

    useCase = module.get<UpdateIncidentStatusUseCase>(UpdateIncidentStatusUseCase);
    jest.clearAllMocks();
  });

  // ── HU2: Transiciones válidas de estado ───────────────────────────────────

  describe('execute() — transiciones de estado permitidas por el dominio', () => {
    it('debe transicionar correctamente de OPEN a IN_PROGRESS y registrar auditoría', async () => {
      const incident = buildIncident('OPEN');
      const updatedIncident = buildIncident('IN_PROGRESS');
      mockIncidentRepository.findById.mockResolvedValue(incident);
      mockIncidentRepository.saveWithAudit.mockResolvedValue(updatedIncident);
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      const result = await useCase.execute(
        { id: 'incident-uuid-001', status: 'IN_PROGRESS' },
        'operador@coordinadora.com',
        'trace-upd-001',
      );

      expect(result.status).toBe('IN_PROGRESS');
      const [, auditArg] = mockIncidentRepository.saveWithAudit.mock.calls[0] as [Incident, IncidentAudit];
      expect(auditArg.oldStatus).toBe('OPEN');
      expect(auditArg.newStatus).toBe('IN_PROGRESS');
      expect(auditArg.changedBy).toBe('operador@coordinadora.com');
      expect(auditArg.traceId).toBe('trace-upd-001');
    });

    it('debe transicionar correctamente de IN_PROGRESS a RESOLVED', async () => {
      const incident = buildIncident('IN_PROGRESS');
      const updatedIncident = buildIncident('RESOLVED');
      mockIncidentRepository.findById.mockResolvedValue(incident);
      mockIncidentRepository.saveWithAudit.mockResolvedValue(updatedIncident);
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      const result = await useCase.execute(
        { id: 'incident-uuid-001', status: 'RESOLVED' },
        'supervisor@coordinadora.com',
        'trace-resolved-001',
      );

      expect(result.status).toBe('RESOLVED');
    });

    it('debe permitir reabrir un incidente de IN_PROGRESS a OPEN (reapertura)', async () => {
      const incident = buildIncident('IN_PROGRESS');
      const reopenedIncident = buildIncident('OPEN');
      mockIncidentRepository.findById.mockResolvedValue(incident);
      mockIncidentRepository.saveWithAudit.mockResolvedValue(reopenedIncident);
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      const result = await useCase.execute(
        { id: 'incident-uuid-001', status: 'OPEN' },
        'admin@coordinadora.com',
        'trace-reopen-001',
      );

      expect(result.status).toBe('OPEN');
    });
  });

  // ── HU2: Transiciones inválidas — regla de negocio ────────────────────────

  describe('execute() — transiciones de estado prohibidas (ConflictException)', () => {
    it('debe lanzar ConflictException al intentar ir de OPEN directamente a RESOLVED', async () => {
      mockIncidentRepository.findById.mockResolvedValue(buildIncident('OPEN'));

      await expect(
        useCase.execute(
          { id: 'incident-uuid-001', status: 'RESOLVED' },
          'ops@coordinadora.com',
          'trace-invalid-001',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('debe contener el mensaje descriptivo de transición en el ConflictException', async () => {
      mockIncidentRepository.findById.mockResolvedValue(buildIncident('OPEN'));

      await expect(
        useCase.execute(
          { id: 'incident-uuid-001', status: 'RESOLVED' },
          'ops@coordinadora.com',
          'trace-invalid-002',
        ),
      ).rejects.toThrow('La transición de OPEN a RESOLVED no está permitida');
    });

    it('debe lanzar ConflictException al intentar mover un incidente RESOLVED a IN_PROGRESS', async () => {
      mockIncidentRepository.findById.mockResolvedValue(buildIncident('RESOLVED'));

      await expect(
        useCase.execute(
          { id: 'incident-uuid-001', status: 'IN_PROGRESS' },
          'ops@coordinadora.com',
          'trace-frozen-001',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('debe lanzar ConflictException al intentar reabrir un incidente RESOLVED', async () => {
      mockIncidentRepository.findById.mockResolvedValue(buildIncident('RESOLVED'));

      await expect(
        useCase.execute(
          { id: 'incident-uuid-001', status: 'OPEN' },
          'ops@coordinadora.com',
          'trace-frozen-002',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('no debe persistir ni emitir cuando la transición es inválida', async () => {
      mockIncidentRepository.findById.mockResolvedValue(buildIncident('OPEN'));

      try {
        await useCase.execute(
          { id: 'incident-uuid-001', status: 'RESOLVED' },
          'ops@coordinadora.com',
          'trace-no-persist',
        );
      } catch {
        // Error esperado
      }

      expect(mockIncidentRepository.saveWithAudit).not.toHaveBeenCalled();
      expect(mockMetricsBroadcast.invalidateAndBroadcast).not.toHaveBeenCalled();
      expect(mockEventsGateway.emitIncidentUpdated).not.toHaveBeenCalled();
    });
  });

  // ── HU2: Incidente no encontrado ──────────────────────────────────────────

  describe('execute() — incidente inexistente', () => {
    it('debe lanzar NotFoundException si el id no existe en el repositorio', async () => {
      mockIncidentRepository.findById.mockResolvedValue(null);

      await expect(
        useCase.execute(
          { id: 'uuid-inexistente', status: 'IN_PROGRESS' },
          'ops@coordinadora.com',
          'trace-notfound',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe incluir el id en el mensaje del NotFoundException', async () => {
      mockIncidentRepository.findById.mockResolvedValue(null);

      await expect(
        useCase.execute(
          { id: 'uuid-fantasma-123', status: 'IN_PROGRESS' },
          'ops@coordinadora.com',
          'trace-notfound-2',
        ),
      ).rejects.toThrow('uuid-fantasma-123');
    });
  });

  // ── HU4: Efectos secundarios — broadcast y WebSocket ──────────────────────

  describe('execute() — efectos secundarios tras actualización exitosa', () => {
    it('debe invocar invalidateAndBroadcast después de persistir el incidente', async () => {
      const incident = buildIncident('OPEN');
      const updatedIncident = buildIncident('IN_PROGRESS');
      mockIncidentRepository.findById.mockResolvedValue(incident);
      mockIncidentRepository.saveWithAudit.mockResolvedValue(updatedIncident);
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(
        { id: 'incident-uuid-001', status: 'IN_PROGRESS' },
        'ops@coordinadora.com',
        'trace-cache-001',
      );

      expect(mockMetricsBroadcast.invalidateAndBroadcast).toHaveBeenCalledTimes(1);
    });
  });
});