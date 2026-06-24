import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayInit {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit() {
    this.logger.log('Gateway WebSocket inicializado');
  }

  emitAlertCreated(alert: any) {
    this.server.emit('alert.created', {
      ...alert,
      _timestamp: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    });
  }

  emitIncidentUpdated(incident: any) {
    this.server.emit('incident.updated', {
      ...incident,
      _timestamp: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    });
  }

  emitMetricsUpdated(metrics: any) {
    this.server.emit('metrics.updated', {
      ...metrics,
      _timestamp: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    });
  }
}