-- Private technical state, not questionnaire answers. Never expire a writing marker.
CREATE TABLE IF NOT EXISTS public_postformation_projections (
  receipt TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  code TEXT NOT NULL DEFAULT 'projection_pending',
  plan TEXT,
  owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  adult_id INTEGER,
  participation_id INTEGER,
  received_date TEXT
);
CREATE TABLE IF NOT EXISTS public_postformation_claims (
  identity_key TEXT PRIMARY KEY,
  receipt TEXT NOT NULL
);
