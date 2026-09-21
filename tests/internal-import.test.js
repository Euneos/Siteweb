import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { importWorkspaceSnapshot } from '../scripts/lib/workspace-import'
const opened = []
const fixture = () => {
  const db = new Database(':memory:')
  opened.push(db)
  db.exec(
    readFileSync(new URL('../migrations/interne/0001_workspace.sql', import.meta.url), 'utf8'),
  )
  return db
}
afterEach(() => opened.splice(0).forEach((db) => db.close()))
const row = (sourceId = 'notion-page-1') => ({
  sourceId,
  author: 'Équipe partagée (Notion)',
  createdAt: '2026-09-01T10:00:00Z',
  entry: {
    kind: 'editorial',
    title: 'Présentation du programme',
    starts_on: '2026-09-10',
    ends_on: '2026-09-10',
    person: 'member@example.test',
    activity: 'Lancement',
    channel: 'LinkedIn',
    status: 'a_valider',
    hours: null,
    notes: '',
    content: 'Texte à relire',
    link: 'https://www.notion.so/example',
  },
  original: { Lieu: 'Lyon', Plafond: 100 },
  comments: [
    {
      sourceId: 'notion-comment-1',
      author: 'EUNEOS TEAM (Notion)',
      content: 'Auteur individuel non identifié',
      createdAt: '2026-09-02T10:00:00Z',
    },
  ],
})
const snapshot = (entries = [row()]) => ({
  schemaVersion: 1,
  exportedAt: '2026-09-17T12:00:00Z',
  entries,
})
test('préserve dates, attribution collective et champs non mappés, réimport idempotent', () => {
  const db = fixture(),
    data = snapshot()
  expect(importWorkspaceSnapshot(db, data)).toEqual({
    entries: 1,
    inserted: 1,
    skipped: 0,
    comments: 1,
  })
  const saved = db.query('SELECT * FROM workspace_entries').get()
  expect(JSON.parse(saved.source_payload).original.Plafond).toBe(100)
  expect(saved.created_by).toBe('Équipe partagée (Notion)')
  expect(saved.created_at).toBe('2026-09-01T10:00:00Z')
  db.query("UPDATE workspace_entries SET title='Modification locale',version=2").run()
  expect(importWorkspaceSnapshot(db, data).skipped).toBe(1)
  expect(db.query('SELECT title FROM workspace_entries').get().title).toBe('Modification locale')
  expect(db.query('SELECT author FROM workspace_comments').get().author).toBe(
    'EUNEOS TEAM (Notion)',
  )
})
test('annule tout le lot si une source existante a changé', () => {
  const db = fixture()
  importWorkspaceSnapshot(db, snapshot())
  const changed = row()
  changed.entry.title = 'Source modifiée'
  const extra = row('notion-page-2')
  extra.comments = []
  expect(() => importWorkspaceSnapshot(db, snapshot([extra, changed]))).toThrow('Source changed')
  expect(db.query('SELECT count(*) n FROM workspace_entries').get().n).toBe(1)
})
test('refuse les doublons et les commentaires non vérifiés avant toute écriture', () => {
  const db = fixture()
  expect(() => importWorkspaceSnapshot(db, snapshot([row(), row()]))).toThrow('Duplicate')
  const missing = row()
  delete missing.comments
  expect(() => importWorkspaceSnapshot(db, snapshot([missing]))).toThrow('explicitly supplied')
  expect(db.query('SELECT count(*) n FROM workspace_entries').get().n).toBe(0)
})
