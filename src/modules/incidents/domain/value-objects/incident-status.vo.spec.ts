import { IncidentStatus } from './incident-status.vo';

describe('IncidentStatus (Value Object)', () => {
  it('inicializa un estado de incidente válido', () => {
    const status = new IncidentStatus('OPEN');
    expect(status.getValue()).toBe('OPEN');
  });

  it('lanza excepción con un estado inválido', () => {
    expect(() => new IncidentStatus('ESTADO_CORRUPTO_INEXISTENTE')).toThrow(
      'Estado de incidente inválido: ESTADO_CORRUPTO_INEXISTENTE',
    );
  });

  describe('canTransitionTo()', () => {
    it('permite la transición de OPEN a IN_PROGRESS', () => {
      const current = new IncidentStatus('OPEN');
      const next    = new IncidentStatus('IN_PROGRESS');
      expect(current.canTransitionTo(next)).toBe(true);
    });

    it('prohíbe saltar de OPEN a RESOLVED directamente', () => {
      const current = new IncidentStatus('OPEN');
      const next    = new IncidentStatus('RESOLVED');
      expect(current.canTransitionTo(next)).toBe(false);
    });

    it('permite pasar de IN_PROGRESS a RESOLVED o volver a OPEN', () => {
      const current = new IncidentStatus('IN_PROGRESS');
      expect(current.canTransitionTo(new IncidentStatus('RESOLVED'))).toBe(true);
      expect(current.canTransitionTo(new IncidentStatus('OPEN'))).toBe(true);
    });

    it('congela el estado RESOLVED — no admite ninguna transición', () => {
      const current = new IncidentStatus('RESOLVED');
      expect(current.canTransitionTo(new IncidentStatus('IN_PROGRESS'))).toBe(false);
      expect(current.canTransitionTo(new IncidentStatus('OPEN'))).toBe(false);
    });
  });
});