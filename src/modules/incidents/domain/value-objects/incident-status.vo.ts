export class IncidentStatus {
  // Matriz estricta de transiciones permitidas por el negocio
  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED', 'OPEN'], // 'OPEN' permite reaperturas
    RESOLVED: [], // Un incidente resuelto queda congelado
  };

  constructor(private readonly value: string) {
    const validStatuses = Object.keys(IncidentStatus.VALID_TRANSITIONS);
    if (!validStatuses.includes(value)) {
      throw new Error(`Estado de incidente inválido: ${value}`);
    }
  }

  // Valida si es posible avanzar del estado actual al solicitado
  canTransitionTo(next: IncidentStatus): boolean {
    return IncidentStatus.VALID_TRANSITIONS[this.value].includes(next.getValue());
  }

  getValue(): string {
    return this.value;
  }

  toString(): string {
    return this.value;
  }
}