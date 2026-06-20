# Plataforma de Gestión de Incidentes y Monitoreo Operacional — Backend

API REST + WebSockets construida en NestJS para centralizar eventos operacionales, gestionar el ciclo de vida de incidentes y exponer métricas en tiempo real para el equipo de operaciones.

Este documento explica cómo levantar el proyecto y, sobre todo, **por qué está construido como está**. No es un README genérico de NestJS: cada decisión técnica responde a un problema concreto del reto (HU1 a HU5) y aquí dejo el razonamiento detrás de cada una, para que cualquiera que revise el repo (o yo mismo en 3 meses) entienda el "por qué" sin tener que adivinarlo leyendo el código.

---

## Índice

1. [Stack y por qué cada pieza está ahí](#1-stack-y-por-qué-cada-pieza-está-ahí)
2. [Arquitectura general](#2-arquitectura-general)
3. [Decisiones de base de datos](#3-decisiones-de-base-de-datos)
4. [Cómo funciona el caché (Redis)](#4-cómo-funciona-el-caché-redis)
5. [Cómo funcionan los WebSockets](#5-cómo-funcionan-los-websockets)
6. [Procesamiento asíncrono de alertas](#6-procesamiento-asíncrono-de-alertas)
7. [Integración con el sistema legacy (HU5)](#7-integración-con-el-sistema-legacy-hu5)
8. [Seguridad](#8-seguridad)
9. [Instalación y ejecución](#9-instalación-y-ejecución)
10. [Variables de entorno](#10-variables-de-entorno)
11. [Pruebas](#11-pruebas)
12. [Documentación de la API](#12-documentación-de-la-api)
13. [Decisiones que quedaron pendientes / fuera de alcance](#13-decisiones-que-quedaron-pendientes--fuera-de-alcance)

---

## 1. Stack y por qué cada pieza está ahí

| Pieza | Para qué la uso | Por qué esa y no otra |
|---|---|---|
| **NestJS + TypeScript** | Framework del backend | Da estructura modular de fábrica (módulos, providers, guards, interceptors), que encaja directo con DDD sin tener que inventar convenciones propias. |
| **PostgreSQL** | Incidentes y su auditoría | Necesito transacciones ACID reales y un ciclo de vida con estados controlados. Esto lo explico a fondo en la sección 3. |
| **MongoDB** | Eventos y alertas | Volumen alto de escritura, forma variable (cada app manda un `metadata` distinto), sin necesidad de migraciones cada vez que aparece un campo nuevo. |
| **Redis** | Caché de métricas + cola de trabajos (BullMQ) | Un solo motor cubriendo dos responsabilidades distintas pero separadas lógicamente por número de base. |
| **BullMQ** | Procesar alertas en segundo plano | Para que registrar un evento crítico no le cueste tiempo de respuesta al cliente que lo envía. |
| **Socket.IO** | Tiempo real hacia el dashboard | El operador necesita ver alertas e incidentes sin refrescar la página. |
| **Swagger/OpenAPI** | Documentación de contratos | Requisito explícito del reto y, en la práctica, la forma más rápida de que alguien pruebe la API sin tener que leerse el código. |

La regla que usé para decidir cada tecnología fue siempre la misma: **mirar la naturaleza del dato, no mi preferencia personal**. Si me preguntan en la sustentación "¿por qué no metiste todo en una sola base de datos?", la respuesta corta es esa.

---

## 2. Arquitectura general

El sistema sigue **Domain-Driven Design** con 4 capas por módulo (`events`, `incidents`, `alerts`, `dashboard`). La regla de oro: la lógica de negocio vive en `domain/` y no sabe nada de NestJS, de Postgres ni de Mongo. Si mañana cambio TypeORM por Prisma, lo único que toco es `infrastructure/`.

```
┌──────────────────────────────────────────────────────────────────┐
│                         PRESENTATION                              │
│   Controllers HTTP · WebSocket Gateway · Guards · DTOs validados  │
└───────────────────────────┬────────────────────────────────────┬─┘
                             │                                    │
┌────────────────────────────▼──────────────┐   ┌─────────────────▼─────────────┐
│              APPLICATION                    │   │      (entrada externa)        │
│   Use Cases · orquestación de flujo         │   │   BullMQ Worker (alertas)     │
│   No conoce SQL, no conoce HTTP             │◄──┤   actúa como un "controller"  │
└────────────────────────────┬───────────────┘   │   pero para colas, no HTTP     │
                             │                    └────────────────────────────────┘
┌────────────────────────────▼──────────────┐
│                  DOMAIN                     │
│  Entidades puras · Value Objects            │
│  Interfaces de repositorio (contratos)      │
│  Reglas de negocio (ej: transiciones de     │
│  estado de un incidente)                    │
└────────────────────────────┬───────────────┘
                             │ implementa
┌────────────────────────────▼──────────────┐
│              INFRASTRUCTURE                 │
│  TypeORM (Postgres) · Mongoose (Mongo)      │
│  Cliente Redis · Config de BullMQ           │
└──────────────────────────────────────────────┘
```

Un ejemplo concreto de por qué esto importa: la regla "un incidente `RESOLVED` no puede volver a `IN_PROGRESS` directamente" vive en un Value Object (`IncidentStatus`) dentro de `domain/`. No está en el controller, no está en el repositorio. Eso significa que puedo testear esa regla sin levantar NestJS, sin mockear una base de datos, sin hacer un solo request HTTP — es una clase de TypeScript pura con un método.

El worker de BullMQ (`AlertWorker`) vive en `infrastructure/queue/`, no en `application/`, aunque al principio uno podría pensar que "procesar una alerta" es lógica de aplicación. La razón: un `@Processor` de BullMQ es un punto de entrada impulsado por un framework externo, conceptualmente es lo mismo que un controlador HTTP — solo que en lugar de escuchar peticiones HTTP escucha jobs de una cola. Por eso vive en infraestructura y delega el trabajo real a `CreateAlertUseCase`, que sí es un caso de uso puro.

### Flujo completo de un evento crítico

```
Sistema externo
      │
      │ POST /api/events  { severity: "CRITICAL", ... }
      ▼
ThrottlerGuard ──► 429 si se excede el límite de ráfaga
      │
TraceIdInterceptor ──► genera/reutiliza un x-trace-id
      │
ValidationPipe ──► 400 si el payload no cumple el DTO
      │
RegisterEventUseCase
      │
      ├─► Mongo: guarda el evento, retorna el _id real
      │
      ├─► severity === CRITICAL?
      │        └─► encola job "process-alert" en BullMQ con el eventId real
      │
      └─► responde 201 { traceId }  ← inmediato, no espera a que se procese la alerta
                  │
                  │  (en paralelo, en segundo plano)
                  ▼
        AlertWorker.process(job)
                  │
                  ├─► CreateAlertUseCase ──► Mongo: guarda la alerta
                  ├─► gateway.emitAlertCreated(alert)        → llega al navegador por WebSocket
                  └─► metricsBroadcast.invalidateAndBroadcast()
                              ├─ borra el caché de métricas
                              ├─ recalcula
                              └─ gateway.emitMetricsUpdated(metrics)  → dashboard se actualiza solo
```

Lo importante de este flujo: **el cliente que manda el evento nunca espera a que la alerta termine de procesarse**. Recibe su `201` apenas el evento queda guardado en Mongo. Todo lo demás pasa desacoplado, con reintentos automáticos si algo falla.

---

## 3. Decisiones de base de datos

### ¿Por qué PostgreSQL para incidentes y no todo en Mongo?

Los incidentes tienen tres características que piden a gritos una base relacional:

1. **Tienen un ciclo de vida con estados controlados.** `OPEN → IN_PROGRESS → RESOLVED`, y no todas las transiciones son válidas (no puedes pasar de `RESOLVED` a `IN_PROGRESS` directamente). Esa regla la refuerzo en dos capas: en el dominio (Value Object) y en el motor de base de datos (tipo `ENUM` en Postgres), así que ni siquiera alguien escribiendo directo a la base sin pasar por la API puede meter un estado inválido.
2. **Tienen una relación 1:N con su auditoría.** Cada cambio de estado genera un registro en `incident_audit`. Eso es exactamente el caso de uso para el que existen las foreign keys.
3. **Necesitan consistencia inmediata.** Cuando un operador cambia el estado de un incidente, ese cambio y su registro de auditoría tienen que guardarse juntos — o se guardan los dos, o no se guarda ninguno. Eso es una garantía ACID, nativa en Postgres.

```sql
CREATE TYPE incident_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
CREATE TYPE severity_level  AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE incidents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   VARCHAR(255) NOT NULL,
  affected_app            VARCHAR(100) NOT NULL,
  severity                severity_level NOT NULL,
  status                  incident_status NOT NULL DEFAULT 'OPEN',
  related_event_trace_ids TEXT[],          -- array nativo, no string serializado
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE TABLE incident_audit (               -- append-only, nunca se actualiza ni se borra
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID NOT NULL REFERENCES incidents(id),
  old_status   incident_status NOT NULL,
  new_status   incident_status NOT NULL,
  changed_at   TIMESTAMP DEFAULT NOW()
);
```

Una nota técnica que vale la pena dejar explícita: `relatedEventTraceIds` es un array **nativo** de Postgres (`TEXT[]`), no la serialización en string que hace TypeORM con `simple-array`. La diferencia importa porque con un array nativo puedo usar operadores reales de Postgres como `@>` o `&&` en queries futuras, algo que con un string separado por comas no se puede hacer sin parsear.

El guardado del incidente y su auditoría va envuelto en una transacción real con `QueryRunner` (no dos llamadas sueltas a dos repositorios): si el segundo `save()` falla, se hace rollback del primero también. No queda nunca un incidente con estado cambiado pero sin rastro de auditoría.

### ¿Por qué MongoDB para eventos?

Los eventos son justo lo opuesto a un incidente:

- **Append-only**: se crean y ya, no se actualizan ni se borran en este alcance.
- **De forma variable**: el campo `metadata` necesita aceptar estructuras distintas según qué aplicación esté mandando el evento, sin que eso implique una migración de esquema cada vez que un sistema nuevo se conecta.
- **Alto volumen de escritura**: si todas las apps de la organización mandan eventos todo el tiempo, esa escritura necesita ser barata y no competir por locks con las transacciones de incidentes.

Mongo encaja mejor ahí porque el modelo de documento no obliga a una migración por cada campo nuevo, y los índices compuestos (`application + severity + occurredAt`) sostienen el rendimiento de lectura del dashboard sin penalizar tanto la escritura masiva como lo haría un índice secundario equivalente en una tabla relacional.

---

## 4. Cómo funciona el caché (Redis)

Uso **Cache-Aside Pattern** sobre el endpoint de métricas (`GET /api/dashboard/metrics`), que es el que más se consulta y el más costoso de calcular (agrega datos de Postgres, Mongo y alertas en una sola respuesta).

```
                  GET /api/dashboard/metrics
                            │
                            ▼
              ¿Existe "dashboard:metrics" en Redis?
                            │
              ┌─────────────┴─────────────┐
            SÍ (HIT)                    NO (MISS)
              │                            │
     Devuelve el JSON           Consulta en paralelo:
     cacheado de inmediato      ├─ Postgres: incidentes OPEN
     (mismo cachedAt)           ├─ Postgres: incidentes RESOLVED
              │                 ├─ Mongo: eventos agrupados por app
              │                 ├─ Mongo: eventos agrupados por severidad
              │                 └─ Mongo: últimas 10 alertas
              │                            │
              │                 Arma el JSON de métricas
              │                            │
              │                 Lo guarda en Redis con TTL = 30s
              │                            │
              └─────────────┬──────────────┘
                            ▼
                   Responde al cliente
```

¿Por qué 30 segundos de TTL? Es un balance: lo suficientemente corto para que el dashboard no muestre datos viejos por mucho tiempo si algo falla en la invalidación activa, y lo suficientemente largo para absorber ráfagas de requests sin pegarle a las 3 bases de datos en cada refresh.

Pero el TTL solo no alcanza para un dashboard que se vende como "tiempo real" — si alguien cambia el estado de un incidente, no quiero que el operador vea el número viejo durante 30 segundos. Por eso, además del TTL, hay **invalidación activa** en los tres momentos exactos donde las métricas cambian:

1. Se crea un incidente nuevo.
2. Cambia el estado de un incidente.
3. El worker de alertas termina de crear una alerta nueva.

En cualquiera de esos tres puntos se llama a un servicio compartido (`MetricsBroadcastService`) que hace tres cosas en orden: borra la clave del caché, recalcula las métricas frescas, y las empuja por WebSocket. Centralicé esto en un solo servicio en vez de repetir `redis.del(...)` suelto en tres lugares distintos, porque si mañana cambia la lógica de invalidación, la cambio en un solo punto.

```typescript
async invalidateAndBroadcast(): Promise<void> {
  await this.redis.del('dashboard:metrics');
  const freshMetrics = await this.getMetrics.execute(); // MISS limpio, recalcula
  this.gateway.emitMetricsUpdated(freshMetrics);          // empuja por socket
}
```

### Por qué Redis tiene dos roles separados

Redis no es solo caché en este proyecto — también es el broker de la cola de BullMQ. En vez de levantar dos instancias separadas (que en producción sí haría), uso una sola instancia física dividida lógicamente por número de base de datos:

- **DB 0** → caché de métricas (lo de arriba).
- **DB 1** → cola de BullMQ (procesamiento de alertas, sección 6).

Documentar esta separación importa aunque convivan en la misma instancia: es la forma correcta de razonar sobre responsabilidades distintas, y si el proyecto creciera, separar a instancias físicas (o a Redis Cluster) sería un cambio de configuración, no de arquitectura.

---

## 5. Cómo funcionan los WebSockets

El dashboard necesita reflejar tres cosas sin que el operador tenga que refrescar la página: alertas nuevas, cambios de estado de incidentes, y métricas actualizadas. Para eso hay un único `EventsGateway` (Socket.IO) que emite tres eventos distintos según qué pasó:

```
                         EventsGateway (Socket.IO)
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                           │
  alert.created            incident.updated            metrics.updated
        │                          │                           │
  Se emite cuando          Se emite cuando             Se emite cuando se
  el AlertWorker           UpdateIncidentStatus         invalida el caché
  termina de procesar      UseCase confirma una         de métricas (los 3
  una alerta                transición válida           puntos de la sección 4)
        │                          │                           │
        └──────────────────────────┴──────────────────────────┘
                                   │
                                   ▼
                    Cliente React conectado (useLiveMetrics)
                    actualiza el estado local sin hacer
                    un nuevo GET — el backend ya le mandó
                    el dato fresco
```

La secuencia real, paso a paso, cuando llega un evento crítico:

```
1. Frontend conectado al socket, escuchando los 3 eventos.

2. POST /api/events (severity: CRITICAL) llega al backend.
   → responde 201 de inmediato al sistema que mandó el evento.
   → en paralelo, encola el job de alerta.

3. AlertWorker procesa el job:
   a) guarda la alerta en Mongo
   b) gateway.emitAlertCreated(alert)
        └─► el navegador recibe 'alert.created' y agrega
            la alerta a la tabla SIN hacer ningún fetch
   c) metricsBroadcast.invalidateAndBroadcast()
        └─► el navegador recibe 'metrics.updated' y
            reemplaza los contadores del dashboard
            con los valores ya calculados por el backend
```

El detalle que vale la pena explicar: el frontend **no recalcula nada localmente**. No suma "+1 incidente abierto" en el cliente. El backend manda el bloque completo de métricas ya calculado, y el frontend simplemente lo reemplaza. Esto evita que el dashboard se desincronice si dos operadores están conectados a la vez y cada uno ve eventos en distinto orden — siempre terminan viendo el mismo número, porque el número siempre viene calculado del mismo lugar.

`useLiveMetrics` en el frontend sigue el patrón **REST primero, WebSocket después**: al montar el dashboard, hace un `GET /api/dashboard/metrics` normal para tener algo que mostrar de inmediato, y recién después abre la conexión de socket para recibir las actualizaciones incrementales. Si abriera el socket primero y dependiera solo de eso, el dashboard quedaría en blanco hasta que ocurriera el primer evento.

---

## 6. Procesamiento asíncrono de alertas

Cuando un evento llega marcado como `CRITICAL`, no genero la alerta de forma síncrona dentro del mismo request — la encolo en BullMQ (sobre Redis DB1) y la proceso en segundo plano. La razón es simple: si la generación de la alerta tardara o fallara, no quiero que eso le cueste tiempo de respuesta (ni un error 500) al sistema externo que solo está reportando un evento.

```
alertQueue.add('process-alert', payload, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },  // 1s, 2s, 4s
})
```

Si el job falla las 3 veces, no se pierde silenciosamente: se manda a una **Dead Letter Queue** (`alert-processing-failed`) para poder revisarlo después sin tener que ir a buscar en logs qué pasó. Cada paso del procesamiento queda registrado con el mismo `traceId` que llegó en el evento original, así que si alguien reporta un problema, con ese `traceId` puedo reconstruir todo el recorrido: evento → cola → alerta → WebSocket → dashboard.

---

## 7. Integración con el sistema legacy (HU5)

### El problema que resuelve esta sección

La organización tiene un sistema heredado en PHP que necesita poder ver qué incidentes están abiertos. La forma fácil (y mala) de resolver esto sería darle a ese sistema legacy acceso directo a la base de datos de Postgres. La decisión que tomé fue la contraria: **el sistema legacy es un cliente más de la API REST**, exactamente igual que el dashboard de React, solo que con su propio mecanismo de autenticación.

```
┌─────────────────┐                       ┌──────────────────────┐
│   Dashboard       │   JWT (operador)      │                       │
│   React            │ ─────────────────►   │                       │
└─────────────────┘                       │      API NestJS       │
                                            │   (la misma para      │ ───► PostgreSQL
┌─────────────────┐                       │    ambos clientes)    │      (incidents)
│  Sistema Legacy    │  x-api-key (sistema)  │                       │
│  (PHP)              │ ─────────────────►   │                       │
└─────────────────┘                       └──────────────────────┘
```

¿Por qué no le doy al script PHP un JWT como al dashboard? Porque un JWT representa la identidad de **una persona** (lleva su email, su rol). El script PHP no es una persona, es un sistema automatizado, y mezclarlo con el mecanismo de autenticación de usuarios sería forzar una abstracción que no corresponde. Si la `LEGACY_API_KEY` se filtra algún día, el daño se limita a "alguien puede leer incidentes abiertos" — no puede crear incidentes, no puede cambiar estados, no tiene ningún permiso de escritura. Es justo el principio de menor privilegio aplicado de forma simple.

### Cómo funciona, paso a paso

```
┌────────────────────────────────────────────────────────────────┐
│ 1. El script PHP arranca (manual, o disparado por un cron      │
│    en el sistema legacy real).                                 │
│                                                                  │
│ 2. Lee de variables de entorno:                                │
│      API_BASE_URL   → dónde está la API nueva                  │
│      LEGACY_API_KEY → su credencial de sistema                 │
│                                                                  │
│ 3. Arma la URL:                                                │
│      GET /api/incidents?status=OPEN&page=1&limit=20            │
│                                                                  │
│ 4. Hace la petición con cURL, mandando la cabecera:             │
│      x-api-key: <LEGACY_API_KEY>                                │
│                                                                  │
│ 5. La API valida la llave (ApiKeyGuard) →                      │
│      si no coincide: 401, el script termina con error          │
│      si coincide: 200 + JSON paginado                          │
│                                                                  │
│ 6. El script transforma la respuesta al formato mínimo que      │
│    necesita el sistema legacy: id, aplicación, severidad,       │
│    estado y fecha de creación — descarta el resto (descripción  │
│    larga, relatedEventTraceIds, etc. no le sirven al legacy).   │
│                                                                  │
│ 7. Imprime el JSON resultante por salida estándar.              │
└────────────────────────────────────────────────────────────────┘
```

Decidí no usar ningún framework PHP (Laravel, Symfony, etc.) para esto a propósito. La HU5 pide explícitamente un componente que "consulte incidentes abiertos" y "documente el mecanismo de integración" — un cliente HTTP simple con manejo de errores y paginación cumple el criterio completo. Meter un framework completo para un script de 100 líneas sería sobre-ingeniería sin ningún beneficio real, y complicaría el `docker-compose.yml` con una imagen mucho más pesada de lo necesario.

### Manejo de errores

El script no asume que la API siempre responde bien — y esto es importante porque, a diferencia del dashboard de React (donde un usuario ve el error en pantalla y reintenta), un sistema legacy corriendo en background necesita poder **detectar la falla mediante el código de salida del proceso**, no mediante una interfaz visual:

```
┌─────────────────────────┐     ┌─────────────────────────┐
│  Falla de red/timeout     │     │  API responde, pero no    │
│  (curl_errno != 0)        │     │  con 200                  │
│         │                  │     │         │                  │
│         ▼                  │     │         ▼                  │
│  Escribe el error a        │     │  Escribe el código HTTP    │
│  STDERR + imprime JSON      │     │  recibido y el cuerpo      │
│  de diagnóstico             │     │  de la respuesta a STDERR  │
│         │                  │     │         │                  │
│         ▼                  │     │         ▼                  │
│  exit(1)                   │     │  exit(1)                   │
└─────────────────────────┘     └─────────────────────────┘
```

Cualquier proceso externo que invoque este script (un cron, otro programa) puede revisar el código de salida (`echo $?` después de correrlo) para saber si la consulta fue exitosa, sin tener que parsear el contenido de la respuesta.

### Cómo correrlo

**Dentro de Docker Compose**:

```bash
docker compose run --rm php-legacy
```

Uso `run` y no `up` a propósito: este script no es un servicio de larga duración como la API o el frontend, es una tarea puntual que se ejecuta, imprime su resultado y termina. Si lo dejara como parte de `docker compose up`, el contenedor quedaría en estado "exited" apenas terminara, o reiniciando en bucle si le pongo `restart: always` — ninguna de las dos cosas tiene sentido para lo que es.

**Suelto, fuera de Docker** (si tienes PHP instalado localmente y la API corriendo en `localhost:3000`):

```bash
cd backend/legacy
API_BASE_URL=http://localhost:3000 LEGACY_API_KEY=legacy-php-dev-key-2026 php legacy-client.php
```

También acepta página y límite como argumentos posicionales:

```bash
php legacy-client.php 2 10   # página 2, 10 incidentes por página
```

### Ejemplo de salida

```json
{
    "paginacion": {
        "pagina_actual": 1,
        "total_paginas": 3,
        "total_registros": 47
    },
    "incidentes": [
        {
            "id": "a1b2c3d4-...",
            "aplicacion": "payment-service",
            "severidad": "CRITICAL",
            "estado": "OPEN",
            "creado_en": "2026-06-19T20:03:11.000Z"
        }
    ]
}
```

---

## 8. Seguridad

Hay tres mecanismos de seguridad distintos, cada uno protegiendo un actor diferente — no los puse "por las dudas", cada uno tiene una razón puntual:

- **JWT** protege los endpoints que usa el dashboard de React, donde hay un operador humano autenticado cuya identidad necesito para la auditoría (quién cambió el estado de un incidente).
- **API Key** (`x-api-key`) protege el endpoint que consume el script PHP legacy. Es un sistema, no una persona, así que no le doy un token de sesión de usuario — si esa llave se filtra, el radio de daño es menor que si se filtra un JWT con permisos de operador.
- **Throttler** protege `POST /api/events`, que es el único endpoint público sin autenticación (porque lo llaman sistemas externos arbitrarios), contra un bucle infinito o un ataque de saturación.

> **Nota sobre el endpoint `POST /auth/token`:** es un emisor de token de desarrollo (devuelve un JWT con un usuario fijo), no un login real con validación de credenciales. Está así a propósito para el alcance del reto — la integración del dashboard con un proveedor de identidad real quedaría como siguiente paso fuera de estos 4 días.

---

## 9. Instalación y ejecución

### Requisitos
- Docker y Docker Compose
- Node.js 20+ (solo si quieres correr algo fuera de los contenedores)

### Levantar todo el stack

```bash
# desde la raíz del proyecto (donde está docker-compose.yml)
cp backend/.env.example backend/.env.development   # ajusta valores si lo necesitas
docker compose up
```

Esto levanta 6 servicios: `postgres`, `mongo`, `redis`, `api` (NestJS), `frontend` (Vite) y `php-legacy`.

Para verificar que todo conectó bien:

```bash
curl http://localhost:3000/health
```

Debería responder con los tres checks (`postgres`, `mongodb`, `redis`) en estado `up`.

Para correr la consulta del sistema legacy en PHP (ver sección 7 para el detalle completo):

```bash
docker compose run --rm php-legacy
```

### Levantar el backend solo, en modo desarrollo (fuera de Docker)

```bash
cd backend
cp .env.example .env.development   # completa los valores
npm install
npm run start:dev
```

La API queda en `http://localhost:3000/api`, y Swagger en `http://localhost:3000/api/docs`.

### Reinicio limpio (sin datos previos)

```bash
docker compose down -v && docker compose up
```

---

## 10. Variables de entorno

`.env.example` es la plantilla que sí se sube al repo (a diferencia de `.env.development`, que está en `.gitignore` porque ahí van credenciales). Cualquiera que clone el proyecto hace:

```bash
cp backend/.env.example backend/.env.development
cp frontend/.env.example frontend/.env
```

y el proyecto levanta sin tener que inventar ni pedir ningún valor — los datos de `.env.example` ya coinciden exactamente con los que usa `docker-compose.yml` (mismo usuario de Postgres, mismo nombre de base, mismos puertos). No son placeholders genéricos tipo `<TU_CLAVE_AQUI>`; son los valores reales con los que el proyecto funciona en local, porque para una prueba técnica no tiene sentido esconder un secreto que de todas formas necesita el evaluador para correr el repo.

`ConfigModule` valida estas variables al arrancar con un schema de Joi — si falta una requerida, la aplicación ni siquiera levanta. Prefiero que falle de entrada con un mensaje claro de "te falta esta variable", a que falle más adelante con un error críptico de conexión a la base de datos.

Un detalle a tener en cuenta con `POSTGRES_HOST`, `MONGO_URI` y `REDIS_HOST`: el valor depende de **dónde corre el backend**. Si lo corres con `npm run start:dev` en tu máquina mientras las bases de datos están en contenedores, el host es `localhost`. Si el backend también corre dentro de `docker-compose` (el servicio `api`), el host pasa a ser el nombre del servicio (`postgres`, `mongo`, `redis`), porque dentro de la red interna de Docker los contenedores se resuelven por nombre, no por `localhost`. El `.env.example` trae comentado este detalle para no tener que adivinarlo.

Ver `backend/.env.example` para la lista completa con comentarios sobre qué hace cada variable, `backend/.env.test` para los valores que usa la suite de pruebas (bases y números de Redis separados de development, para no pisar datos), y `frontend/.env.example` para las del cliente.

---

## 11. Pruebas

```bash
npm run test        # unitarias
npm run test:e2e     # integración (supertest, requiere las bases levantadas)
npm run test:cov     # con reporte de cobertura
```

Las pruebas unitarias cubren reglas de dominio puras (transiciones de `IncidentStatus`) y casos de uso con repositorios mockeados (qué pasa cuando un evento es `CRITICAL` vs `LOW`, qué pasa cuando una transición de estado es inválida). Las de integración usan `supertest` contra la app real, levantando las bases de datos configuradas en `.env.test`.

---

## 12. Documentación de la API

Con el backend corriendo: `http://localhost:3000/api/docs`

Los tres endpoints más relevantes del flujo (`POST /events`, `POST /incidents`, `PATCH /incidents/:id/status`) tienen ejemplos de payload completos en Swagger. El resto de endpoints están documentados con su resumen y los códigos de respuesta posibles.

---

## 13. Decisiones que quedaron pendientes / fuera de alcance

Para ser transparente sobre el estado real del proyecto:

- No hay migraciones de TypeORM generadas como archivos — el esquema se crea actualmente a través de `infra/init.sql` montado en el contenedor de Postgres en el primer arranque.


