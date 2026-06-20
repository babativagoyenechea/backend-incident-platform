# Plataforma de Gestión de Incidentes y Monitoreo Operacional

**Backend — NestJS + TypeScript | PostgreSQL + MongoDB + Redis + BullMQ**

> Reto Técnico — Coordinadora
> Versión: v1.0

---

# Entregables

## Backend

Repositorio Git:

```text
https://github.com/<usuario>/backend-incident-platform
```

Incluye:

* NestJS + TypeScript
* PostgreSQL
* MongoDB
* Redis
* BullMQ
* Swagger/OpenAPI
* Pruebas unitarias e integración
* Integración PHP Legacy

## Frontend

Repositorio Git:

```text
https://github.com/<usuario>/frontend-incident-platform
```

Incluye:

* React
* Dashboard Operacional
* WebSockets
* Filtros
* Componentes reutilizables

## Artefactos Incluidos

```text
README.md
.env.example
database/init.sql
Swagger/OpenAPI
docker-compose.yml
```

---

# 📋 Tabla de Contenidos

1. Arquitectura del Sistema
2. Domain Driven Design (DDD)
3. Stack Tecnológico
4. Persistencia y Flujo de Datos
5. Configuración del Entorno
6. Instalación y Ejecución
7. Documentación API
8. Validación Funcional
9. Integración Legacy PHP
10. Pruebas Automatizadas
11. Escalabilidad y Producción
12. Trade-offs y Mejoras Futuras

---

# 1. Arquitectura del Sistema

## Vista General

```text
┌─────────────────────────────────────────────────────┐
│                    Plataforma                       │
│                                                     │
│ React Dashboard                                     │
│       │                                             │
│       ▼                                             │
│ NestJS API                                          │
│       │                                             │
│ ┌─────┼──────────────┬─────────────┬─────────────┐  │
│ ▼     ▼              ▼             ▼             │  │
│Postgres MongoDB     Redis        BullMQ          │  │
│                                                     │
│ Swagger • JWT • WebSockets • API Key              │
└─────────────────────────────────────────────────────┘
```

## Componentes Principales

| Componente | Responsabilidad                    |
| ---------- | ---------------------------------- |
| API        | Exposición de endpoints REST       |
| PostgreSQL | Incidentes y auditoría             |
| MongoDB    | Eventos y alertas                  |
| Redis      | Caché y colas                      |
| BullMQ     | Procesamiento asíncrono            |
| WebSockets | Actualización en tiempo real       |
| PHP Legacy | Integración con sistemas heredados |

---

# 2. Domain Driven Design (DDD)

La solución está organizada por dominios funcionales siguiendo principios DDD y SOLID.

## Estructura

```text
src/
└── modules/
    ├── events/
    ├── incidents/
    ├── alerts/
    ├── dashboard/
    ├── websockets/
    └── shared/
```

Cada módulo implementa:

```text
domain/
application/
infrastructure/
presentation/
```

## Responsabilidades

| Capa           | Función                       |
| -------------- | ----------------------------- |
| Domain         | Entidades y reglas de negocio |
| Application    | Casos de uso                  |
| Infrastructure | Persistencia e integraciones  |
| Presentation   | Controllers y DTOs            |

Beneficios:

* Alta cohesión.
* Bajo acoplamiento.
* Escalabilidad.
* Facilidad de pruebas.
* Mantenibilidad.

---

# 3. Stack Tecnológico

| Componente      | Tecnología |
| --------------- | ---------- |
| Backend         | NestJS     |
| Lenguaje        | TypeScript |
| Base Relacional | PostgreSQL |
| Base NoSQL      | MongoDB    |
| Caché           | Redis      |
| Colas           | BullMQ     |
| Documentación   | Swagger    |
| Tiempo Real     | Socket.IO  |
| Testing         | Jest       |
| Legacy          | PHP        |

## Justificación

### PostgreSQL

Responsable de:

* Incidentes.
* Auditoría.
* Consistencia transaccional.

### MongoDB

Responsable de:

* Eventos.
* Alertas.
* Datos de estructura flexible.

### Redis

Responsable de:

* Cache Aside Pattern.
* Gestión de colas BullMQ.

---

# 4. Persistencia y Flujo de Datos

## Modelo de Persistencia

| Dato            | Tecnología |
| --------------- | ---------- |
| Incidentes      | PostgreSQL |
| Auditoría       | PostgreSQL |
| Eventos         | MongoDB    |
| Alertas         | MongoDB    |
| Dashboard Cache | Redis      |
| Jobs            | BullMQ     |

## Flujo de Eventos Críticos

```text
Evento CRITICAL
       │
       ▼
MongoDB
       │
       ▼
BullMQ
       │
       ▼
Worker
       │
       ▼
Alerta
       │
       ▼
Redis Cache Invalidation
       │
       ▼
WebSocket Broadcast
```

## Cache Aside

```text
GET Dashboard
      │
      ▼
Redis
 │       │
HIT    MISS
 │       │
 ▼       ▼
Retorna Recalcula
          │
          ▼
      Guarda Cache
```

TTL configurado:

```text
30 segundos
```

---

# 5. Configuración del Entorno

## Crear archivo local

```bash
cp .env.example .env.development
```

## Variables Principales

### PostgreSQL

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=incidents_db
POSTGRES_USER=admin
POSTGRES_PASSWORD=secret
```

### MongoDB

```env
MONGO_URI=mongodb://localhost:27017/events_db
```

### Redis

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_CACHE_DB=0
REDIS_QUEUE_DB=1
```

### Seguridad

```env
JWT_SECRET=your-secret-key
LEGACY_API_KEY=legacy-php-key
```

### Frontend

```env
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

---

# 6. Instalación y Ejecución

## Opción A — Docker Completo

```bash
docker compose up --build
```

## Opción B — Desarrollo Local

### Bases de datos

```bash
docker compose up postgres mongo redis -d
```

### Dependencias

```bash
npm install
```

### Backend

```bash
npm run start:dev
```

## Health Check

```bash
curl http://localhost:3000/health
```

Respuesta esperada:

```json
{
  "status": "ok"
}
```

## URLs Disponibles

| Servicio | URL                            |
| -------- | ------------------------------ |
| API      | http://localhost:3000/api      |
| Swagger  | http://localhost:3000/api/docs |
| Health   | http://localhost:3000/health   |
| Frontend | http://localhost:5173          |

---

# 7. Documentación API

Swagger disponible en:

```text
http://localhost:3000/api/docs
```

Incluye:

* Endpoints.
* DTOs.
* Schemas.
* Ejemplos.
* Respuestas HTTP.
* Seguridad JWT.

---

# 8. Validación Funcional

## HU1 — Registro de Eventos

Endpoint:

```http
POST /api/events
```

Resultado esperado:

* Persistencia en MongoDB.
* Generación de traceId.
* Eventos críticos generan alertas.

---

## HU2 — Gestión de Incidentes

Endpoints:

```http
POST /api/incidents
PATCH /api/incidents/:id/status
```

Estados válidos:

```text
OPEN
 ↓
IN_PROGRESS
 ↓
RESOLVED
```

Transiciones inválidas:

```http
409 Conflict
```

---

## HU3 — Procesamiento Asíncrono

Flujo:

```text
Evento CRITICAL
      │
      ▼
BullMQ
      │
      ▼
Worker
      │
      ▼
Alerta
```

---

## HU4 — Dashboard Operacional

Endpoint:

```http
GET /api/dashboard/metrics
```

Características:

* Cache Aside.
* Redis.
* WebSockets.
* Métricas agregadas.

---

## HU5 — Integración Legacy

Endpoint:

```http
GET /api/incidents
```

Autenticación:

```http
x-api-key
```

---

# 9. Integración Legacy PHP

Se implementó un cliente PHP desacoplado para consultar incidentes abiertos.

## Flujo

```text
PHP Client
     │
     ▼
GET /api/incidents
     │
     ▼
NestJS API
     │
     ▼
PostgreSQL
```

## Autenticación

```http
x-api-key: <LEGACY_API_KEY>
```

El sistema legacy consume exactamente la misma API pública utilizada por el frontend.

---

# 10. Pruebas Automatizadas

## Ejecutar pruebas

```bash
npm test
```

## Cobertura

```bash
npm run test:cov
```

## Suites Implementadas

### Dominio

```text
incident-status.vo.spec.ts
```

Valida reglas de transición de estados.

### Aplicación

```text
create-incident.use-case.integration.spec.ts
update-incident-status.use-case.integration.spec.ts
register-event.use-case.integration.spec.ts
```

Valida casos de uso y reglas de negocio.

---

# 11. Escalabilidad y Producción

## Estrategia de Escalamiento

| Componente | Estrategia              |
| ---------- | ----------------------- |
| API        | Escalamiento horizontal |
| WebSockets | Redis Adapter           |
| BullMQ     | Workers dedicados       |
| PostgreSQL | Read Replicas           |
| MongoDB    | Sharding                |
| Redis      | Sentinel / Cluster      |

## Arquitectura Objetivo

```text
Load Balancer
      │
 ┌────┼────┐
 │    │    │
API API API
 │    │    │
 └────┼────┘
      │
 PostgreSQL
 MongoDB
 Redis
```

---

# 12. Trade-offs y Mejoras Futuras

## Trade-offs

### Caché Redis

* TTL de 30 segundos.
* Invalidación activa.

### Docker

* Optimizado para desarrollo.
* Multi-stage build recomendado para producción.

### Dependencias Circulares

* Uso controlado de forwardRef().
* Evolución futura hacia eventos de dominio.

## Mejoras Futuras

### Infraestructura

* Migraciones TypeORM.
* Workers independientes.
* Docker multi-stage.

### Seguridad

* Usuarios persistentes.
* Refresh Tokens.
* OAuth2.

### Observabilidad

* Prometheus.
* Grafana.
* Alertas operacionales.

### Testing

* Pruebas E2E con Supertest.
* Testcontainers.
* Pipeline CI/CD.

### Datos

* TTL automático para eventos históricos.
* Archivado de auditorías antiguas.

---

# Conclusión

La solución fue diseñada aplicando:

* Domain Driven Design (DDD).
* Principios SOLID.
* Arquitectura modular.
* Procesamiento asíncrono desacoplado.
* Persistencia híbrida (SQL + NoSQL).
* Estrategias de caché.
* Escalabilidad horizontal.

Cumpliendo los requerimientos funcionales y técnicos definidos para la prueba.
