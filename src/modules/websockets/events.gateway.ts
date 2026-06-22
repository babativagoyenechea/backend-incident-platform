import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

function withDescription<T extends object>(
  payload: T,
  descripcion: string,
  resumen: string,
): T & { _descripcion: string; _resumen: string; _timestamp: string } {
  return {
    ...payload,
    _descripcion: descripcion,
    _resumen:     resumen,
    _timestamp:   new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
  };
}

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayInit {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Gateway WebSocket inicializado con éxito');
  }

  /**
   * Se emite cuando el worker de BullMQ procesa y guarda una alerta en MongoDB.
   * El frontend lo recibe como 'alert.created'.
   */
  emitAlertCreated(alert: any) {
    const enriched = withDescription(
      alert,
      `Se generó una nueva alerta automática para la aplicación "${alert.affectedApplication ?? 'desconocida'}" ` +
        `con severidad ${alert.severity ?? '?'}. Esto significa que el sistema detectó un evento fuera de lo normal ` +
        `y lo escaló para que el equipo de soporte pueda revisarlo.`,
      'Nueva alerta de sistema',
    );
    this.server.emit('alert.created', enriched);
  }

  /**
   * Se emite cuando un incidente cambia de estado (OPEN → IN_PROGRESS → RESOLVED).
   * El frontend lo recibe como 'incident.updated'.
   */
  emitIncidentUpdated(incident: any) {
    const estadoMap: Record<string, string> = {
      OPEN:        'Abierto',
      IN_PROGRESS: 'En progreso',
      RESOLVED:    'Resuelto',
    };
    const estadoLegible = estadoMap[incident.status] ?? incident.status;

    const enriched = withDescription(
      incident,
      `El incidente "${incident.title ?? 'sin título'}" cambió su estado a "${estadoLegible}". ` +
        `Esto indica que alguien del equipo actualizó el ciclo de vida del problema. ` +
        `El panel se actualizará automáticamente.`,
      'Incidente actualizado',
    );
    this.server.emit('incident.updated', enriched);
  }

  /**
   * Se emite cada vez que se invalida el caché de Redis y se recalculan
   * las métricas del dashboard (al crear o actualizar incidentes/alertas).
   * El frontend lo recibe como 'metrics.updated'.
   */
  emitMetricsUpdated(metrics: any) {
    const enriched = withDescription(
      metrics,
      `Los contadores del panel se recalcularon en tiempo real. ` +
        `Hay ${metrics.openIncidents ?? '?'} incidente(s) abierto(s) y ` +
        `${metrics.resolvedIncidents ?? '?'} resuelto(s). ` +
        `Esta actualización ocurrió porque se registró o modificó algún dato en el sistema.`,
      'Panel de control actualizado',
    );
    this.server.emit('metrics.updated', enriched);
  }
}
