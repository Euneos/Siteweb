-- Anonymous public map projection only; no dossier IDs, names of people or contacts.
-- One shared refresh lease prevents public visits from exhausting NocoDB's rate limit.
CREATE TABLE public_network_snapshots (
  id TEXT PRIMARY KEY CHECK (id = 'network-v1'),
  payload TEXT CHECK (payload IS NULL OR (json_valid(payload) AND length(payload) <= 1000000)),
  refreshed_at INTEGER NOT NULL DEFAULT 0 CHECK (refreshed_at >= 0),
  lease_until INTEGER NOT NULL DEFAULT 0 CHECK (lease_until >= 0),
  lease_token TEXT
);
