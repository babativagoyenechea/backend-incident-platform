/// <reference types="jest" />
/**
 * PRUEBA DE INTEGRACIÓN — CreateIncidentUseCase
 *
 * Valida la orquestación completa del caso de uso:
 * 1. Construcción de la entidad de dominio Incident
 * 2. Persistencia atómica con auditoría (saveWithAudit)
 * 3. Invalidación de caché Redis y broadcast de métricas
 *
 * Estrategia: mocks manuales de IIncidentRepository, Redis y EventsGateway
 * para aislar la lógica de negocio sin levantar infraestructura real.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CreateIncidentUseCase } from '../create-incident.use-case';
import { MetricsBroadcastService } from '../../../../shared/application/services/metrics-broadcast.service';
import { Incident } from '../../../domain/entities/incident.entity';
import { IncidentAudit } from '../../../domain/entities/incident-audit.entity';
import { CreateIncidentDto } from '../../dtos/create-incident.dto';

// ── Fábricas de mocks ─────────────────────────────────────────────────────────

const buildIncidentMock = (overrides: Partial<Incident> = {}): Incident =>
  new Incident(
    overrides.id ?? 'uuid-incident-001',
    overrides.title ?? 'Servicio de pagos caído',
    overrides.description ?? 'El gateway no responde',
    overrides.affectedApp ?? 'payment-service',
    overrides.severity ?? 'CRITICAL',
    overrides.status ?? 'OPEN',
    overrides.assignee ?? 'ops-team@coordinadora.com',
    overrides.relatedEventTraceIds ?? ['trace-evt-001'],
    overrides.createdAt ?? new Date('2026-01-15T10:00:00Z'),
    overrides.updatedAt ?? new Date('2026-01-15T10:00:00Z'),
  );

const mockIncidentRepository = {
  saveWithAudit: jest.fn(),
  findById: jest.fn(),
  findByFilters: jest.fn(),
  countByStatus: jest.fn(),
};

const mockMetricsBroadcast = {
  invalidateAndBroadcast: jest.fn(),
};

// ── Suite principal ────────────────────────────────────────────────────────────

describe('[Integración] CreateIncidentUseCase', () => {
  let useCase: CreateIncidentUseCase;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateIncidentUseCase,
        { provide: 'IIncidentRepository', useValue: mockIncidentRepository },
        { provide: MetricsBroadcastService, useValue: mockMetricsBroadcast },
      ],
    }).compile();

    useCase = module.get<CreateIncidentUseCase>(CreateIncidentUseCase);

    jest.clearAllMocks();
  });

  // ── HU2: Creación exitosa ──────────────────────────────────────────────────

  describe('execute() — flujo exitoso', () => {
    it('debe persistir el incidente con estado OPEN y devolver la entidad guardada', async () => {
      const dto: CreateIncidentDto = {
        title: 'Servicio de pagos caído',
        description: 'El gateway no responde tras 5 reintentos',
        affectedApplication: 'payment-service',
        severity: 'CRITICAL',
        assignee: 'ops-team@coordinadora.com',
        relatedEventTraceIds: ['trace-evt-001', 'trace-evt-002'],
      };
      const expectedIncident = buildIncidentMock();
      mockIncidentRepository.saveWithAudit.mockResolvedValue(expectedIncident);
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      const result = await useCase.execute(dto, 'trace-test-001');

      expect(result).toBe(expectedIncident);
      expect(mockIncidentRepository.saveWithAudit).toHaveBeenCalledTimes(1);
    });

    it('debe construir la entidad Incident con estado inicial OPEN sin importar el DTO', async () => {
      const dto: CreateIncidentDto = {
        title: 'Timeout en servicio de envíos',
        affectedApplication: 'shipping-service',
        severity: 'HIGH',
      };
      const capturedIncident = buildIncidentMock({ status: 'OPEN' });
      mockIncidentRepository.saveWithAudit.mockImplementation(
        (incident: Incident) => Promise.resolve(incident),
      );
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(dto, 'trace-test-002');

      const [incidentArg] = mockIncidentRepository.saveWithAudit.mock.calls[0] as [Incident, IncidentAudit];
      expect(incidentArg.status).toBe('OPEN');
      expect(incidentArg.title).toBe('Timeout en servicio de envíos');
      expect(incidentArg.affectedApp).toBe('shipping-service');
      expect(incidentArg.severity).toBe('HIGH');
    });

    it('debe asignar UNASSIGNED como responsable cuando no se especifica assignee', async () => {
      const dto: CreateIncidentDto = {
        title: 'Alerta sin asignado',
        affectedApplication: 'auth-service',
        severity: 'LOW',
      };
      mockIncidentRepository.saveWithAudit.mockImplementation(
        (incident: Incident) => Promise.resolve(incident),
      );
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(dto, 'trace-no-assignee');

      const [incidentArg] = mockIncidentRepository.saveWithAudit.mock.calls[0] as [Incident, IncidentAudit];
      expect(incidentArg.assignee).toBe('UNASSIGNED');
    });

    it('debe crear el registro de auditoría con oldStatus=OPEN y newStatus=OPEN al crear', async () => {
      const dto: CreateIncidentDto = {
        title: 'Incidente de auditoría',
        affectedApplication: 'inventory-service',
        severity: 'MEDIUM',
      };
      mockIncidentRepository.saveWithAudit.mockImplementation(
        (incident: Incident) => Promise.resolve(incident),
      );
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(dto, 'trace-audit-test');

      const [, auditArg] = mockIncidentRepository.saveWithAudit.mock.calls[0] as [Incident, IncidentAudit];
      expect(auditArg.oldStatus).toBe('OPEN');
      expect(auditArg.newStatus).toBe('OPEN');
      expect(auditArg.changedBy).toBe('SYSTEM');
      expect(auditArg.traceId).toBe('trace-audit-test');
    });

    it('debe incluir los relatedEventTraceIds del DTO en la entidad', async () => {
      const traceIds = ['trace-evt-A', 'trace-evt-B', 'trace-evt-C'];
      const dto: CreateIncidentDto = {
        title: 'Incidente multi-evento',
        affectedApplication: 'payment-service',
        severity: 'CRITICAL',
        relatedEventTraceIds: traceIds,
      };
      mockIncidentRepository.saveWithAudit.mockImplementation(
        (incident: Incident) => Promise.resolve(incident),
      );
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(dto, 'trace-multi-evt');

      const [incidentArg] = mockIncidentRepository.saveWithAudit.mock.calls[0] as [Incident, IncidentAudit];
      expect(incidentArg.relatedEventTraceIds).toEqual(traceIds);
    });

    it('debe inicializar relatedEventTraceIds como array vacío cuando no se provee', async () => {
      const dto: CreateIncidentDto = {
        title: 'Incidente sin eventos asociados',
        affectedApplication: 'batch-service',
        severity: 'LOW',
      };
      mockIncidentRepository.saveWithAudit.mockImplementation(
        (incident: Incident) => Promise.resolve(incident),
      );
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(dto, 'trace-no-events');

      const [incidentArg] = mockIncidentRepository.saveWithAudit.mock.calls[0] as [Incident, IncidentAudit];
      expect(incidentArg.relatedEventTraceIds).toEqual([]);
    });
  });

  // ── HU4: Invalidación de caché tras creación ───────────────────────────────

  describe('execute() — invalidación de caché y broadcast', () => {
    it('debe invocar invalidateAndBroadcast después de persistir el incidente', async () => {
      const dto: CreateIncidentDto = {
        title: 'Incidente para caché',
        affectedApplication: 'cache-service',
        severity: 'HIGH',
      };
      const savedIncident = buildIncidentMock();
      mockIncidentRepository.saveWithAudit.mockResolvedValue(savedIncident);
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(dto, 'trace-cache-001');

      expect(mockMetricsBroadcast.invalidateAndBroadcast).toHaveBeenCalledTimes(1);
    });

    it('debe invocar invalidateAndBroadcast incluso cuando la persistencia devuelve incidente con campos mínimos', async () => {
      const dto: CreateIncidentDto = {
        title: 'Mínimo',
        affectedApplication: 'minimal-service',
        severity: 'LOW',
      };
      mockIncidentRepository.saveWithAudit.mockResolvedValue(buildIncidentMock({ severity: 'LOW' }));
      mockMetricsBroadcast.invalidateAndBroadcast.mockResolvedValue(undefined);

      await useCase.execute(dto, 'trace-minimal');

      expect(mockMetricsBroadcast.invalidateAndBroadcast).toHaveBeenCalledTimes(1);
    });
  });

  // ── Manejo de errores ──────────────────────────────────────────────────────

  describe('execute() — manejo de fallos de infraestructura', () => {
    it('debe propagar el error si saveWithAudit falla y no invocar el broadcast', async () => {
      const dto: CreateIncidentDto = {
        title: 'Incidente con fallo de DB',
        affectedApplication: 'db-service',
        severity: 'CRITICAL',
      };
      mockIncidentRepository.saveWithAudit.mockRejectedValue(
        new Error('Connection to PostgreSQL lost'),
      );

      await expect(useCase.execute(dto, 'trace-db-fail')).rejects.toThrow(
        'Connection to PostgreSQL lost',
      );
      expect(mockMetricsBroadcast.invalidateAndBroadcast).not.toHaveBeenCalled();
    });

    it('debe lanzar el error si invalidateAndBroadcast falla después de persistir', async () => {
      const dto: CreateIncidentDto = {
        title: 'Incidente con fallo de Redis',
        affectedApplication: 'redis-service',
        severity: 'MEDIUM',
      };
      mockIncidentRepository.saveWithAudit.mockResolvedValue(buildIncidentMock());
      mockMetricsBroadcast.invalidateAndBroadcast.mockRejectedValue(
        new Error('Redis connection refused'),
      );

      await expect(useCase.execute(dto, 'trace-redis-fail')).rejects.toThrow(
        'Redis connection refused',
      );
    });
  });
});