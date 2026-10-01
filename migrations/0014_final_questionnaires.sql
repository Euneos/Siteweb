-- FORM_SUBMISSIONS: immutable source and verified evaluation/school-report receipt proof.
CREATE TABLE IF NOT EXISTS public_final_questionnaire_projections (
 receipt TEXT PRIMARY KEY REFERENCES public_form_receipts(receipt), received_at TEXT NOT NULL,
 config_digest TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
 code TEXT NOT NULL DEFAULT 'projection_pending', plan TEXT, owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 person_id INTEGER, participation_id INTEGER, target_id INTEGER, fields_json TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public_final_questionnaire_claims (
 identity_key TEXT PRIMARY KEY, receipt TEXT NOT NULL REFERENCES public_form_receipts(receipt)
);
