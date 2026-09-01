-- CF86: Persist the difference between a stored API key and a verified provider connection.
CREATE TABLE preview_ai_provider_health (
  organization_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL CHECK (owner_scope IN ('ORGANIZATION','USER')),
  owner_id TEXT NOT NULL,
  provider_kind TEXT NOT NULL CHECK (provider_kind IN ('OPENAI','ANTHROPIC','GEMINI')),
  model_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UNCHECKED','HEALTHY','FAILED')),
  latency_ms INTEGER,
  failure_code TEXT,
  provider_status INTEGER,
  checked_by TEXT,
  checked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,owner_scope,owner_id,provider_kind),
  CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK (provider_status IS NULL OR provider_status BETWEEN 100 AND 599),
  FOREIGN KEY (checked_by) REFERENCES preview_users(id)
);

CREATE INDEX idx_preview_ai_provider_health_status
  ON preview_ai_provider_health(organization_id,status,checked_at);
