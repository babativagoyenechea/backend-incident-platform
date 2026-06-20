-- Tipos enumerados — validación rígida a nivel de motor de datos.
-- Refuerzan en la base de datos la misma regla que ya vive en el dominio,
-- asegurando que el dato no se corrompa si se escribe fuera de la API[cite: 150].
CREATE TYPE incident_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
CREATE TYPE severity_level  AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- Tabla principal de incidentes (HU2) [cite: 152]
CREATE TABLE incidents (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   VARCHAR(255) NOT NULL,
  description             TEXT,
  affected_app            VARCHAR(100) NOT NULL,
  severity                severity_level NOT NULL,
  status                  incident_status NOT NULL DEFAULT 'OPEN',
  assignee                VARCHAR(150),
  -- ARRAY nativo de Postgres, coincide con el ORM mapeando array: true[cite: 166, 168].
  -- Mantiene un acoplamiento intencionalmente débil con los documentos de MongoDB[cite: 153].
  related_event_trace_ids TEXT[], 
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

-- Índices de optimización para búsquedas y filtros del Dashboard (HU4) [cite: 155, 156]
CREATE INDEX idx_incidents_status   ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_app      ON incidents(affected_app);
CREATE INDEX idx_incidents_created  ON incidents(created_at DESC);

-- Auditoría inmutable — un registro por cada cambio de estado (Append-only) 
-- Se omite el CASCADE de forma intencional para salvaguardar el rastro histórico.
CREATE TABLE incident_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID NOT NULL REFERENCES incidents(id), -- Integridad referencial estricta 
  old_status   incident_status NOT NULL,
  new_status   incident_status NOT NULL,
  changed_by   VARCHAR(150),
  trace_id     VARCHAR(36),
  changed_at   TIMESTAMP DEFAULT NOW()
);

-- Índices esenciales para la agregación de métricas rápidas y ordenación cronológica [cite: 158]
CREATE INDEX idx_audit_incident_id ON incident_audit(incident_id);
CREATE INDEX idx_audit_changed_at  ON incident_audit(changed_at DESC);