CREATE TABLE recruitment_contacts (
  id TEXT PRIMARY KEY,
  establishment TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address_type TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  sent_on TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT 'Non vérifiée',
  status TEXT NOT NULL DEFAULT 'En attente de retour'
    CHECK(status IN ('À contacter','À rappeler','Brochure à envoyer','En attente de retour','Intéressé','Non intéressé')),
  last_contact_on TEXT NOT NULL DEFAULT '',
  call_report TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  follow_up_on TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  vigilance TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT NOT NULL
);
CREATE INDEX recruitment_follow_up ON recruitment_contacts(follow_up_on, sent_on);
