-- Access receipts only. No names, email addresses, answers or raw bearer links.
CREATE TABLE IF NOT EXISTS operational_links (
  token_hash TEXT PRIMARY KEY,
  target_id INTEGER NOT NULL,
  school_id INTEGER NOT NULL,
  cohort_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('contact','deploiement','participants')),
  issuer_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS operational_link_slots (
  target_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('contact','deploiement','participants')),
  token_hash TEXT NOT NULL,
  PRIMARY KEY(target_id,kind)
);
CREATE TABLE IF NOT EXISTS operational_mail_receipts (
  link_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('sending','sent','unavailable','uncertain')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
