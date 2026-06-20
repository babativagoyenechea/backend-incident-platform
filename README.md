# 🚨 Plataforma de Gestión de Incidentes y Monitoreo Operacional

**Backend — NestJS + TypeScript | PostgreSQL + MongoDB + Redis + BullMQ**

> Reto Técnico — Coordinadora  
> Versión de guía técnica: v5.0 (Definitiva)

---

## 📋 Tabla de Contenidos

1. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
2. [Justificación del Stack Tecnológico](#3-justificación-del-stack-tecnológico)
3. [Persistencia y Flujo de Datos](#4-persistencia-y-flujo-de-datos)
4. [Requisitos Previos](#5-requisitos-previos)
5. [Variables de Entorno](#6-variables-de-entorno)
6. [Guía de Instalación Detallada (Getting Started)](#7-guía-de-instalación-detallada-getting-started)
7. [Verificación por Base de Datos con Comandos Docker](#8-verificación-por-base-de-datos-con-comandos-docker)
8. [Pruebas por Historia de Usuario (HU) — Paso a Paso](#9-pruebas-por-historia-de-usuario-hu---paso-a-paso)
9. [Pruebas Unitarias y de Integración](#10-pruebas-unitarias-y-de-integración)
10. [Estrategia de Escalamiento en Producción](#11-estrategia-de-escalamiento-en-producción)
11. [Trade-offs y Decisiones Pendientes (Honestidad Técnica)](#12-trade-offs-y-decisiones-pendientes)

---

## 1. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PLATAFORMA                                   │
│                                                                     │
│  ┌──────────┐    ┌─────────────────┐    ┌──────────────────────┐   │
│  │  React   │◄──►│   NestJS API    │◄──►│   PostgreSQL DB       │   │
│  │Dashboard │    │   (port 3000)   │    │   incidents           │   │
│  │(port 5173│    │                 │    │   incident_audit      │   │
│  └──────────┘    └────────┬────────┘    └──────────────────────┘   │
│       ▲                   │                                         │
│       │ WebSocket         │             ┌──────────────────────┐   │
│       │ (socket.io)       │             │    MongoDB            │   │
│  ┌────┴─────┐             │             │    events             │   │
│  │PHP Legacy│─────────────┤             │    alerts             │   │
│  │(x-api-key│             │             └──────────────────────┘   │
│  └──────────┘             │                                         │
│                           │             ┌──────────────────────┐   │
│  Sistemas externos        │             │  Redis DB0 — Cache    │   │
│  POST /api/events ───────►│             │  Redis DB1 — BullMQ   │   │
│  (Rate Limited 100/min)   └────────────►└──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Estructura de carpetas DDD (4 capas por módulo)

```
src/
├── main.ts                          # Bootstrap + Swagger + Seguridad global
├── app.module.ts                    # Módulo raíz: TypeORM, Mongoose, BullMQ, Throttler
│
└── modules/
    ├── events/                      # HU1: Registro de Eventos
    │   ├── domain/                  # Entidades puras + interfaces de repositorio
    │   │   ├── entities/event.entity.ts
    │   │   └── repositories/i-event.repository.ts
    │   ├── application/             # Casos de uso + DTOs
    │   │   ├── use-cases/register-event.use-case.ts
    │   │   └── dtos/register-event.dto.ts
    │   ├── infrastructure/          # Adaptadores de persistencia
    │   │   └── persistence/mongo-event.repository.ts
    │   └── presentation/            # Controladores HTTP
    │       └── controllers/event.controller.ts
    │
    ├── incidents/                   # HU2: Gestión de Incidentes
    │   ├── domain/
    │   │   ├── entities/{incident.entity.ts, incident-audit.entity.ts}
    │   │   ├── value-objects/incident-status.vo.ts  ← regla de negocio pura
    │   │   └── repositories/i-incident.repository.ts
    │   ├── application/
    │   │   ├── use-cases/{create-incident, update-incident-status}.use-case.ts
    │   │   └── dtos/{create-incident, update-status, incident-filters}.dto.ts
    │   ├── infrastructure/
    │   │   └── persistence/
    │   │       ├── entities/{incident, incident-audit}.orm-entity.ts
    │   │       └── typeorm-incident.repository.ts  ← QueryRunner transaccional
    │   └── presentation/
    │       └── controllers/incident.controller.ts
    │
    ├── alerts/                      # HU3: Procesamiento Asíncrono
    │   ├── domain/entities/alert.entity.ts
    │   ├── application/use-cases/create-alert.use-case.ts
    │   └── infrastructure/
    │       ├── persistence/mongo-alert.repository.ts
    │       └── queue/
    │           ├── bullmq.config.ts  ← nombres de colas + opciones
    │           └── alert.worker.ts   ← @Processor en infrastructure/ (correcto)
    │
    ├── dashboard/                   # HU4: Métricas en Tiempo Real
    │   ├── application/use-cases/get-dashboard-metrics.use-case.ts
    │   └── presentation/controllers/dashboard.controller.ts
    │
    ├── websockets/
    │   └── events.gateway.ts        ← 3 emisores: alert.created, incident.updated, metrics.updated
    │
    ├── health/health.controller.ts  ← Terminus: Postgres + MongoDB + Redis ping
    │
    └── shared/
        ├── application/services/metrics-broadcast.service.ts  ← invalida + recalcula + emite
        ├── auth.module.ts           ← JWT + ApiKey guards
        ├── filters/global-exception.filter.ts
        ├── guards/{jwt-auth, api-key}.guard.ts
        ├── interceptors/trace-id.interceptor.ts
        └── infrastructure/redis/redis.module.ts  ← único cliente REDIS_CACHE
```

---

## 3. Justificación del Stack Tecnológico

### Por qué NestJS y no Express o Fastify

NestJS es el framework Node.js que más naturalmente implementa los principios SOLID y DDD, porque su sistema de módulos, decoradores e inyección de dependencias forza una separación de capas. En Express, esa separación es opcional y queda al criterio del desarrollador. El reto pide DDD explícitamente, y NestJS es la herramienta que hace más visible esa intención en el código.

**Fastify** habría sido una alternativa válida (levemente más rápido en benchmarks de raw HTTP), pero NestJS tiene integración nativa con TypeORM, Mongoose, BullMQ, Swagger y WebSockets a través de paquetes `@nestjs/*`, lo cual reduce el tiempo de configuración y el código de pegamento considerablemente en un proyecto de 4 días.

### Por qué TypeScript

El reto lo exige explícitamente. Más allá de eso: los DTOs con `class-validator`, las interfaces de repositorio del dominio, y los tipos de las entidades forman un contrato estático que el compilador verifica en tiempo de build. Errores como pasar un string donde se espera un UUID o llamar a un método que no existe en la interfaz del repositorio se detectan antes de ejecutar, no en runtime.

### Por qué tres bases de datos diferentes

La decisión de fondo que guía todo el proyecto: **cada tecnología se eligió por la naturaleza del dato que maneja, no por preferencia personal ni por uniformidad del stack**.

```
Dato                   Naturaleza                         Tecnología elegida
─────────────────────  ─────────────────────────────────  ──────────────────
Incidentes + Auditoría Ciclo de vida con estados,         PostgreSQL
                       relaciones FK, atomicidad ACID,
                       consistencia inmediata

Eventos + Alertas      Append-only, alto volumen,         MongoDB
                       forma variable (metadata),
                       sin migraciones ante campos nuevos

Métricas del Dashboard Efímero, TTL 30s, recalculable     Redis DB0 (caché)

Jobs de alerta         Coordinación asíncrona,            Redis DB1 (BullMQ)
                       reintentos, DLQ
```

---

## 4. Persistencia y Flujo de Datos

### 4.1 PostgreSQL — Datos Transaccionales

**Qué guarda:** incidentes y su tabla de auditoría de cambios de estado.

**Por qué aquí y no en Mongo:**
- Los incidentes tienen un ciclo de vida controlado con estados válidos (`OPEN → IN_PROGRESS → RESOLVED`). Los ENUMs de Postgres refuerzan esta restricción incluso a nivel de motor de base de datos, no solo en la aplicación.
- La relación `incidents → incident_audit` es 1:N y requiere integridad referencial (FK). Si un incidente se borra, no debería quedar auditoría huérfana.
- El cambio de estado y su registro de auditoría deben ser atómicos: o se guardan los dos, o no se guarda ninguno. `QueryRunner` con `startTransaction/commit/rollback` implementa esta garantía.

**Esquema:**
```sql
-- ENUMs validan en el motor, no solo en la aplicación
CREATE TYPE incident_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
CREATE TYPE severity_level  AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- TEXT[] nativo (no CSV serializado) — permite operadores @> y && de Postgres
CREATE TABLE incidents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   VARCHAR(255) NOT NULL,
  description             TEXT,
  affected_app            VARCHAR(100) NOT NULL,
  severity                severity_level NOT NULL,
  status                  incident_status NOT NULL DEFAULT 'OPEN',
  assignee                VARCHAR(150),
  related_event_trace_ids TEXT[],
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

-- Auditoría append-only — nunca se actualiza ni se borra
CREATE TABLE incident_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID NOT NULL REFERENCES incidents(id),
  old_status   incident_status NOT NULL,
  new_status   incident_status NOT NULL,
  changed_by   VARCHAR(150),
  trace_id     VARCHAR(36),
  changed_at   TIMESTAMP DEFAULT NOW()
);
```

### 4.2 MongoDB — Datos de Alto Volumen y Forma Variable

**Qué guarda:** eventos operacionales (HU1) y alertas generadas (HU3).

**Por qué aquí y no en Postgres:**
- Los eventos son append-only (se crean, no se actualizan ni se borran en este alcance). MongoDB es excelente para cargas de escritura masiva sin bloqueos de fila.
- El campo `metadata` necesita aceptar estructuras distintas según la aplicación origen. En Postgres, agregar un campo nuevo al metadata de eventos requeriría una migración; en Mongo, es un campo `Object` que acepta lo que llegue.
- Los índices compuestos sobre `{application, severity, occurredAt}` permiten las agregaciones del dashboard sin un JOIN costoso.

**Colecciones:**
- `events`: `{traceId (unique), application, eventType, description, severity, occurredAt, metadata}`
- `alerts`: `{sourceTraceId, affectedApplication, severity, generatedAt, processingStatus}`

### 4.3 Redis DB0 — Cache Aside Pattern

**Qué guarda:** las métricas calculadas del dashboard, serializado como JSON.

**Flujo:**
```
GET /api/dashboard/metrics
         │
         ▼
redis.get('dashboard:metrics')
         │
    ┌────┴──────────────────┐
   HIT                    MISS
    │                       │
JSON.parse(cached)    Promise.all([...4 queries...])
retorna inmediato            │
                              ▼
                    redis.set('dashboard:metrics', JSON.stringify(metrics), 'EX', 30)
                              │
                              ▼
                    retorna metrics (incluye cachedAt)
```

**Invalidación activa en 3 puntos:**
1. Se crea un incidente nuevo.
2. Se cambia el estado de un incidente.
3. El `AlertWorker` crea una alerta nueva.

En los tres puntos, `MetricsBroadcastService.invalidateAndBroadcast()` hace `redis.del('dashboard:metrics')`, recalcula las métricas frescas, y las emite por WebSocket con `gateway.emitMetricsUpdated(freshMetrics)`.

**Por qué TTL de 30 segundos además de la invalidación activa:** si por alguna razón el broadcast falla (el WebSocket no llega, el worker tiene un error inesperado), el caché expira solo en 30 segundos. Es una capa de seguridad que previene que el dashboard muestre datos eternamente desactualizados.

### 4.4 Redis DB1 — BullMQ (Cola de Trabajo)

**Qué guarda:** jobs de procesamiento de alertas pendientes, en proceso, fallidos.

**Flujo asíncrono end-to-end:**
```
POST /api/events (severity: CRITICAL)
         │
         ▼ ThrottlerGuard → TraceId → ValidationPipe
         │
RegisterEventUseCase.execute()
         │
         ├─► mongoEventRepo.save() → retorna Event con id real de MongoDB
         │
         ├─► alertQueue.add('process-alert', { eventId, traceId, severity, application })
         │   [opciones: 3 reintentos, backoff exponencial 1s/2s/4s]
         │
         └─► return 201 { traceId }   ← respuesta inmediata al cliente

                    ↓ (segundo plano, independiente del HTTP)

AlertWorker.process(job)
         │
CreateAlertUseCase.execute()
         │
         ├─► mongoAlertRepo.save({ processingStatus: 'PROCESSED' })
         ├─► gateway.emitAlertCreated(alert)
         ├─► metricsBroadcast.invalidateAndBroadcast()
         │       ├─ redis.del('dashboard:metrics')
         │       ├─ recalcula 4 queries en parallel
         │       └─ gateway.emitMetricsUpdated(freshMetrics)
         └─► logger: ALERT_PROCESSING_COMPLETED

Si falla 3 veces:
         └─► dlq.add('failed-alert', job.data)
             logger: ALERT_PROCESSING_FAILED
```

**Por qué la respuesta HTTP es inmediata:** el endpoint `POST /api/events` no espera a que la alerta se procese. Esto es procesamiento desacoplado. El cliente recibe `201 { traceId }` en milisegundos, y el procesamiento de la alerta ocurre en background. Si el sistema de alertas tiene un pico de carga o falla temporalmente, los eventos siguen ingresando sin afectar la tasa de ingesta.

---

## 5. Requisitos Previos

### Software necesario (instalación desde cero)

Necesitas estas herramientas en tu máquina antes de empezar. Si ya las tienes instaladas, verifica las versiones mínimas.

```bash
# Verificar qué tienes instalado:
docker --version          # Necesitas: 24.x o superior
docker compose version    # Necesitas: v2.x (el comando es "docker compose", no "docker-compose")
node --version            # Necesitas: 20.x (solo si quieres correr la API fuera de Docker)
git --version             # Para clonar el repositorio
```

**¿Por qué Docker Compose y no instalar las bases de datos localmente?**  
PostgreSQL, MongoDB y Redis tienen instaladores distintos según el sistema operativo, diferentes versiones en conflicto, y puertos que pueden estar ocupados por otras aplicaciones. Docker Compose levanta las tres bases de datos en contenedores aislados con exactamente las versiones que el proyecto fue desarrollado (Postgres 15, Mongo 7, Redis 7), sin contaminar tu máquina. Con `docker compose down -v` vuelves a tener tu sistema exactamente como estaba.

### Instalación de Docker Desktop

**macOS / Windows:**
1. Ve a [https://docs.docker.com/desktop/](https://docs.docker.com/desktop/)
2. Descarga Docker Desktop para tu sistema operativo
3. Instala y abre la aplicación
4. Verifica que el ícono de Docker aparezca en la barra de sistema (ballena azul)

**Linux (Ubuntu/Debian):**
```bash
# Actualiza el índice de paquetes
sudo apt-get update

# Instala Docker Engine
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Agrega tu usuario al grupo docker (para no necesitar sudo)
sudo usermod -aG docker $USER

# Cierra sesión y vuelve a entrar para que el cambio de grupo surta efecto
# Verifica:
docker run hello-world
```

---

## 6. Variables de Entorno

El proyecto usa tres archivos de entorno:

| Archivo | Para qué | Cuándo usarlo |
|---|---|---|
| `.env.example` | Plantilla documentada (en el repositorio) | Punto de partida para copiar |
| `.env.development` | Desarrollo local con Docker | Siempre en local |
| `.env.test` | Pruebas automatizadas | `npm test` |

### Paso a paso para configurar el entorno

```bash
# 1. Copia el archivo de ejemplo
cp .env.example .env.development
```

### Referencia completa de variables

```bash
# ────────────────────────────────────────────────────
# ENTORNO
# ────────────────────────────────────────────────────
NODE_ENV=development       # Controla ConfigModule de NestJS
PORT=3000                  # Puerto en el que escucha la API

# ────────────────────────────────────────────────────
# POSTGRESQL
# Importante: el valor de POSTGRES_HOST depende de cómo corres la API:
#   - API fuera de Docker (npm run start:dev en tu terminal): POSTGRES_HOST=localhost
#   - API dentro de Docker (servicio "api" en docker-compose.yml): POSTGRES_HOST=postgres
#     (el nombre del servicio Docker hace de hostname DNS interno)
# ────────────────────────────────────────────────────
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=incidents_db
POSTGRES_USER=admin
POSTGRES_PASSWORD=secret

# ────────────────────────────────────────────────────
# MONGODB
# Mismo criterio: "localhost" fuera de Docker, "mongo" dentro
# ────────────────────────────────────────────────────
MONGO_URI=mongodb://localhost:27017/events_db

# ────────────────────────────────────────────────────
# REDIS
# Una instancia, dos bases lógicas:
#   DB 0 = caché de métricas del dashboard
#   DB 1 = cola de BullMQ para procesamiento de alertas
# ────────────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_CACHE_DB=0
REDIS_QUEUE_DB=1

# ────────────────────────────────────────────────────
# SEGURIDAD
# ────────────────────────────────────────────────────
# JWT_SECRET: firma los tokens de los operadores del dashboard (humanos).
# En producción: openssl rand -base64 32
JWT_SECRET=incidentes-coordinadora-jwt-dev-2026

# LEGACY_API_KEY: llave para el script PHP. Sistema-a-sistema, sin JWT de usuario.
LEGACY_API_KEY=legacy-php-dev-key-2026

# ────────────────────────────────────────────────────
# FRONTEND (Vite) — el backend no las lee, están aquí de referencia
# ────────────────────────────────────────────────────
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

---

## 7. Guía de Instalación Detallada 

### Opción A — Todo en Docker 

Esta opción levanta la API, el frontend y las tres bases de datos con un solo comando. Es la más sencilla para reproducir el entorno completo.

**Paso 1: Clonar los repositorios**
```bash
# Crea una carpeta para el proyecto
mkdir coordinadora-platform && cd coordinadora-platform

# Clona el backend
git clone <URL_REPO_BACKEND> backend-incident-platform
cd backend-incident-platform
```

> **Nota para el evaluador:** si tienes el zip, extráelo en la carpeta `coordinadora-platform/backend-incident-platform`.

**Paso 2: Configurar variables de entorno**
```bash
cp .env.example .env.development
# No es necesario editar nada — los valores del .env.example funcionan con Docker
```

**Paso 3: Verificar la estructura de carpetas**

El `docker-compose.yml` espera el frontend en `../frontend-incident-platform`. Si no tienes el frontend, comenta el servicio `frontend` en `docker-compose.yml`:
```yaml
# frontend:          # <-- comenta estas líneas si no tienes el frontend
#   build: ../frontend-incident-platform
#   ...
```

**Paso 4: Levantar todo el stack**
```bash
docker compose up --build

# ¿Qué hace este comando?
# --build: reconstruye la imagen de la API desde el Dockerfile (necesario la primera vez)
#
# Orden de inicio:
# 1. postgres (espera hasta que el healthcheck pg_isready pase)
# 2. mongo y redis (arrancan inmediatamente)
# 3. api (espera a postgres healthy + mongo + redis started)
# 4. frontend y php-legacy (esperan a api)
#
# El init.sql de Postgres se ejecuta automáticamente la primera vez que
# el contenedor de postgres arranca con el volumen vacío.
```

**Paso 5: Verificar que todo levantó correctamente**
```bash
# En otra terminal, verifica el health check:
curl http://localhost:3000/health

# Respuesta esperada:
# {
#   "status": "ok",
#   "info": {
#     "postgres": { "status": "up" },
#     "mongodb": { "status": "up" },
#     "redis": { "status": "up" }
#   }
# }
```

**Paso 6: Acceder a los servicios**

| Servicio | URL | Descripción |
|---|---|---|
| API REST | http://localhost:3000/api | Base de todos los endpoints |
| Swagger UI | http://localhost:3000/api/docs | Documentación interactiva |
| Health Check | http://localhost:3000/health | Estado de las dependencias |
| Frontend | http://localhost:5173 | Dashboard React (si lo tienes) |
| PostgreSQL | localhost:5432 | Datos transaccionales |
| MongoDB | localhost:27017 | Eventos y alertas |
| Redis | localhost:6379 | Caché y cola |

---

### Opción B — API en local, bases de datos en Docker

Esta opción es útil cuando desarrollas y quieres hot-reload de NestJS sin reconstruir la imagen Docker en cada cambio.

**Paso 1: Levantar solo las bases de datos**
```bash
docker compose up postgres mongo redis -d
# -d = detached mode (corre en background)
```

**Paso 2: Instalar dependencias de Node.js**
```bash
# Asegúrate de tener Node.js 20.x
node --version  # debe mostrar v20.x.x

npm install
# Esto instala todas las dependencias listadas en package.json
# Incluye devDependencies porque necesitas ts-jest para los tests
```

**Paso 3: Configurar el entorno local**
```bash
cp .env.example .env.development
# IMPORTANTE: cuando la API corre fuera de Docker y las BDs dentro,
# los hosts son "localhost", no los nombres de servicio Docker.
# El .env.example ya tiene los valores correctos para este caso.
```

**Paso 4: Ejecutar migraciones / verificar esquema**
```bash
# El init.sql se ejecutó automáticamente cuando postgres arrancó.
# Para verificar que las tablas existen:
docker exec -it $(docker compose ps -q postgres) psql -U admin -d incidents_db -c "\dt"
# Debe mostrar: incidents, incident_audit
```

**Paso 5: Correr la API en modo desarrollo**
```bash
npm run start:dev
# NestJS compila y escucha cambios en los archivos TypeScript.
# Verás en consola algo como:
# [Nest] LOG [NestApplication] Nest application successfully started
# Plataforma Operacional Backend corriendo en: http://localhost:3000/api
# Swagger UI disponible en: http://localhost:3000/api/docs
```

---

### Paso 7: Obtener un JWT para probar endpoints protegidos

La mayoría de los endpoints de incidentes y el dashboard requieren autenticación JWT. Sigue estos pasos:

**En Swagger UI:**
1. Abre http://localhost:3000/api/docs
2. Busca el endpoint `POST /api/auth/login`
3. Usa el body:
   ```json
   { "username": "admin", "password": "admin123" }
   ```
4. Copia el token de la respuesta
5. Haz clic en el botón **Authorize** (🔓) arriba a la derecha en Swagger
6. En el campo `JWT (http, Bearer)`, pega el token (sin el prefijo "Bearer")
7. Cierra el diálogo — ahora todos los requests de Swagger incluirán el header `Authorization: Bearer <token>`

**Con curl:**
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

echo "Token obtenido: $TOKEN"
```

---

## 8. Verificación por Base de Datos con Comandos Docker

Esta sección te permite verificar, a nivel de base de datos, que cada operación persiste correctamente.

---

### 8.1 Conectarse a PostgreSQL

```bash
# Comando para abrir una sesión psql dentro del contenedor de Postgres
docker exec -it $(docker compose ps -q postgres) psql -U admin -d incidents_db

# Si prefieres usar el nombre del contenedor directamente:
docker exec -it backend-incident-platform-postgres-1 psql -U admin -d incidents_db
# (el nombre puede variar según cómo Docker nombró el contenedor)
```

**Por qué este comando:** `docker exec -it` ejecuta un comando interactivo dentro de un contenedor en ejecución. `psql -U admin -d incidents_db` abre el cliente de PostgreSQL con el usuario y base de datos configurados en el `docker-compose.yml`.

**Consultas útiles dentro de psql:**

```sql
-- Ver las tablas existentes
\dt

-- Ver la estructura de la tabla incidents
\d incidents

-- Ver todos los incidentes (sin filtros)
SELECT id, title, status, severity, affected_app, created_at
FROM incidents
ORDER BY created_at DESC;

-- Ver el historial de auditoría de un incidente específico
SELECT ia.old_status, ia.new_status, ia.changed_by, ia.changed_at, ia.trace_id
FROM incident_audit ia
WHERE ia.incident_id = 'UUID_DEL_INCIDENTE'
ORDER BY ia.changed_at ASC;

-- Contar incidentes por estado (lo que el dashboard debería mostrar)
SELECT status, COUNT(*) as total
FROM incidents
GROUP BY status;

-- Verificar que el array TEXT[] se guardó correctamente (no como CSV)
SELECT id, related_event_trace_ids, pg_typeof(related_event_trace_ids)
FROM incidents
WHERE related_event_trace_ids IS NOT NULL
LIMIT 5;
-- pg_typeof debe mostrar "text[]", no "text"

-- Salir de psql
\q
```

---

### 8.2 Conectarse a MongoDB

```bash
# Abrir mongosh dentro del contenedor de MongoDB
docker exec -it $(docker compose ps -q mongo) mongosh events_db
```

**Por qué este comando:** `mongosh` es el shell de MongoDB. `events_db` es el nombre de la base de datos donde Mongoose guarda eventos y alertas (definido en `MONGO_URI`).

**Consultas útiles dentro de mongosh:**

```javascript
// Ver las colecciones existentes
show collections

// Ver los eventos registrados (más recientes primero)
db.events.find().sort({ occurredAt: -1 }).limit(5).pretty()

// Contar eventos por aplicación (lo que usa el dashboard)
db.events.aggregate([
  { $group: { _id: "$application", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])

// Contar eventos por severidad
db.events.aggregate([
  { $group: { _id: "$severity", count: { $sum: 1 } } }
])

// Ver los eventos CRITICAL (los que disparan alertas)
db.events.find({ severity: "CRITICAL" }).pretty()

// Ver las alertas generadas
db.alerts.find().sort({ generatedAt: -1 }).limit(5).pretty()

// Ver alertas por estado de procesamiento
db.alerts.aggregate([
  { $group: { _id: "$processingStatus", count: { $sum: 1 } } }
])

// Verificar la trazabilidad: dado un traceId de evento, encontrar su alerta
db.events.findOne({ traceId: "TRACE_ID_AQUI" })
db.alerts.findOne({ sourceTraceId: "TRACE_ID_AQUI" })

// Ver los índices de la colección events
db.events.getIndexes()

// Salir de mongosh
exit
```

---

### 8.3 Conectarse a Redis

```bash
# Abrir redis-cli dentro del contenedor de Redis
docker exec -it $(docker compose ps -q redis) redis-cli
```

**Por qué este comando:** `redis-cli` es el cliente de línea de comandos de Redis. Sin argumentos adicionales, se conecta al Redis local del contenedor en el puerto 6379.

**Comandos útiles dentro de redis-cli:**

```bash
# Verificar conectividad
PING
# Respuesta esperada: PONG

# ── DB 0: Caché de métricas ────────────────────────

# Cambiar a la DB 0 (caché)
SELECT 0

# Ver si existe la clave de métricas en caché
EXISTS dashboard:metrics
# Respuesta: 1 si existe, 0 si no

# Ver el contenido del caché de métricas
GET dashboard:metrics
# Respuesta: JSON con openIncidents, resolvedIncidents, cachedAt, etc.

# Ver cuánto tiempo le queda al TTL (en segundos)
TTL dashboard:metrics
# Respuesta: número de segundos restantes (máximo 30)
# -1 = sin TTL (no debería pasar)
# -2 = la clave no existe

# ── DB 1: Cola de BullMQ ────────────────────────────

# Cambiar a la DB 1 (cola)
SELECT 1

# Ver las claves de BullMQ (jobs en la cola)
KEYS *
# Mostrará claves como:
# bull:alert-processing:1 (job ID 1)
# bull:alert-processing:active (set de jobs activos)
# bull:alert-processing:completed (set de jobs completados)
# bull:alert-processing:failed (set de jobs fallidos)
# bull:alert-processing-failed:* (DLQ si hubo fallos)

# Ver los jobs completados (los últimos 100 se mantienen por la config)
LRANGE bull:alert-processing:completed 0 -1

# Ver si hay jobs en la DLQ (fallidos después de 3 intentos)
LRANGE bull:alert-processing-failed:failed 0 -1

# Verificar cantidad de jobs en cada estado
LLEN bull:alert-processing:wait      # esperando procesamiento
LLEN bull:alert-processing:active    # procesándose ahora
LLEN bull:alert-processing:completed # completados
LLEN bull:alert-processing:failed    # fallidos (antes de DLQ)

# Salir de redis-cli
EXIT
```

**Por qué dos DBs separadas en la misma instancia Redis:**  
La separación lógica por número de base de datos (DB0, DB1) permite que `KEYS *` en DB0 solo muestre claves de caché, sin mezclarlas con las claves de BullMQ. En producción, esto escalaría a instancias físicamente separadas (un Redis para caché, un Redis para la cola), con el mismo cambio de configuración en las variables de entorno.

---

## 9. Pruebas por Historia de Usuario (HU) — Paso a Paso

> **Prerrequisito:** el stack completo debe estar corriendo (`docker compose up`), y debes tener un JWT válido (ver sección 7, Paso 7).

---

### HU1 — Registro de Eventos Operacionales

**Objetivo:** el sistema acepta eventos de múltiples aplicaciones con su aplicación origen, tipo, descripción, severidad, fecha y traceId.

**Paso 1: Registrar un evento de baja severidad (LOW)**
```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "application": "payment-service",
    "eventType": "RESPONSE_SLOW",
    "description": "El tiempo de respuesta supera los 500ms",
    "severity": "LOW",
    "occurredAt": "2026-06-21T10:00:00Z",
    "metadata": { "responseTime": 523, "endpoint": "/api/checkout" }
  }'

# Respuesta esperada (201):
# { "traceId": "uuid-generado-por-el-servidor" }
```

**Por qué no genera alerta:** la lógica en `register-event.use-case.ts` solo encola un job en BullMQ si `severity === 'CRITICAL'`. LOW, MEDIUM y HIGH solo persisten en MongoDB.

**Verificación en MongoDB:**
```bash
docker exec -it $(docker compose ps -q mongo) mongosh events_db --eval \
  "db.events.findOne({}, {}, { sort: { occurredAt: -1 } })"
```

**Paso 2: Registrar un evento CRITICAL (dispara alerta)**
```bash
TRACE=$(curl -s -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "application": "payment-service",
    "eventType": "GATEWAY_TIMEOUT",
    "description": "El gateway de pagos no responde tras 3 reintentos",
    "severity": "CRITICAL",
    "occurredAt": "2026-06-21T10:05:00Z",
    "metadata": { "gateway": "Stripe", "attempts": 3 }
  }' | grep -o '"traceId":"[^"]*"' | cut -d'"' -f4)

echo "TraceId del evento: $TRACE"
```

**Verificación — trazabilidad evento → alerta:**
```bash
# 1. El evento en MongoDB
docker exec -it $(docker compose ps -q mongo) mongosh events_db --eval \
  "db.events.findOne({ traceId: '$TRACE' })"

# 2. La alerta generada por el worker (espera ~1 segundo)
sleep 2
docker exec -it $(docker compose ps -q mongo) mongosh events_db --eval \
  "db.alerts.findOne({ sourceTraceId: '$TRACE' })"

# La alerta debe tener: processingStatus: "PROCESSED", sourceTraceId: "$TRACE"
```

**Paso 3: Verificar rate limiting**
```bash
# Enviar más de 100 requests en 60 segundos al mismo endpoint
for i in {1..105}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/events \
    -H "Content-Type: application/json" \
    -d '{"application":"test","eventType":"TEST","description":"test","severity":"LOW","occurredAt":"2026-01-01T00:00:00Z"}'
done | sort | uniq -c
# Los primeros 100 deben ser "201", los restantes "429"
```

---

### HU2 — Gestión de Incidentes

**Objetivo:** crear incidentes, actualizarlos, y validar que las transiciones de estado inválidas son rechazadas.

**Paso 1: Crear un incidente**
```bash
INCIDENT_ID=$(curl -s -X POST http://localhost:3000/api/incidents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Fallo en gateway de pagos",
    "description": "El servicio de Stripe no responde tras múltiples intentos",
    "affectedApplication": "payment-service",
    "severity": "CRITICAL",
    "assignee": "ops@empresa.com",
    "relatedEventTraceIds": ["'"$TRACE"'"]
  }' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

echo "Incidente creado: $INCIDENT_ID"
```

**Verificación en PostgreSQL:**
```bash
docker exec -it $(docker compose ps -q postgres) psql -U admin -d incidents_db \
  -c "SELECT id, title, status, severity, related_event_trace_ids FROM incidents WHERE id = '$INCIDENT_ID';"

# Verificar la auditoría de creación
docker exec -it $(docker compose ps -q postgres) psql -U admin -d incidents_db \
  -c "SELECT old_status, new_status, changed_by, changed_at FROM incident_audit WHERE incident_id = '$INCIDENT_ID';"
# Debe mostrar: old_status=OPEN, new_status=OPEN, changed_by=SYSTEM
```

**Paso 2: Transición de estado válida (OPEN → IN_PROGRESS)**
```bash
curl -X PATCH http://localhost:3000/api/incidents/$INCIDENT_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "status": "IN_PROGRESS" }'

# Respuesta esperada (200): el incidente con status actualizado

# Verificar la nueva entrada de auditoría
docker exec -it $(docker compose ps -q postgres) psql -U admin -d incidents_db \
  -c "SELECT old_status, new_status, changed_by FROM incident_audit WHERE incident_id = '$INCIDENT_ID' ORDER BY changed_at;"
# Debe mostrar 2 filas: OPEN→OPEN (creación) y OPEN→IN_PROGRESS (cambio)
```

**Paso 3: Transición de estado inválida (RESOLVED → IN_PROGRESS)**
```bash
# Primero, llevar el incidente a RESOLVED
curl -s -X PATCH http://localhost:3000/api/incidents/$INCIDENT_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "status": "RESOLVED" }'

# Ahora intentar una transición inválida
curl -X PATCH http://localhost:3000/api/incidents/$INCIDENT_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "status": "IN_PROGRESS" }'

# Respuesta esperada (409 Conflict):
# {
#   "statusCode": 409,
#   "error": "CONFLICT",
#   "message": "La transición de RESOLVED a IN_PROGRESS no está permitida",
#   "traceId": "...",
#   "timestamp": "..."
# }
```

**Por qué el 409 y no un 400:** el 409 (Conflict) indica que la operación es semánticamente correcta (el formato del request es válido, el status que pides existe) pero entra en conflicto con el estado actual del recurso. Es la respuesta HTTP correcta para violaciones de reglas de negocio que dependen del estado, no para errores de validación de input.

**Paso 4: Consultar incidentes con paginación y filtros**
```bash
# Filtrar incidentes abiertos, página 1, 20 por página
curl "http://localhost:3000/api/incidents?status=OPEN&page=1&limit=20" \
  -H "x-api-key: legacy-php-dev-key-2026"

# Filtrar por severidad CRITICAL
curl "http://localhost:3000/api/incidents?severity=CRITICAL" \
  -H "x-api-key: legacy-php-dev-key-2026"

# Verificar que limit=500 se acota o rechaza
curl "http://localhost:3000/api/incidents?limit=500" \
  -H "x-api-key: legacy-php-dev-key-2026"
# El DTO tiene @Max(100), por lo que debería retornar 400 o acotar a 100
```

---

### HU3 — Procesamiento Asíncrono de Alertas

**Objetivo:** verificar que las alertas se generan automáticamente para eventos CRITICAL, con trazabilidad y manejo de reintentos.

**Paso 1: Verificar la alerta generada en el HU1**
El evento CRITICAL del paso HU1 ya generó una alerta. Verifica que esté en MongoDB:

```bash
# Ver todas las alertas en la colección
docker exec -it $(docker compose ps -q mongo) mongosh events_db --eval \
  "db.alerts.find().sort({ generatedAt: -1 }).limit(5).pretty()"

# Verificar que el status es PROCESSED, no PENDING ni FAILED
docker exec -it $(docker compose ps -q mongo) mongosh events_db --eval \
  "db.alerts.countDocuments({ processingStatus: 'PROCESSED' })"
```

**Paso 2: Verificar los logs del worker**
```bash
# Ver los logs del contenedor de la API para buscar los mensajes del worker
docker logs $(docker compose ps -q api) 2>&1 | grep "ALERT"
# Deberías ver:
# {"action":"ALERT_QUEUED","traceId":"..."}
# {"action":"ALERT_PROCESSING_STARTED","traceId":"...","jobId":"1"}
# {"action":"ALERT_PROCESSING_COMPLETED","traceId":"...","alertId":"..."}
```

**Paso 3: Verificar los jobs en Redis**
```bash
docker exec -it $(docker compose ps -q redis) redis-cli SELECT 1
# Luego:
KEYS *
LLEN bull:alert-processing:completed
```

---

### HU4 — Dashboard Operacional en Tiempo Real

**Objetivo:** verificar el Cache Aside Pattern y la actualización en tiempo real.

**Paso 1: Primera llamada al dashboard (MISS de caché)**
```bash
curl -s http://localhost:3000/api/dashboard/metrics \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Respuesta incluirá:
# {
#   "openIncidents": N,
#   "resolvedIncidents": M,
#   "eventsByApp": [...],
#   "eventsBySeverity": [...],
#   "recentAlerts": [...],
#   "cachedAt": "2026-06-21T10:15:00.000Z"  ← timestamp del cálculo
# }
```

**Verificar que el resultado fue cacheado:**
```bash
docker exec -it $(docker compose ps -q redis) redis-cli GET dashboard:metrics
# Debe retornar el JSON de las métricas
docker exec -it $(docker compose ps -q redis) redis-cli TTL dashboard:metrics
# Debe retornar un número entre 1 y 30
```

**Paso 2: Segunda llamada (HIT de caché)**
```bash
METRICS1=$(curl -s http://localhost:3000/api/dashboard/metrics \
  -H "Authorization: Bearer $TOKEN")
METRICS2=$(curl -s http://localhost:3000/api/dashboard/metrics \
  -H "Authorization: Bearer $TOKEN")

# Extraer cachedAt de ambas respuestas
echo "Primera:  $(echo $METRICS1 | grep -o '"cachedAt":"[^"]*"')"
echo "Segunda:  $(echo $METRICS2 | grep -o '"cachedAt":"[^"]*"')"
# El cachedAt debe ser IDÉNTICO — confirma que la segunda respuesta vino del caché
```

**Paso 3: Verificar invalidación activa**
```bash
# Cambiar el status de un incidente
curl -s -X PATCH http://localhost:3000/api/incidents/$INCIDENT_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "status": "OPEN" }'

# Inmediatamente después, el caché debe estar vacío (invalidado):
docker exec -it $(docker compose ps -q redis) redis-cli EXISTS dashboard:metrics
# Respuesta: 0 (la clave fue eliminada)

# La siguiente llamada al dashboard volverá a calcular y a cachear:
curl -s http://localhost:3000/api/dashboard/metrics \
  -H "Authorization: Bearer $TOKEN" | grep cachedAt
# El timestamp es posterior al anterior
```

**Paso 4: Verificar los filtros del dashboard**
```bash
# Filtrar incidentes por aplicación en el listado
curl "http://localhost:3000/api/incidents?application=payment-service" \
  -H "x-api-key: legacy-php-dev-key-2026"

# Filtrar por fecha (si el endpoint lo soporta — verificar en Swagger)
curl "http://localhost:3000/api/incidents?status=OPEN&severity=HIGH" \
  -H "x-api-key: legacy-php-dev-key-2026"
```

---

### HU5 — Integración con Sistema Legacy PHP

**Objetivo:** el script PHP consume la misma API REST estándar usando x-api-key, sin rutas especiales.

**Paso 1: Ejecutar el cliente PHP desde Docker**
```bash
docker compose run --rm php-legacy

# Salida esperada:
# ──────────────────────────────────────────────
#  Sistema Legacy PHP — Consulta de Incidentes
# ──────────────────────────────────────────────
# Consultando: http://api:3000/api/incidents?status=OPEN&page=1&limit=20
#
# {
#   "paginacion": {
#     "pagina_actual": 1,
#     "total_paginas": 1,
#     "total_registros": 2
#   },
#   "incidentes": [
#     {
#       "id": "uuid-...",
#       "aplicacion": "payment-service",
#       "severidad": "CRITICAL",
#       "estado": "OPEN",
#       "creado_en": "2026-06-21T10:00:00.000Z"
#     }
#   ]
# }
#
# ──────────────────────────────────────────────
#  Total de incidentes abiertos encontrados: 1
# ──────────────────────────────────────────────
```

**Paso 2: Ejecutar con paginación custom**
```bash
# Segunda página, 5 incidentes por página
docker compose run --rm php-legacy php legacy-client.php 2 5
```

**Paso 3: Verificar que sin x-api-key el endpoint da 401**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/api/incidents?status=OPEN"
# Respuesta: 401 (Unauthorized)

curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/api/incidents?status=OPEN" \
  -H "x-api-key: legacy-php-dev-key-2026"
# Respuesta: 200
```

**Por qué ApiKey para el PHP y no JWT:** el script PHP es un sistema, no un usuario humano. Los JWTs tienen expiración y requieren un flujo de login interactivo. Una API Key es el mecanismo estándar para autenticación sistema-a-sistema: el sistema la conoce de antemano y no necesita renovarla cada 24h. Si la API Key se filtra, su radio de daño es menor que el de un JWT que pueda tener permisos de escritura.

---

## 9. Pruebas Unitarias y de Integración

### Descripción de la estrategia de pruebas

El proyecto usa **tres tipos de prueba** con distintos niveles de aislamiento:

**1. Prueba de dominio puro (sin ningún mock):**
`incident-status.vo.spec.ts` prueba la máquina de estados de `IncidentStatus` instanciando la clase directamente. No levanta NestJS, no usa Jest mocks, no necesita base de datos. Si esta prueba pasa, la regla de negocio más crítica del sistema es correcta.

**2. Pruebas de integración con mocks manuales:**
`create-incident.use-case.integration.spec.ts` y `update-incident-status.use-case.integration.spec.ts` usan `@nestjs/testing` para instanciar los casos de uso con repositorios y servicios reemplazados por objetos `jest.fn()`. Esto prueba la orquestación del caso de uso (qué llama, con qué argumentos, en qué orden) sin tocar la base de datos real.

**3. Prueba de integración con la cola:**
`register-event.use-case.integration.spec.ts` verifica que un evento CRITICAL encola un job en BullMQ con los campos correctos (`eventId`, `traceId`, etc.) usando un mock de la `Queue`.

**Por qué "integración" si usa mocks:** en el contexto DDD, "integración" se refiere a que se prueban múltiples capas trabajando juntas (caso de uso + Value Object + repositorio), no que se integra con infraestructura real. La nomenclatura es intencional para distinguir estas pruebas de los tests de unidad del dominio puro.

### Ejecutar las pruebas

```bash
# Ejecutar todas las pruebas (requiere Node.js en tu máquina)
npm test

# Con reporte de cobertura
npm run test:cov

# Modo watch (re-ejecuta al guardar cambios)
npm run test:watch

# Ejecutar solo un archivo específico
npx jest incident-status.vo.spec.ts

# Ejecutar pruebas que matcheen un patrón
npx jest --testNamePattern="debe permitir la transición"
```

### Lo que cada suite prueba

**`incident-status.vo.spec.ts` (prueba de dominio):**
```
✓ Inicializa estado OPEN válido
✓ Lanza excepción con estado inexistente
✓ OPEN → IN_PROGRESS: permitido
✓ OPEN → RESOLVED: prohibido (salto de estado)
✓ IN_PROGRESS → RESOLVED: permitido
✓ IN_PROGRESS → OPEN: permitido (reapertura)
✓ RESOLVED → IN_PROGRESS: prohibido (incidente congelado)
✓ RESOLVED → OPEN: prohibido (incidente congelado)
```

**`create-incident.use-case.integration.spec.ts`:**
```
✓ Persiste el incidente y devuelve la entidad guardada
✓ Construye la entidad con status inicial OPEN (ignorando cualquier status en el DTO)
✓ Asigna 'UNASSIGNED' cuando no se provee assignee
✓ Crea el registro de auditoría con oldStatus=OPEN y newStatus=OPEN
✓ Incluye los relatedEventTraceIds del DTO en la entidad
✓ Inicializa relatedEventTraceIds como [] cuando no se provee
✓ Invoca invalidateAndBroadcast después de persistir
✓ Invoca invalidateAndBroadcast incluso con campos mínimos
✓ Propaga el error si saveWithAudit falla (no llama broadcast)
✓ Lanza el error si invalidateAndBroadcast falla tras persistir
```

**`update-incident-status.use-case.integration.spec.ts`:**
```
✓ Transiciona de OPEN a IN_PROGRESS y registra auditoría
✓ Transiciona de IN_PROGRESS a RESOLVED correctamente
✓ Lanza ConflictException en transición inválida RESOLVED → IN_PROGRESS
✓ No llama saveWithAudit si la transición es inválida
✓ Llama emitIncidentUpdated en el gateway con el incidente actualizado
✓ Llama invalidateAndBroadcast después de una transición exitosa
✓ Lanza NotFoundException si el incidente no existe
```

**`register-event.use-case.integration.spec.ts`:**
```
✓ Registra el evento en MongoDB y encola job en BullMQ si es CRITICAL
```

---

## 10. Estrategia de Escalamiento en Producción

La plataforma fue diseñada con escalamiento horizontal en mente desde el inicio. Esta sección explica cómo cada componente escalaría.

### Nivel 1 — API NestJS

El backend es stateless (no guarda estado en memoria entre requests). Cualquier número de instancias puede correr en paralelo detrás de un load balancer:

```
Internet
   │
Load Balancer (NGINX / AWS ALB)
   │          │          │
API v1      API v2     API v3
(port 3000) (port 3001) (port 3002)
   │
PostgreSQL / MongoDB / Redis (compartidos)
```

**Lo que hay que revisar antes de escalar la API:**
- `ThrottlerModule` usa almacenamiento en memoria por defecto. Con múltiples instancias, el límite se aplica por instancia, no globalmente. En producción, usar `@nestjs/throttler` con `ThrottlerStorageRedisService` para un rate limit compartido.
- Las WebSockets con `socket.io` requieren un `Redis adapter` para que eventos emitidos en una instancia lleguen a clientes conectados a otra instancia. Instalar `@socket.io/redis-adapter`.

### Nivel 2 — BullMQ Workers

Los workers son horizontalmente escalables por diseño de BullMQ: múltiples instancias consumen la misma cola concurrentemente, y BullMQ garantiza que cada job se procese exactamente una vez:

```
Redis DB1 (cola)
      │
   [job 1] [job 2] [job 3] [job 4]
      │          │          │
 Worker A    Worker B   Worker C
(instancia 1)(instancia 2)(instancia 3)
```

Para el reto técnico, el worker corre en el mismo proceso que la API. En producción, se movería a un servicio separado (`worker.service.ts`) con su propio Dockerfile.

### Nivel 3 — PostgreSQL

```
Escrituras → Primary (incidentes, auditoría)
Lecturas   → Read Replica 1 (dashboard, listados paginados)
           → Read Replica 2 (reportes, exports)
```

El dashboard solo hace lecturas (`countByStatus`, etc.). Redirigir esas queries a una réplica de lectura reduce la carga del primary sin cambiar el código de la API (solo cambiar la string de conexión de TypeORM para el caso de uso del dashboard).

### Nivel 4 — MongoDB

MongoDB tiene sharding horizontal nativo. Para el caso de eventos de alto volumen:
- Shard key: `{ application: 1, occurredAt: -1 }` — distribuye los documentos por aplicación y fecha, que son los campos más usados en los filtros del dashboard.

### Nivel 5 — Redis

```
Actual (desarrollo): una instancia, DB0 + DB1
Producción mínima:   Redis Sentinel (3 nodos: 1 primary + 2 réplicas + 3 sentinels)
Producción alta:     Redis Cluster (6 nodos: 3 primaries + 3 réplicas)
```

El único cambio en el código: en `BullModule.forRootAsync` y en `RedisModule`, cambiar la config de `{ host, port, db }` por una config de cluster o sentinel. La lógica de negocio no se toca.

---

## 12. Trade-offs y Decisiones Pendientes (Honestidad Técnica)

Esta sección documenta las decisiones donde se eligió una opción sobre otra con conciencia de los compromisos, y las mejoras que quedarían para una iteración posterior.

### 12.1 Trade-offs aceptados

**T1 — `synchronize: false` vs migraciones explícitas**

Se eligió `synchronize: false` con el `init.sql` como fuente de verdad del esquema. Esto significa que las entidades TypeORM deben mantenerse sincronizadas manualmente con el DDL. El beneficio: nunca hay un `DROP COLUMN` accidental. El costo: si agregas un campo a la entidad y olvidas actualizar el `init.sql`, la aplicación lanza un error en el primer query que use ese campo.

En producción con TypeORM: agregar migraciones con `npx typeorm migration:generate` es el siguiente paso obvio.

**T2 — Caché de métricas con TTL de 30 segundos + invalidación activa**

El TTL de 30 segundos existe como red de seguridad. La invalidación activa debería asegurarse de que el caché siempre esté fresco. El riesgo: si `MetricsBroadcastService.invalidateAndBroadcast()` falla (por un error no capturado), el dashboard podría mostrar datos con hasta 30 segundos de retraso. En producción, se agregaría un try-catch en el broadcast que loguee el error pero no interrumpa el flujo principal de negocio.

**T3 — `forwardRef` en MetricsBroadcastService**

La dependencia circular entre `MetricsBroadcastService` (en `shared`) y `GetDashboardMetricsUseCase` (en `dashboard`) se resolvió con `forwardRef`. Es una solución funcional pero indica un acoplamiento de diseño. La solución más limpia sería usar el patrón de eventos de NestJS (`EventEmitter2`) para que `MetricsBroadcastService` emita un evento `metrics.invalidated` y `DashboardModule` lo escuche, eliminando la dependencia directa.

**T4 — Dockerfile sin multi-stage build**

El Dockerfile actual instala devDependencies y corre en modo `start:dev` (con watcher de archivos). Para producción, el Dockerfile correcto sería:

```dockerfile
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: runtime
FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
```

Esto reduce el tamaño de la imagen de ~800MB a ~200MB y elimina los devDependencies del contenedor de producción.

**T5 — Tests de integración HTTP con supertest no implementados**

Los tests actuales son de aplicación (casos de uso con mocks). Los tests de integración HTTP completos (como `POST /api/events → 201`, `PATCH /api/incidents/:id/status → 409`) usando `supertest` con `TestingModule` no están implementados. Esto requeriría un módulo de test con bases de datos embebidas (postgres en memoria no existe nativamente, pero hay opciones como `testcontainers`). Para el alcance de 4 días, se priorizaron los tests de dominio y aplicación.

### 12.2 Decisiones pendientes para producción

**D1 — Autenticación y registro de usuarios**

El endpoint `POST /api/auth/login` actualmente valida contra credenciales hardcodeadas en `auth.module.ts`. En producción: tabla `users` en PostgreSQL con passwords hasheadas con bcrypt, refresh tokens con rotación, y posiblemente integración con OAuth 2.0 / SAML.

**D2 — TTL Index en MongoDB para eventos**

Los eventos se acumulan indefinidamente. En producción, agregar un TTL Index para eliminar automáticamente eventos con más de 90 días:
```javascript
db.events.createIndex({ occurredAt: 1 }, { expireAfterSeconds: 7776000 })
```

**D3 — Rate Limiting por usuario, no por IP**

El Throttler actual limita por IP. En un entorno corporativo con NAT, cientos de usuarios pueden compartir la misma IP pública. En producción: rate limiting por `x-api-key` o por `userId` del JWT.

**D4 — Métricas de observabilidad (Prometheus + Grafana)**

El logging estructurado por JSON está implementado (todos los logs incluyen `action`, `traceId`, `timestamp`). El siguiente paso natural es exportar esos logs a un sistema de métricas (Prometheus con `@willsoto/nestjs-prometheus`, o enviarlos a Datadog/New Relic) para alertas proactivas basadas en tasas de error, latencia de endpoints y profundidad de la cola BullMQ.

**D5 — Frontend no incluido en este repositorio**

El backend está diseñado como API-first: todos los endpoints están documentados en Swagger y son consumibles por cualquier frontend. El React Dashboard existe en un repositorio separado. Para la evaluación, el backend puede evaluarse completamente con Swagger UI o Postman sin el frontend.

---
