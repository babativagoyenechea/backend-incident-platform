# Plataforma de Monitoreo Operacional
 
> **README Maestro de la Solución Global**
>
> Este documento vive en la raíz del repositorio de Backend pero cubre el ecosistema completo: Backend (NestJS/DDD), Frontend (React) y Script de Integración Legacy (PHP). Antes de ejecutar Docker Compose, consulta la sección [§10 Instalación y Ejecución](#10-instalación-y-ejecución) para clonar ambos repositorios de forma coordinada.
 
---
 
## Tabla de Contenidos
 
1. [Vista General y Justificación Tecnológica](#1-vista-general-y-justificación-tecnológica)
2. [Arquitectura de Software & DDD Puro](#2-arquitectura-de-software--ddd-puro)
3. [Decisiones de Ingeniería](#3-decisiones-de-ingeniería)
4. [Procesamiento Asíncrono de Alertas (HU3)](#4-procesamiento-asíncrono-de-alertas-hu3)
5. [Estrategia de Caché e Invalidación Activa (HU4)](#5-estrategia-de-caché-e-invalidación-activa-hu4)
6. [Seguridad, Resiliencia y Transversales](#6-seguridad-resiliencia-y-transversales)
7. [Contratos de la API & Paginación](#7-contratos-de-la-api--paginación)
8. [Integración con el Sistema Legacy (HU5)](#8-integración-con-el-sistema-legacy-hu5)
9. [Estructura del Proyecto](#9-estructura-del-proyecto)
10. [Instalación y Ejecución](#10-instalación-y-ejecución)
    - [10.5 Plan de Verificación Funcional](#105-plan-de-verificación-funcional-paso-a-paso)
11. [Cobertura de Pruebas Unitarias y de Integración](#11-cobertura-de-pruebas-unitarias-y-de-integración)
12. [Flujo de Trabajo Git y Estrategia de Ramas](#12-flujo-de-trabajo-git-y-estrategia-de-ramas)
13. [Mapeo a Criterios de Evaluación](#13-mapeo-a-criterios-de-evaluación)
---
 
## 1. Vista General y Justificación Tecnológica
 
La plataforma centraliza el ciclo de vida operacional de una empresa de tecnología que procesa miles de transacciones diarias: ingesta eventos desde múltiples sistemas externos, convierte los eventos críticos en incidentes rastreables, genera alertas de forma asíncrona y expone métricas en tiempo real a un dashboard React. También es interoperable con sistemas heredados PHP mediante una API autenticada por API Key.
 
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ECOSISTEMA GLOBAL                                  │
│                                                                                 │
│   ┌───────────────┐      HTTP / WS       ┌──────────────────────────────────┐  │
│   │   Dashboard   │ ◄──────────────────► │        NestJS API  (DDD)         │  │
│   │  React / Vite │      socket.io       │           :3000  /api            │  │
│   └───────────────┘                      │                                  │  │
│                                          │   ┌───────────┐  ┌────────────┐  │  │
│   ┌───────────────┐     x-api-key        │   │  BullMQ   │  │ WebSocket  │  │  │
│   │  Script PHP   │ ──────────────────►  │   │  Worker   │  │  Gateway   │  │  │
│   │    Legacy     │                      │   └─────┬─────┘  └─────┬──────┘  │  │
│   └───────────────┘                      └─────────┼──────────────┼─────────┘  │
│                                                    │              │             │
│   ┌────────────┐  ┌───────────┐  ┌────────────────┴──┐  ┌────────┴──────────┐  │
│   │ PostgreSQL │  │  MongoDB  │  │    Redis  DB0      │  │    Redis  DB1     │  │
│   │ incidents  │  │ events +  │  │     Caché          │  │     BullMQ        │  │
│   │  + audit   │  │  alerts   │  │    (TTL 30 s)      │  │      Colas        │  │
│   └────────────┘  └───────────┘  └───────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```
 
### Justificación de cada tecnología de persistencia
 
#### PostgreSQL
 
Almacena las tablas `incidents` e `incident_audit`. La elección responde a la necesidad de consistencia ACID estricta: crear un incidente y registrar su auditoría inicial deben ocurrir dentro de la misma transacción o fallar juntos. El motor define además tipos `ENUM` nativos (`incident_status`, `severity_level`) e índices compuestos sobre `status`, `severity`, `affected_app` y `created_at DESC` para soportar los filtros del dashboard sin full-scans.
 
#### MongoDB
 
Almacena las colecciones `events` y `alerts`. Los eventos operacionales provienen de múltiples aplicaciones con esquemas heterogéneos: incluyen un campo `metadata` libre (`Record<string, any>`) que varía según el sistema origen. La naturaleza documental de MongoDB permite ingestar este volumen variable sin migraciones de esquema, y sus operaciones de agregación (`$group`) calculan directamente las métricas `eventsByApp` y `eventsBySeverity` para el dashboard.
 
#### Redis — Doble Rol
 
Redis opera con **doble rol sobre una sola instancia**, diferenciados por número de base de datos lógica:
 
- **`DB0`** (`REDIS_CACHE_DB=0`) — caché analítica del dashboard con TTL de 30 segundos (Cache Aside Pattern). Las claves se invalidan activamente desde `MetricsBroadcastService` en cada mutación relevante.
- **`DB1`** (`REDIS_QUEUE_DB=1`) — backend de BullMQ para la cola `alert-processing` y la Dead Letter Queue `alert-processing-failed`. Separar ambos roles en bases de datos distintas evita colisiones de claves y permite monitorear el throughput de colas de forma independiente.
---
 
## 2. Arquitectura de Software & DDD Puro
 
El backend sigue una arquitectura de cuatro capas dentro de cada módulo NestJS. La regla fundamental es que las dependencias solo fluyen hacia adentro: `Presentation → Application → Domain`, e `Infrastructure` implementa los puertos que el `Domain` define.
 
```
src/modules/<contexto>/
│
├── domain/                    ←  Núcleo puro: sin decoradores NestJS, sin ORM
│   ├── entities/              ←  Entidades de dominio  (Incident, Event, Alert)
│   ├── value-objects/         ←  VOs con invariantes   (IncidentStatus)
│   └── repositories/         ←  Interfaces (puertos): IIncidentRepository, etc.
│
├── application/               ←  Casos de uso: orquestan dominio + puertos
│   ├── dtos/                  ←  Contratos de entrada validados con class-validator
│   └── use-cases/             ←  CreateIncidentUseCase, RegisterEventUseCase…
│
├── infrastructure/            ←  Implementaciones: TypeORM, Mongoose, BullMQ
│   ├── persistence/           ←  Repositorios concretos + ORM Entities
│   └── queue/                 ←  AlertWorker, bullmq.config.ts
│
└── presentation/              ←  Controladores HTTP: solo enrutan, sin lógica
    └── controllers/
```
 
### Value Object `IncidentStatus` — Máquina de Estados
 
El archivo `src/modules/incidents/domain/value-objects/incident-status.vo.ts` encapsula todas las reglas de transición de estado. No es un simple string: es un tipo con invariantes que protegen el dominio contra transiciones ilegales.
 
```typescript
export class IncidentStatus {
  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    OPEN:        ['IN_PROGRESS'],
    IN_PROGRESS: ['RESOLVED', 'OPEN'],  // permite reaperturas
    RESOLVED:    [],                     // un incidente resuelto queda congelado
  };
 
  constructor(private readonly value: string) {
    const validStatuses = Object.keys(IncidentStatus.VALID_TRANSITIONS);
    if (!validStatuses.includes(value)) {
      throw new Error(`Estado de incidente inválido: ${value}`);
    }
  }
 
  canTransitionTo(next: IncidentStatus): boolean {
    return IncidentStatus.VALID_TRANSITIONS[this.value].includes(next.getValue());
  }
 
  getValue(): string { return this.value; }
  toString(): string { return this.value; }
}
```
 
`UpdateIncidentStatusUseCase` instancia dos `IncidentStatus` (el actual y el deseado) y llama `current.canTransitionTo(next)` antes de persistir. Si la transición es inválida, lanza un `ConflictException` que el `GlobalExceptionFilter` serializa como **HTTP 409**.
 
---
 
## 3. Decisiones de Ingeniería
 
### Consistencia ACID Real con `QueryRunner`
 
**Archivo:** `src/modules/incidents/infrastructure/persistence/typeorm-incident.repository.ts`
 
El método `saveWithAudit` envuelve atómicamente la escritura del incidente y su registro de auditoría. Si el `save` del incidente falla, el `save` de auditoría no se ejecuta. Si la auditoría falla tras guardar el incidente, el `rollbackTransaction` revierte ambas operaciones.
 
```typescript
async saveWithAudit(incident: Incident, audit: IncidentAudit): Promise<Incident> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
 
  try {
    const savedEntity = await queryRunner.manager.save(IncidentOrmEntity, ormEntity);
 
    const ormAudit       = new IncidentAuditOrmEntity();
    ormAudit.incidentId  = savedEntity.id;
    ormAudit.oldStatus   = audit.oldStatus;
    ormAudit.newStatus   = audit.newStatus;
    ormAudit.changedBy   = audit.changedBy;
    ormAudit.traceId     = audit.traceId;
 
    await queryRunner.manager.save(IncidentAuditOrmEntity, ormAudit);
    await queryRunner.commitTransaction();
    return this.toDomain(savedEntity);
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
```
 
### Tipado Nativo de Arreglos `TEXT[]`
 
**Archivo:** `src/modules/incidents/infrastructure/persistence/entities/incident.orm-entity.ts`
 
La columna `relatedEventTraceIds` usa el tipo nativo de PostgreSQL (`TEXT[]`) en lugar de `simple-array`, que serializa el array como un string CSV (`"a,b,c"`) perdiendo el tipado nativo y generando bugs al buscar por trace IDs que contengan comas.
 
```typescript
@Column({ name: 'related_event_trace_ids', type: 'text', array: true, nullable: true })
relatedEventTraceIds!: string[];
```
 
El DDL en `infra/init.sql` declara la columna de forma coherente: `related_event_trace_ids TEXT[]`.
 
### Límites en Paginación
 
**DTO:** `src/modules/incidents/application/dtos/incident-filters.dto.ts`
**Repositorio:** `src/modules/incidents/infrastructure/persistence/typeorm-incident.repository.ts`
 
La defensa opera en dos capas. El DTO rechaza la petición con HTTP 400 antes de que llegue al repositorio:
 
```typescript
@IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
```
 
Y el repositorio aplica una segunda guardia con `Math.min` por si el valor llega por otra vía:
 
```typescript
const page  = Math.max(Number(filters.page  ?? 1),  1);
const limit = Math.min(Number(filters.limit ?? 20), 100);
```
 
### Ubicación del Worker en Infraestructura
 
**Archivo:** `src/modules/alerts/infrastructure/queue/alert.worker.ts`
 
El `AlertWorker` reside en `infrastructure/queue/`, no en `application/`. El Worker es un adaptador de entrada hacia BullMQ: conoce la API concreta de `bullmq` (`Job`, `WorkerHost`, `@Processor`), lo que lo convierte en un detalle de infraestructura. La capa de Application no importa frameworks externos; solo orquesta casos de uso a través de puertos abstractos. El Worker delega toda la lógica de negocio al caso de uso `CreateAlertUseCase`, que vive en `application/`.
 
---
 
## 4. Procesamiento Asíncrono de Alertas (HU3)
 
El flujo desacoplado garantiza que la ingesta de eventos (`POST /api/events`) responda en milisegundos sin esperar la creación de alertas. El acoplamiento ocurre exclusivamente a través de la cola BullMQ.
 
```
POST /api/events  (severity = CRITICAL)
          │
          ▼
 RegisterEventUseCase.execute()
          │
          │   1.  Persiste Event en MongoDB
          │   2.  Si severity === 'CRITICAL':
          │         alertQueue.add('process-alert', payload, defaultJobOptions)
          │
          ▼
   [ responde { traceId } al cliente en ~5 ms ]
 
          ▼  (asíncrono — Worker independiente)
 AlertWorker.process(job)
          │
          │   1.  createAlert.execute()
          │         └─►  persiste Alert en MongoDB
          │
          │   2.  gateway.emitAlertCreated(alert)
          │         └─►  WS: evento  'alert.created'
          │
          │   3.  metricsBroadcast.invalidateAndBroadcast()
          │         ├─►  redis.del('dashboard:metrics')
          │         ├─►  getMetrics.execute()   (refresca caché)
          │         └─►  gateway.emitMetricsUpdated(metrics)
          │                └─►  WS: evento  'metrics.updated'
          ▼
```
 
### Configuración de `defaultJobOptions`
 
**Archivo:** `src/modules/alerts/infrastructure/queue/bullmq.config.ts`
 
```typescript
export const ALERT_QUEUE_NAME = 'alert-processing';
export const ALERT_DLQ_NAME   = 'alert-processing-failed';
 
export const defaultJobOptions: JobsOptions = {
  attempts:  3,
  backoff:   { type: 'exponential', delay: 1000 },  // 1 s → 2 s → 4 s
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 50  },
};
```
 
Cuando un job agota sus 3 intentos, el Worker lo reencola en `ALERT_DLQ_NAME` con `removeOnComplete: false` para conservar el rastro de fallos sin pérdida de información.
 
---
 
## 5. Estrategia de Caché e Invalidación Activa (HU4)
 
### Cache Aside Pattern — `GetDashboardMetricsUseCase`
 
**Archivo:** `src/modules/dashboard/application/use-cases/get-dashboard-metrics.use-case.ts`
 
```typescript
private readonly CACHE_KEY   = 'dashboard:metrics';
private readonly TTL_SECONDS = 30;
 
async execute(): Promise<DashboardMetrics> {
 
  const cached = await this.redis.get(this.CACHE_KEY);
  if (cached) {
    return JSON.parse(cached); // Cache HIT: respuesta ~1 ms
  }
 
  const [openCount, resolvedCount, eventsByApp, eventsBySeverity, recentAlerts] =
    await Promise.all([
      this.incidentRepo.countByStatus('OPEN'),
      this.incidentRepo.countByStatus('RESOLVED'),
      this.eventRepo.groupByApplication(),
      this.eventRepo.groupBySeverity(),
      this.alertRepo.findRecent(10),
    ]);
 
  await this.redis.set(this.CACHE_KEY, JSON.stringify(metrics), 'EX', this.TTL_SECONDS);
 
  return metrics;
}
```
 
### Invalidación Activa y Difusión en Tiempo Real
 
**Archivo:** `src/modules/shared/application/services/metrics-broadcast.service.ts`
 
La invalidación no espera a que expire el TTL: cada mutación relevante (creación de alerta, cambio de estado de incidente) llama a `invalidateAndBroadcast()`, que borra la clave de Redis y difunde las métricas frescas por WebSocket.
 
```typescript
async invalidateAndBroadcast(): Promise<void> {
  await this.redis.del('dashboard:metrics');
  const freshMetrics = await this.getMetrics.execute();
  this.gateway.emitMetricsUpdated(freshMetrics);
}
```
 
El `EventsGateway` (`src/modules/websockets/events.gateway.ts`) emite tres eventos Socket.IO distintos:
 
| Evento WebSocket   | Cuándo se emite                           |
|--------------------|-------------------------------------------|
| `alert.created`    | Al procesar un job de alerta exitosamente |
| `incident.updated` | Al cambiar el estado de un incidente      |
| `metrics.updated`  | Tras cada invalidación activa de caché    |
 
El Frontend (`src/hooks/useLiveMetrics.ts`) suscribe al evento `metrics.updated` y actualiza el `DashboardContext` sin polling.
 
---
 
## 6. Seguridad, Resiliencia y Transversales
 
### JWT — Autenticación de Operadores Internos
 
**Archivos:** `src/modules/shared/auth.module.ts` · `src/modules/shared/guards/jwt.strategy.ts` · `src/modules/shared/guards/jwt-auth.guard.ts`
 
La estrategia Passport JWT extrae el token del header `Authorization: Bearer <token>`, lo verifica contra `JWT_SECRET` y rechaza tokens expirados (`ignoreExpiration: false`). Protege los endpoints del Dashboard React:
 
- `POST /api/incidents`
- `GET  /api/incidents/:id`
- `PATCH /api/incidents/:id/status`
Para desarrollo, `POST /api/auth/token` genera un token sin credenciales (solo para evaluación).
 
### API Key — Autenticación de Sistemas Legacy
 
**Archivo:** `src/modules/shared/guards/api-key.guard.ts`
 
`ApiKeyGuard` extrae el header `x-api-key` y lo compara contra la variable de entorno `LEGACY_API_KEY`. Protege exclusivamente `GET /api/incidents` (listado paginado), que es el único endpoint consumido por el script PHP. Esta separación permite revocar la API Key de sistemas externos sin afectar los tokens JWT de operadores internos.
 
```typescript
canActivate(context: ExecutionContext): boolean {
  const apiKey        = request.headers['x-api-key'];
  const configuredKey = this.config.get<string>('LEGACY_API_KEY');
  if (!apiKey || apiKey !== configuredKey) {
    throw new UnauthorizedException('API Key faltante o inválida para este recurso externo');
  }
  return true;
}
```
 
### Rate Limiting (Throttler)
 
**Configuración global:** `src/app.module.ts`
 
```typescript
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])
```
 
Aplicado a todos los endpoints mediante `APP_GUARD`.
 
**Configuración específica:** `POST /api/events` eleva el umbral a **500 peticiones por minuto** con `@Throttle({ default: { ttl: 60000, limit: 500 } })`, dado que puede recibir ráfagas desde múltiples sistemas externos al mismo tiempo.
 
### `TraceIdInterceptor` — Trazabilidad End-to-End
 
**Archivo:** `src/modules/shared/interceptors/trace-id.interceptor.ts`
 
Aplicado globalmente en `main.ts`, el interceptor opera en cada request:
 
1. Lee el header `x-trace-id` enviado por el cliente (o genera un UUID v4 si no existe).
2. Inyecta el valor en `request.traceId` para que los casos de uso lo propaguen a las entidades de dominio y los logs.
3. Reenvía el mismo `x-trace-id` en el header de la respuesta.
Esto permite rastrear el recorrido completo de un evento —desde el sistema externo que lo emitió hasta la alerta generada en MongoDB— con un único identificador en todos los logs estructurados JSON.
 
### Health Check Personalizado
 
**Archivo:** `src/modules/health/health.controller.ts`
 
`GET /health` hace ping activo a las tres dependencias críticas de forma independiente. El check de Redis no usa `@nestjs/terminus` nativo sino una llamada directa `this.redis.ping()` al cliente `REDIS_CACHE` (DB0):
 
```typescript
async () => {
  try {
    await this.redis.ping();
    return { redis: { status: 'up' } };
  } catch {
    throw new HealthCheckError('Redis cache check failed', { redis: { status: 'down' } });
  }
}
```
 
---
 
## 7. Contratos de la API & Paginación
 
La Swagger UI completa está disponible en `http://localhost:3000/api/docs` una vez levantado el proyecto.
 
| Método  | Ruta                        | Autenticación | Descripción                                              |
|---------|-----------------------------|---------------|----------------------------------------------------------|
| `POST`  | `/api/auth/token`           | Ninguna       | Genera token JWT de desarrollo para evaluación           |
| `POST`  | `/api/events`               | Ninguna ¹     | Registra evento operacional (MongoDB). Rate: 500/min     |
| `POST`  | `/api/incidents`            | JWT Bearer    | Crea incidente y su entrada de auditoría (PostgreSQL)    |
| `GET`   | `/api/incidents`            | API Key       | Lista incidentes paginados con filtros (sistemas legacy) |
| `GET`   | `/api/incidents/:id`        | JWT Bearer    | Obtiene un incidente completo por UUID                   |
| `PATCH` | `/api/incidents/:id/status` | JWT Bearer    | Transiciona el estado con auditoría atómica              |
| `GET`   | `/api/dashboard/metrics`    | JWT Bearer    | Métricas consolidadas (Cache Aside, TTL 30 s)            |
| `GET`   | `/health`                   | Ninguna       | Estado de PostgreSQL, MongoDB y Redis                    |
 
> ¹ Acepta peticiones sin autenticación para facilitar la ingesta desde múltiples sistemas externos, pero está protegido por Rate Limiting estricto.
 
### Payloads de Ejemplo
 
**`POST /api/events`**
 
```json
{
  "application": "payment-service",
  "eventType":   "TRANSACTION_TIMEOUT",
  "description": "Gateway de pagos no responde tras 5000 ms",
  "severity":    "CRITICAL",
  "occurredAt":  "2026-06-19T20:00:00Z",
  "metadata":    { "gateway": "Stripe", "attempt": 3 }
}
```
 
Respuesta: `201 { "traceId": "b3a2f1e0-..." }`
 
**`POST /api/incidents`** *(requiere `Authorization: Bearer <token>`)*
 
```json
{
  "title":               "Timeout masivo en gateway de pagos",
  "description":         "Múltiples clientes reportan fallo en checkout",
  "affectedApplication": "payment-service",
  "severity":            "CRITICAL",
  "assignee":            "ops-team@coordinadora.com",
  "relatedEventTraceIds": ["b3a2f1e0-...", "c4d3e2f1-..."]
}
```
 
**`PATCH /api/incidents/:id/status`** *(requiere `Authorization: Bearer <token>`)*
 
```json
{ "status": "IN_PROGRESS" }
```
 
Transiciones válidas:
 
```
OPEN  →  IN_PROGRESS  →  RESOLVED
              ↑
             OPEN   (reaperturas)
```
 
> Una transición inválida (ej. `RESOLVED → OPEN`) retorna **HTTP 409**.
 
### Paginación
 
`GET /api/incidents` acepta los query params `page` (mín. 1) y `limit` (mín. 1, máx. 100). La respuesta incluye metadatos de paginación:
 
```json
{
  "data":       [ "..." ],
  "total":      47,
  "page":       2,
  "limit":      20,
  "totalPages": 3
}
```
 
---
 
## 8. Integración con el Sistema Legacy (HU5)
 
**Archivo:** `legacy/legacy-client.php`
 
El script PHP integra la nueva plataforma sin depender de frameworks: usa solo extensiones estándar disponibles en cualquier instalación PHP 7.4+.
 
### Mecanismo de Autenticación
 
Lee `LEGACY_API_KEY` desde variables de entorno (con fallback `'dev-key'` para ejecución fuera de Docker) y la adjunta en cada petición como header `x-api-key`.
 
### Cliente HTTP con cURL
 
Usa `curl_init()` en lugar de `file_get_contents()` por tres razones:
 
- **Control de timeout** (10 segundos) para evitar que un backend lento congele el script.
- **Soporte de headers personalizados** (`x-api-key`, `Accept: application/json`).
- **Universalidad**: disponible en cualquier instalación PHP sin extensiones adicionales.
### Manejo de Errores HTTP
 
Opera en dos niveles:
 
1. **Error de red** (`curl_errno !== 0`): imprime en `STDERR`, emite JSON de error y termina con `exit(1)`.
2. **Error HTTP** (`$httpStatus !== 200`): mismo flujo. El proceso padre (cron, otro script) detecta el exit code distinto de 0.
### Paginación
 
Acepta dos argumentos de línea de comandos: `php legacy-client.php <page> <limit>`. Por defecto consulta página 1 con límite 20. Filtra específicamente `status=OPEN` por contrato de HU5.
 
### Transformación de Respuesta
 
Mapea el payload completo de la API al subconjunto mínimo que requiere HU5:
 
```php
$incidentes = array_map(function ($incidente) {
    return [
        'id'         => $incidente['id'],
        'aplicacion' => $incidente['affectedApp'],
        'severidad'  => $incidente['severity'],
        'estado'     => $incidente['status'],
        'creado_en'  => $incidente['createdAt'],
    ];
}, $body['data']);
```
 
La salida incluye metadatos de paginación (`pagina_actual`, `total_paginas`, `total_registros`) y un resumen del total de incidentes abiertos encontrados en la página consultada.
 
---
 
## 9. Estructura del Proyecto
 
El workspace unificado contiene dos repositorios independientes clonados de forma adyacente, más el script legacy embebido en el backend.
 
```
plataforma-monitoreo/                       ←  Carpeta raíz del workspace unificado
│
├── backend/                                ←  Repositorio Backend  (NestJS + DDD)
│   ├── .env.example
│   ├── .env.development
│   ├── .env.test
│   ├── docker-compose.yml
│   ├── Dockerfile
│   │
│   ├── infra/
│   │   └── init.sql                        ←  DDL PostgreSQL (tipos ENUM, tablas, índices)
│   │
│   ├── legacy/
│   │   └── legacy-client.php               ←  Script de integración HU5
│   │
│   └── src/
│       ├── app.module.ts
│       ├── main.ts
│       │
│       └── modules/
│           ├── alerts/
│           │   ├── alerts.module.ts
│           │   ├── application/use-cases/create-alert.use-case.ts
│           │   ├── domain/
│           │   │   ├── entities/alert.entity.ts
│           │   │   └── repositories/i-alert.repository.ts
│           │   └── infrastructure/
│           │       ├── persistence/
│           │       │   ├── mongo-alert.repository.ts
│           │       │   └── schemas/alert.schema.ts
│           │       └── queue/
│           │           ├── alert.worker.ts        ←  Worker BullMQ
│           │           └── bullmq.config.ts       ←  defaultJobOptions
│           │
│           ├── dashboard/
│           │   ├── dashboard.module.ts
│           │   ├── application/use-cases/get-dashboard-metrics.use-case.ts
│           │   └── presentation/controllers/dashboard.controller.ts
│           │
│           ├── events/
│           │   ├── events.module.ts
│           │   ├── application/
│           │   │   ├── dtos/register-event.dto.ts
│           │   │   └── use-cases/
│           │   │       ├── register-event.use-case.ts
│           │   │       └── __tests__/register-event.use-case.integration.spec.ts
│           │   ├── domain/
│           │   │   ├── entities/event.entity.ts
│           │   │   ├── enums/event-severity.enum.ts
│           │   │   └── repositories/i-event.repository.ts
│           │   ├── infrastructure/persistence/
│           │   │   ├── mongo-event.repository.ts
│           │   │   └── schemas/event.schema.ts
│           │   └── presentation/controllers/event.controller.ts
│           │
│           ├── health/
│           │   ├── health.module.ts
│           │   └── health.controller.ts           ←  Ping activo a Redis, PG, Mongo
│           │
│           ├── incidents/
│           │   ├── incidents.module.ts
│           │   ├── application/
│           │   │   ├── dtos/
│           │   │   │   ├── create-incident.dto.ts
│           │   │   │   ├── incident-filters.dto.ts
│           │   │   │   └── update-status.dto.ts
│           │   │   └── use-cases/
│           │   │       ├── create-incident.use-case.ts
│           │   │       ├── update-incident-status.use-case.ts
│           │   │       └── __tests__/
│           │   │           ├── create-incident.use-case.integration.spec.ts
│           │   │           └── update-incident-status.use-case.integration.spec.ts
│           │   ├── domain/
│           │   │   ├── entities/
│           │   │   │   ├── incident.entity.ts
│           │   │   │   └── incident-audit.entity.ts
│           │   │   ├── repositories/i-incident.repository.ts
│           │   │   └── value-objects/
│           │   │       ├── incident-status.vo.ts       ←  Máquina de estados
│           │   │       └── incident-status.vo.spec.ts
│           │   ├── infrastructure/persistence/
│           │   │   ├── entities/
│           │   │   │   ├── incident.orm-entity.ts      ←  TEXT[] array: true
│           │   │   │   └── incident-audit.orm-entity.ts
│           │   │   └── typeorm-incident.repository.ts  ←  saveWithAudit + QueryRunner
│           │   └── presentation/controllers/incident.controller.ts
│           │
│           ├── shared/
│           │   ├── auth.module.ts
│           │   ├── application/services/metrics-broadcast.service.ts
│           │   ├── filters/global-exception.filter.ts
│           │   ├── guards/
│           │   │   ├── api-key.guard.ts
│           │   │   ├── jwt.strategy.ts
│           │   │   └── jwt-auth.guard.ts
│           │   ├── infrastructure/redis/redis.module.ts
│           │   ├── interceptors/trace-id.interceptor.ts
│           │   └── presentation/auth.controller.ts
│           │
│           └── websockets/
│               ├── websockets.module.ts
│               └── events.gateway.ts             ←  emit: alert.created / metrics.updated
│
└── frontend/                               ←  Repositorio Frontend  (React 19 + Vite)
    ├── Dockerfile
    ├── index.html
    └── src/
        ├── App.tsx
        ├── __tests__/
        │   └── Dashboard.test.tsx
        ├── components/
        │   ├── EventForm.tsx
        │   ├── IncidentFilters.tsx
        │   ├── IncidentForm.tsx
        │   ├── IncidentTable.tsx
        │   ├── SocketsConsole.tsx
        │   ├── SummaryWidgets.tsx
        │   └── Toast.tsx
        ├── context/DashboardContext.tsx
        ├── hooks/
        │   ├── useLiveMetrics.ts          ←  Socket.IO: suscribe a 'metrics.updated'
        │   └── useToast.ts
        ├── pages/Dashboard.tsx
        └── shared/
            ├── api.ts
            ├── types.ts
            └── utils.ts
```
 
---
 
## 10. Instalación y Ejecución
 
### Estrategia de Workspace Unificado
 
Los repositorios de Backend y Frontend son **repositorios GitHub independientes**. Sin embargo, el `docker-compose.yml` del backend referencia la carpeta del frontend con la ruta relativa `../frontend` (servicio `frontend`). Por esto, hay que clonarlos de forma **paralela dentro de una misma carpeta raíz** respetando los nombres de directorio exactos.
 
```bash
# 1. Crear y acceder al espacio de trabajo unificado
mkdir plataforma-monitoreo && cd plataforma-monitoreo
 
# 2. Clonar el repositorio de Backend
git clone <URL_DEL_REPOSITORIO_DE_BACKEND> backend
 
# 3. Clonar el repositorio de Frontend
git clone <URL_DEL_REPOSITORIO_DE_FRONTEND> frontend
```
 
La estructura resultante debe ser exactamente:
 
```
plataforma-monitoreo/
├── backend/     ←  docker-compose.yml vive aquí
└── frontend/    ←  referenciado como  ../frontend  desde docker-compose
```
 
### Prerrequisitos
 
- **Docker Desktop 4.x** o Docker Engine 24+ con Docker Compose v2 (`docker compose`)
- **Node.js 20+** y npm 10+ *(solo si se corre el backend fuera de Docker)*
- **PHP 8.2+** con extensión `curl` habilitada *(solo para ejecutar el script legacy manualmente)*
### Opción A — Despliegue completo con Docker Compose *(Recomendado)*
 
```bash
# Desde la carpeta backend/
cd backend
 
# Copiar el archivo de entorno (los valores por defecto ya funcionan)
cp .env.example .env.development
 
# Levantar todos los servicios: postgres, mongo, redis, api, frontend, php-legacy
docker compose up --build
 
# Para ver logs de un servicio específico:
docker compose logs -f api
docker compose logs -f frontend
```
 
Los servicios quedan disponibles en:
 
| Servicio           | URL                                     |
|--------------------|-----------------------------------------|
| API REST           | `http://localhost:3000/api`             |
| Swagger UI         | `http://localhost:3000/api/docs`        |
| Frontend Dashboard | `http://localhost:5173`                 |
| Health Check       | `http://localhost:3000/health`          |
| PostgreSQL         | `localhost:5432` (user: admin / secret) |
| MongoDB            | `localhost:27017`                       |
| Redis              | `localhost:6379`                        |
 
### Opción B — Backend en modo desarrollo *(hot-reload)*
 
```bash
# Levantar solo las bases de datos con Docker
cd backend
docker compose up postgres mongo redis -d
 
# Instalar dependencias e iniciar la API con hot-reload
npm install
npm run start:dev
```
 
> Asegurarse de que `.env.development` tenga `POSTGRES_HOST=localhost`, `MONGO_URI=mongodb://localhost:27017/events_db` y `REDIS_HOST=localhost` (ya es el valor por defecto del `.env.example`).
 
### Opción C — Frontend en modo desarrollo
 
```bash
cd frontend
npm install
npm run dev
# Frontend disponible en http://localhost:5173
```
 
> Asegurarse de que el backend esté corriendo en el puerto 3000.
 
### Ejecutar el Script PHP Legacy
 
```bash
# Con Docker Compose (recomendado — usa la red interna Docker):
docker compose run --rm php-legacy
 
# Con PHP local (apuntando a localhost):
cd backend/legacy
API_BASE_URL=http://localhost:3000 LEGACY_API_KEY=legacy-php-dev-key-2026 php legacy-client.php
 
# Con paginación personalizada (página 2, 10 registros):
php legacy-client.php 2 10
```
 
### Obtener Token JWT para Pruebas en Swagger
 
```bash
curl -X POST http://localhost:3000/api/auth/token
# Respuesta: { "accessToken": "eyJhbGci..." }
```
 
Usar el token en Swagger UI: botón **Authorize** → campo `JWT` → pegar el `accessToken`.
 
### Ejecutar Pruebas
 
```bash
cd backend
 
# Suite completa Jest
npm run test
 
# Modo watch
npm run test:watch
 
# Cobertura completa
npm run test:cov
 
# Pruebas end-to-end
npm run test:e2e
```
 
```bash
cd frontend
npm run test   # Vitest + Testing Library
```
 
### Variables de Entorno de Referencia
 
| Variable            | Descripción                                             | Valor por defecto (dev)               |
|---------------------|---------------------------------------------------------|---------------------------------------|
| `NODE_ENV`          | Entorno de ejecución                                    | `development`                         |
| `PORT`              | Puerto de la API                                        | `3000`                                |
| `POSTGRES_HOST`     | Host de PostgreSQL (`localhost` o `postgres` en Docker) | `localhost`                           |
| `POSTGRES_PORT`     | Puerto PostgreSQL                                       | `5432`                                |
| `POSTGRES_DB`       | Nombre de la base de datos                              | `incidents_db`                        |
| `POSTGRES_USER`     | Usuario PostgreSQL                                      | `admin`                               |
| `POSTGRES_PASSWORD` | Contraseña PostgreSQL                                   | `secret`                              |
| `MONGO_URI`         | URI de conexión MongoDB                                 | `mongodb://localhost:27017/events_db` |
| `REDIS_HOST`        | Host de Redis                                           | `localhost`                           |
| `REDIS_PORT`        | Puerto Redis                                            | `6379`                                |
| `REDIS_CACHE_DB`    | Base de datos Redis para caché (Cache Aside)            | `0`                                   |
| `REDIS_QUEUE_DB`    | Base de datos Redis para BullMQ                         | `1`                                   |
| `JWT_SECRET`        | Secreto de firma JWT                                    | `incidentes-coordinadora-jwt-dev-2026`|
| `LEGACY_API_KEY`    | API Key para el script PHP Legacy                       | `legacy-php-dev-key-2026`             |
| `VITE_API_URL`      | URL del backend (leída por el Frontend Vite)            | `http://localhost:3000`               |
| `VITE_WS_URL`       | URL WebSocket (leída por el Frontend Vite)              | `ws://localhost:3000`                 |
 
---
 
### 10.5 Plan de Verificación Funcional (Paso a Paso)
 
> Ejecuta este flujo **una sola vez**, con el stack de Docker completamente levantado (`docker compose up --build`), para validar de extremo a extremo la integración de todos los componentes: ingesta asíncrona, consistencia ACID, WebSockets en tiempo real e interoperabilidad con el sistema legacy.
 
#### Paso 1 — Ingesta de Evento Crítico y Activación de la Cola Asíncrona
 
Envía un evento con severidad `CRITICAL`. Esto dispara simultáneamente el Rate Limiting, la generación del Trace ID y el encolado en BullMQ sin bloquear la respuesta HTTP.
 
```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "application": "payment-service",
    "eventType":   "GATEWAY_TIMEOUT",
    "description": "Fallo masivo en checkout",
    "severity":    "CRITICAL",
    "occurredAt":  "2026-06-21T12:00:00Z",
    "metadata":    {}
  }'
```
 
**Resultado esperado — API (`201 Created`):**
 
```json
{ "traceId": "b3a2f1e0-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
```
 
**Resultado esperado — logs del contenedor** (`docker compose logs -f api`):
 
```
EVENT_REGISTERED  →  ALERT_QUEUED  →  ALERT_PROCESSING_STARTED  →  ALERT_PROCESSING_COMPLETED
```
 
**Resultado esperado — Dashboard React** (`http://localhost:5173`):
 
El widget de alertas añade la nueva fila en tiempo real y los gráficos de métricas se actualizan al recibir el evento WebSocket `metrics.updated`, sin necesidad de recargar la página.
 
> **Guarda el `traceId` de la respuesta** — lo necesitarás en el Paso 2.
 
---
 
#### Paso 2 — Creación de Incidente y Verificación de Consistencia ACID
 
Obtén primero un token JWT temporal:
 
```bash
curl -X POST http://localhost:3000/api/auth/token
# → { "accessToken": "eyJhbGci..." }
```
 
Luego abre un incidente formal vinculado al `traceId` del Paso 1:
 
```bash
curl -X POST http://localhost:3000/api/incidents \
  -H "Authorization: Bearer <TU_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title":               "Degradación en Pasarela de Pagos",
    "description":         "Clientes atrapados en el checkout",
    "affectedApplication": "payment-service",
    "severity":            "CRITICAL",
    "assignee":            "ops-team@empresa.com",
    "relatedEventTraceIds": ["<TRACE_ID_DEL_PASO_1>"]
  }'
```
 
**Resultado esperado en PostgreSQL:**
 
Dentro de la misma transacción atómica (QueryRunner), se crean de forma simultánea:
 
| Tabla            | Registro creado                                |
|------------------|------------------------------------------------|
| `incidents`      | Incidente con `status = OPEN`                  |
| `incident_audit` | Entrada inmutable con transición `OPEN → OPEN` |
 
Si el guardado de la auditoría falla, el incidente se revierte automáticamente; nunca quedan registros huérfanos.
 
**Resultado esperado — Dashboard React:**
 
El contador de incidentes abiertos incrementa en `+1` de forma reactiva vía WebSocket `metrics.updated`, sin recargar la página.
 
---
 
#### Paso 3 — Transición de Estado y Máquina de Estados del Dominio
 
```bash
# OPEN → IN_PROGRESS
curl -X PATCH http://localhost:3000/api/incidents/<ID>/status \
  -H "Authorization: Bearer <TU_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "status": "IN_PROGRESS" }'
 
# IN_PROGRESS → RESOLVED
curl -X PATCH http://localhost:3000/api/incidents/<ID>/status \
  -H "Authorization: Bearer <TU_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "status": "RESOLVED" }'
```
 
Para verificar que la máquina de estados rechaza transiciones inválidas:
 
```bash
# Intentar RESOLVED → OPEN (debe fallar)
curl -X PATCH http://localhost:3000/api/incidents/<ID>/status \
  -H "Authorization: Bearer <TU_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "status": "OPEN" }'
```
 
**Transiciones válidas:** `200 OK` con el incidente actualizado y una nueva entrada en `incident_audit` registrando el cambio de estado con su actor y `traceId`.
 
**Transición inválida:** `409 Conflict` con mensaje descriptivo — ningún registro se escribe en base de datos.
 
---
 
#### Paso 4 — Consumo del Sistema Legacy PHP e Interoperabilidad
 
```bash
docker compose run --rm php-legacy
```
 
**Resultado esperado en consola:**
 
```json
{
  "pagina_actual":   1,
  "total_paginas":   1,
  "total_registros": 1,
  "incidentes": [
    {
      "id":         "uuid-del-incidente",
      "aplicacion": "payment-service",
      "severidad":  "CRITICAL",
      "estado":     "OPEN",
      "creado_en":  "2026-06-21T12:00:00.000Z"
    }
  ],
  "resumen": "Se encontraron 1 incidente(s) abierto(s) en esta página."
}
```
 
El script adjunta automáticamente el header `x-api-key` a cada petición. Si la clave es incorrecta o está ausente, la API responde `401 Unauthorized` y el script termina con `exit(1)` detectable por el proceso padre.
 
---
 
#### Resumen del Flujo de Verificación
 
```
[Paso 1] POST /api/events  (CRITICAL)
              │
              ├─► 201 + traceId  ──────────────────────────────► Dashboard: alerta en tiempo real
              └─► BullMQ Worker  ──► Alert en MongoDB  ─────────► WS: metrics.updated
 
[Paso 2] POST /api/incidents  (JWT Bearer)
              │
              └─► PostgreSQL: incidents + incident_audit (QueryRunner atómico)
                                                         ────────► WS: metrics.updated
 
[Paso 3] PATCH /api/incidents/:id/status  (JWT Bearer)
              │
              ├─► 200 OK  (transición válida)   ───────────────► WS: incident.updated
              └─► 409 Conflict  (transición inválida, sin escritura en BD)
 
[Paso 4] docker compose run --rm php-legacy
              │
              └─► GET /api/incidents?status=OPEN  (x-api-key)  ► JSON simplificado en consola
```
 
---
 
## 11. Cobertura de Pruebas Unitarias y de Integración
 
La suite del backend usa **Jest** y vive junto al código que prueba (`__tests__/` o sufijo `.spec.ts`), siguiendo la misma estructura por capas de DDD. En total, **29 pruebas automatizadas** validan el dominio y los casos de uso críticos del negocio.
 
### 11.1 Backend — Pruebas Unitarias
 
**`incident-status.vo.spec.ts`** — *Value Object `IncidentStatus`* (6 pruebas)
 
| # | Prueba | Qué valida |
|---|--------|------------|
| 1 | Debe inicializar un estado de incidente válido | Construcción exitosa con un valor permitido (`OPEN`, `IN_PROGRESS`, `RESOLVED`) |
| 2 | Debe lanzar una excepción al intentar inicializar con un estado inválido | El constructor rechaza valores fuera del enum de negocio |
| 3 | Debe permitir la transición reglamentaria de OPEN a IN_PROGRESS | `canTransitionTo()` devuelve `true` para la transición inicial válida |
| 4 | Debe prohibir la transición directa no permitida de OPEN a RESOLVED | `canTransitionTo()` devuelve `false`; no se puede saltar `IN_PROGRESS` |
| 5 | Debe permitir pasar de IN_PROGRESS a RESOLVED o volver a abrirlo en OPEN | Verifica ambas ramas válidas desde `IN_PROGRESS` (avance y reapertura) |
| 6 | Debe congelar el estado RESOLVED e impedir cualquier transición posterior | Un incidente `RESOLVED` no admite ninguna transición saliente |
 
**`src/app.controller.spec.ts`** — *Smoke test* (1 prueba)
 
| # | Prueba | Qué valida |
|---|--------|------------|
| 1 | should return "Hello World!" | El controlador raíz responde correctamente (health del bootstrap de Nest) |
 
### 11.2 Backend — Pruebas de Integración
 
**`create-incident.use-case.integration.spec.ts`** — *`CreateIncidentUseCase`* (10 pruebas)
 
| #  | Prueba | Qué valida |
|----|--------|------------|
| 1  | Debe persistir el incidente con estado OPEN y devolver la entidad guardada | Flujo feliz de creación end-to-end del caso de uso |
| 2  | Debe construir la entidad Incident con estado inicial OPEN sin importar el DTO | El estado inicial siempre es `OPEN`, sin importar lo enviado en el payload |
| 3  | Debe asignar UNASSIGNED como responsable cuando no se especifica assignee | Valor por defecto del campo `assignee` |
| 4  | Debe crear el registro de auditoría con oldStatus=OPEN y newStatus=OPEN al crear | La auditoría inicial documenta la creación como transición OPEN→OPEN |
| 5  | Debe incluir los relatedEventTraceIds del DTO en la entidad | Propagación correcta del array `TEXT[]` de trace IDs relacionados |
| 6  | Debe inicializar relatedEventTraceIds como array vacío cuando no se provee | Valor por defecto seguro (`[]`) cuando el campo es opcional |
| 7  | Debe invocar invalidateAndBroadcast después de persistir el incidente | Se dispara la invalidación de caché y el broadcast WebSocket tras guardar |
| 8  | Debe invocar invalidateAndBroadcast incluso cuando la persistencia devuelve incidente con campos mínimos | El efecto secundario ocurre independientemente de la forma del resultado persistido |
| 9  | Debe propagar el error si saveWithAudit falla y no invocar el broadcast | Si la persistencia falla, el error se relanza y el broadcast nunca se llama |
| 10 | Debe lanzar el error si invalidateAndBroadcast falla después de persistir | Un fallo posterior a la persistencia exitosa también se propaga al llamador |
 
**`update-incident-status.use-case.integration.spec.ts`** — *`UpdateIncidentStatusUseCase`* (11 pruebas)
 
| #  | Prueba | Qué valida |
|----|--------|------------|
| 1  | Debe transicionar correctamente de OPEN a IN_PROGRESS y registrar auditoría | Transición válida persistida junto con su entrada de auditoría |
| 2  | Debe transicionar correctamente de IN_PROGRESS a RESOLVED | Segunda transición válida de la máquina de estados |
| 3  | Debe permitir reabrir un incidente de IN_PROGRESS a OPEN (reapertura) | Caso especial de reapertura contemplado por el negocio |
| 4  | Debe lanzar ConflictException al intentar ir de OPEN directamente a RESOLVED | Rechazo de transición ilegal que salta un estado intermedio |
| 5  | Debe contener el mensaje descriptivo de transición en el ConflictException | El error 409 expone un mensaje claro sobre la transición rechazada |
| 6  | Debe lanzar ConflictException al intentar mover un incidente RESOLVED a IN_PROGRESS | Un incidente resuelto no puede reabrirse hacia un estado intermedio |
| 7  | Debe lanzar ConflictException al intentar reabrir un incidente RESOLVED | Confirma que `RESOLVED` está completamente congelado |
| 8  | No debe persistir ni emitir cuando la transición es inválida | Efectos secundarios (guardado, broadcast) no ocurren si la transición fue rechazada |
| 9  | Debe lanzar NotFoundException si el id no existe en el repositorio | Manejo de incidente inexistente con HTTP 404 |
| 10 | Debe incluir el id en el mensaje del NotFoundException | El error 404 es trazable: incluye el identificador buscado |
| 11 | Debe invocar invalidateAndBroadcast después de persistir el incidente | Tras una actualización válida se invalida caché y se notifica por WebSocket |
 
**`register-event.use-case.integration.spec.ts`** — *`RegisterEventUseCase`* (1 prueba)
 
| # | Prueba | Qué valida |
|---|--------|------------|
| 1 | Debe registrar el evento en MongoDB y agregar a cola BullMQ si es CRITICAL | Persistencia del evento y encolado condicional en `alert-processing` cuando `severity === 'CRITICAL'` |
 
### 11.3 Resumen de Cobertura
 
| Capa / módulo                   | Tipo        | # Pruebas |
|---------------------------------|-------------|:---------:|
| `IncidentStatus` (Value Object) | Unitaria    | 6         |
| `AppController` (bootstrap)     | Unitaria    | 1         |
| `CreateIncidentUseCase`         | Integración | 10        |
| `UpdateIncidentStatusUseCase`   | Integración | 11        |
| `RegisterEventUseCase`          | Integración | 1         |
| **Total backend**               |             | **29**    |
 
Comandos de referencia: `npm run test` · `npm run test:cov` · `npm run test:e2e`
 
> **Frontend:** el repositorio `frontend/` tiene su propia suite con **Vitest + Testing Library** (`npm run test`). Cubre pruebas unitarias del reducer (`dashboardReducer`), pruebas de integración de los componentes de presentación (`SummaryWidgets`, `IncidentTable`) y pruebas de integración de los formularios (`EventForm`, `IncidentForm`). Introducida en las ramas `feature/automated-tests` y `feature/automated-tests-and-docker` (ver [§12.3](#123-frontend--frontend-incident-platform)).
 
---
 
## 12. Flujo de Trabajo Git y Estrategia de Ramas
 
> La información de esta sección se obtuvo ejecutando directamente los siguientes comandos en **Git Bash**, sobre cada repositorio:
>
> ```bash
> git log --oneline --graph --all
> git reflog --all
> ```
 
### 12.1 Estrategia de ramas (Git Flow simplificado)
 
Ambos repositorios siguen el mismo modelo de ramas:
 
- **`main`** — rama de release. Solo recibe merges desde `develop` (merge commits `release: ...`). Es la única rama desplegable.
- **`develop`** — rama de integración continua. Todas las ramas `feature/*` se integran aquí antes de promoverse a `main`.
- **`feature/*`** — una rama por funcionalidad o responsabilidad técnica, creada desde `develop` y eliminada lógicamente tras su merge.
Cada ciclo de trabajo sigue el mismo patrón:
 
```
feature/x  →  commit(s) en feature/x  →  checkout a develop
           →  merge feature/x → develop  →  (eventualmente) merge develop → main
```
 
### 12.2 Backend — `backend-incident-platform`
 
```
main     ●── chore: initial project configuration and nestjs setup
          │
develop   ◄── branch: Created from HEAD (main)
          │
          ├─ feature/automated-tests  ──► merge → develop
          ├─ feature/docker-setup     ──► merge → develop
          │
          ├─ feature/domain-testing
          │     └─ test(domain): implement unit test suite for IncidentStatus value object
          │   ──► merge → develop
          │
          ├─ feature/integration-testing
          │     └─ test(integration): add use case integration specs for incidents and event ingestion
          │   ──► merge → develop
          │
          ├─ feature/app-config-legacy
          │     └─ feat(config): integrate global providers and refactor legacy php client
          │   ──► merge → develop
          │
develop ──┴──► merge → main   (release: production-ready operational platform v1.0.0)
          │
          ├─ feature/docs   (iterado y re-mergeado varias veces durante el cierre)
          │     └─ docs: write comprehensive architecture specifications and evaluation guide in README
          │   ──► merge → develop ──► merge → main
          │
main      ●── 857cf07 (HEAD -> main, origin/main)
develop   ●── dccdddc (origin/develop, develop)
```
 
**Lectura del flujo:**
 
1. El proyecto arranca en `main` con la configuración base de NestJS; `develop` se crea a partir de ese punto.
2. La automatización de pruebas (`feature/automated-tests`) y el setup de Docker (`feature/docker-setup`) se integran primero a `develop`.
3. Le siguen las ramas de pruebas por capa: `feature/domain-testing` ([§11.1](#111-backend--pruebas-unitarias)) y `feature/integration-testing` ([§11.2](#112-backend--pruebas-de-integración)).
4. `feature/app-config-legacy` consolida los providers globales y el cliente PHP legacy (HU5).
5. `develop` se promueve a `main` con un merge commit de release.
6. `feature/docs` documenta la arquitectura y se re-integra varias veces antes del cierre.
7. Estado final: `main` y `origin/main` apuntan al mismo commit (`857cf07`).
### 12.3 Frontend — `frontend-incident-platform`
 
```
main     ●── chore: initial react + vite + tailwindcss configuration
          │
develop   ◄── branch: Created from HEAD (main)
          │
          ├─ feature/context-api
          │     └─ feat: establish domain types and global Context API state reducer
          │   ──► merge → develop
          │
          ├─ feature/live-hooks
          │     └─ feat: implement api client with auto token resolver and real-time socket hook
          │   ──► merge → develop
          │
          ├─ feature/presentation-components
          │     └─ feat: build modular presentation layer and monochrome telemetry console
          │   ──► merge → develop
          │
          ├─ feature/automated-tests
          │     └─ test: add unit tests for state reducer and integration tests for form submission
          │   ──► merge → develop
          │
          ├─ feature/automated-tests-and-docker
          │     └─ test: config vitest script in package.json and add container files
          │   ──► merge → develop
          │
develop ──┴──► merge → main   (release: production ready react dashboard v1.0.0)
          │
main      ●── 708a419 (HEAD -> main, origin/main)
develop   ●── 2a1a8da (origin/develop, develop)
```
 
**Lectura del flujo:**
 
1. El proyecto arranca con la configuración base de React + Vite + Tailwind CSS en `main`.
2. `feature/context-api` define los tipos de dominio y el reducer global (`DashboardContext`).
3. `feature/live-hooks` construye el cliente HTTP con resolución automática de token y el hook de Socket.IO (`useLiveMetrics`).
4. `feature/presentation-components` arma la capa de presentación modular.
5. `feature/automated-tests` añade las pruebas unitarias del reducer y las pruebas de integración de los formularios.
6. `feature/automated-tests-and-docker` configura el script de Vitest en `package.json` y añade los archivos de contenedor.
7. `develop` se promueve a `main` con un merge commit de release.
8. Estado final: `main` y `origin/main` coinciden en `708a419`.
### 12.4 Convención de mensajes de commit
 
Ambos repositorios siguen consistentemente el estilo **Conventional Commits**:
 
| Prefijo    | Uso observado                                                 |
|------------|---------------------------------------------------------------|
| `chore:`   | Configuración inicial del proyecto (Nest CLI, Vite, Tailwind) |
| `feat:`    | Nueva funcionalidad (providers, hooks, componentes, dominio)  |
| `test:`    | Adición de pruebas unitarias/integración                      |
| `docs:`    | Documentación de arquitectura (README)                        |
| `merge:`   | Integración de una rama `feature/*` hacia `develop`           |
| `release:` | Promoción de `develop` a `main`, marca de versión desplegable |
 
---
 
## 13. Mapeo a Criterios de Evaluación
 
| Criterio                                            | Dónde se evidencia                                                                      |
|-----------------------------------------------------|-----------------------------------------------------------------------------------------|
| Aplicación correcta de Domain Driven Design         | [§2](#2-arquitectura-de-software--ddd-puro) — capas, VO `IncidentStatus`                |
| Uso adecuado de NestJS/TypeScript                   | [§2](#2-arquitectura-de-software--ddd-puro), [§3](#3-decisiones-de-ingeniería), [§6](#6-seguridad-resiliencia-y-transversales) |
| Correcta separación de contextos y capas            | [§2](#2-arquitectura-de-software--ddd-puro), [§9](#9-estructura-del-proyecto)           |
| Diseño de APIs REST                                 | [§7](#7-contratos-de-la-api--paginación)                                                |
| Uso adecuado de PostgreSQL y NoSQL según el dominio | [§1](#1-vista-general-y-justificación-tecnológica) — justificación PostgreSQL vs MongoDB |
| Correcta implementación de Redis                    | [§1](#1-vista-general-y-justificación-tecnológica), [§5](#5-estrategia-de-caché-e-invalidación-activa-hu4) |
| Diseño de procesamiento asíncrono desacoplado       | [§4](#4-procesamiento-asíncrono-de-alertas-hu3)                                         |
| Capacidad de escalar la solución                    | [§1](#1-vista-general-y-justificación-tecnológica), [§6](#6-seguridad-resiliencia-y-transversales) |
| Calidad del frontend y experiencia de usuario       | [§9](#9-estructura-del-proyecto), [§5](#5-estrategia-de-caché-e-invalidación-activa-hu4) |
| Integración del componente PHP legacy               | [§8](#8-integración-con-el-sistema-legacy-hu5)                                          |
| Cobertura de pruebas unitarias y de integración     | [§11](#11-cobertura-de-pruebas-unitarias-y-de-integración)                              |
| Uso adecuado de Git y flujo de ramas                | [§12](#12-flujo-de-trabajo-git-y-estrategia-de-ramas)                                   |
 
---