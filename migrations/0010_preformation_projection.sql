-- Site receipt/projection durability. No real source IDs or private mapping.
CREATE TABLE IF NOT EXISTS public_preformation_projections (
  receipt TEXT PRIMARY KEY REFERENCES public_form_receipts(receipt),
  received_at TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  code TEXT NOT NULL DEFAULT 'projection_pending',
  plan TEXT,
  owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  adult_id INTEGER,
  participation_id INTEGER,
  date_pre TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public_preformation_person_claims (
  identity_key TEXT PRIMARY KEY,
  receipt TEXT NOT NULL REFERENCES public_form_receipts(receipt)
);
