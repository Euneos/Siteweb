-- Newsletter event facts and human decisions are separate. Imports never update decisions.
CREATE TABLE event_agenda (
 id TEXT PRIMARY KEY,
 dedup_key TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL,
 organizer TEXT NOT NULL,
 starts_on TEXT NOT NULL,
 city TEXT NOT NULL DEFAULT '',
 region TEXT NOT NULL CHECK(region IN ('Île-de-France','Occitanie','En ligne')),
 modality TEXT NOT NULL CHECK(modality IN ('présentiel','en ligne')),
 access TEXT NOT NULL DEFAULT '' CHECK(access IN ('','gratuit','payant','sur invitation')),
 pillars_json TEXT NOT NULL,
 interest TEXT NOT NULL,
 registration_url TEXT NOT NULL DEFAULT '',
 sources_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'à décider' CHECK(status IN ('à décider','confirmé','rejeté')),
 attendance_json TEXT NOT NULL DEFAULT '[]',
 version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 decision_by TEXT NOT NULL DEFAULT '',
 decision_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX event_agenda_date ON event_agenda(starts_on);
CREATE TABLE event_agenda_sync_runs (
 id TEXT PRIMARY KEY,
 checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 window_start TEXT NOT NULL DEFAULT '',
 window_end TEXT NOT NULL DEFAULT '',
 newsletters_count INTEGER,
 events_count INTEGER NOT NULL
);
ALTER TABLE event_agenda ADD COLUMN deleted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE event_agenda ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
CREATE TABLE event_agenda_reminders (
 reminder_date TEXT PRIMARY KEY,
 state TEXT NOT NULL CHECK(state IN ('sending','sent','uncertain')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
