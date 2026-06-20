import { IncidentStatus } from './incident-status.vo';

describe('IncidentStatus (Value Object) — Pruebas Unitarias', () => {
  it('Debe inicializar un estado de incidente válido', () => {
    const status = new IncidentStatus('OPEN');
    expect(status.getValue()).toBe('OPEN');
  });

  it('Debe lanzar una excepción al intentar inicializar con un estado inválido', () => {
    expect(() => new IncidentStatus('ESTADO_CORRUPTO_INEXISTENTE')).toThrow(
      'Estado de incidente inválido: ESTADO_CORRUPTO_INEXISTENTE',
    );
  });

  describe('canTransitionTo() — Máquina de Estados', () => {
    it('Debe permitir la transición reglamentaria de OPEN a IN_PROGRESS', () => {
      const current = new IncidentStatus('OPEN');
      const next = new IncidentStatus('IN_PROGRESS');
      expect(current.canTransitionTo(next)).toBe(true);
    });

    it('Debe prohibir la transición directa no permitida de OPEN a RESOLVED', () => {
      const current = new IncidentStatus('OPEN');
      const next = new IncidentStatus('RESOLVED');
      expect(current.canTransitionTo(next)).toBe(false);
    });

    it('Debe permitir pasar de IN_PROGRESS a RESOLVED o volver a abrirlo en OPEN', () => {
      const current = new IncidentStatus('IN_PROGRESS');
      const resolved = new IncidentStatus('RESOLVED');
      const open = new IncidentStatus('OPEN');

      expect(current.canTransitionTo(resolved)).toBe(true);
      expect(current.canTransitionTo(open)).toBe(true);
    });

    it('Debe congelar el estado RESOLVED e impedir cualquier transición posterior', () => {
      const current = new IncidentStatus('RESOLVED');
      const nextProgress = new IncidentStatus('IN_PROGRESS');
      const nextOpen = new IncidentStatus('OPEN');

      expect(current.canTransitionTo(nextProgress)).toBe(false);
      expect(current.canTransitionTo(nextOpen)).toBe(false);
    });
  });
});
