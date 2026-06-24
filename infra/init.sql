-- Los tipos enumerados refuerzan en la base de datos las mismas restricciones
-- que viven en el dominio, evitando estados inválidos si se escribe fuera de la API.
CREATE TYPE incident_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
CREATE TYPE severity_level  AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- Tabla principal de incidentes (HU2)
CREATE TABLE incidents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   VARCHAR(255) NOT NULL,
  description             TEXT,
  affected_app            VARCHAR(100) NOT NULL,
  severity                severity_level NOT NULL,
  status                  incident_status NOT NULL DEFAULT 'OPEN',
  assignee                VARCHAR(150),
  -- Almacena los traceIds de eventos relacionados como array nativo de Postgres.
  -- Mantiene un acoplamiento débil con los documentos de MongoDB.
  related_event_trace_ids TEXT[],
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

-- Índices para las consultas de filtrado del Dashboard (HU4)
CREATE INDEX idx_incidents_status   ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_app      ON incidents(affected_app);
CREATE INDEX idx_incidents_created  ON incidents(created_at DESC);

-- Auditoría inmutable: un registro por cada cambio de estado (append-only).
-- Se omite el CASCADE de forma intencional para preservar el rastro histórico
-- incluso si el incidente fuera eliminado.
CREATE TABLE incident_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID NOT NULL REFERENCES incidents(id),
  old_status   incident_status NOT NULL,
  new_status   incident_status NOT NULL,
  changed_by   VARCHAR(150),
  trace_id     VARCHAR(36),
  changed_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_incident_id ON incident_audit(incident_id);
CREATE INDEX idx_audit_changed_at  ON incident_audit(changed_at DESC);