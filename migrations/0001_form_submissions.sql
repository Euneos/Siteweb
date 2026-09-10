-- Technical receipt only: no names, emails or submitted answers.
CREATE TABLE IF NOT EXISTS form_submissions (
  submission_key TEXT PRIMARY KEY,
  form_type TEXT NOT NULL CHECK (form_type IN ('etablissement', 'formateur')),
  cohort_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'complete', 'review')),
  phase TEXT NOT NULL,
  parent_id INTEGER,
  record_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS form_submissions_state ON form_submissions(state, updated_at);
