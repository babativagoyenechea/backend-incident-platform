export class IncidentStatus {
  // Mapa de transiciones válidas. RESOLVED no tiene salidas: un incidente
  // resuelto queda congelado y no puede revertirse desde aquí.
  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    OPEN:        ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED', 'OPEN'],
    RESOLVED:    [],
  };

  constructor(private readonly value: string) {
    const valid = Object.keys(IncidentStatus.VALID_TRANSITIONS);
    if (!valid.includes(value)) {
      throw new Error(`Estado de incidente inválido: ${value}`);
    }
  }

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