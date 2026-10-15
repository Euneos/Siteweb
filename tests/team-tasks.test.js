import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { listTasks, parseTask, saveTask } from '../src/lib/team-tasks'
import { notifyTaskAssignment } from '../src/lib/team-task-notifications'

const connections = []
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
afterEach(() => connections.splice(0).forEach((db) => db.close()))
function fixture() {
  const sql = new Database(':memory:')
  connections.push(sql)
  const directory = new URL('../migrations/interne/', import.meta.url)
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sql.transaction(() => sql.exec(readFileSync(new URL(file, directory), 'utf8')))()
  return {
    sql,
    db: {
      batch: async (statements) =>
        sql.transaction(() => statements.map((statement) => statement.runSync()))(),
      prepare: (query) => ({
        bind: (...values) => ({
          all: async () => ({ results: sql.query(query).all(...values) }),
          first: async () => sql.query(query).get(...values),
          run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
          runSync: () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
        }),
      }),
    },
  }
}
const actor = { email: 'member@example.test', admin: false }
const task = {
  title: 'Préparer la réunion',
  description: 'Points à aborder',
  person: 'Charlotte',
  status: 'en-attente',
}

test('une tâche est partagée et déplaçable sans écraser une modification concurrente', async () => {
  const { db, sql } = fixture()
  const id = crypto.randomUUID()
  expect(await saveTask(db, actor, id, task)).toMatchObject({ ...task, id, version: 1 })
  const moved = { ...task, person: 'Pauline', status: 'today' }
  await saveTask(db, { email: 'other@example.test', admin: false }, id, moved, 1)
  await expect(saveTask(db, actor, id, task, 1)).rejects.toMatchObject({ status: 409 })
  expect(await listTasks(db)).toMatchObject([{ ...moved, version: 2 }])
  expect(sql.query('SELECT created_by, updated_by FROM team_tasks').get()).toEqual({
    created_by: actor.email,
    updated_by: 'other@example.test',
  })
})

test('une création répétée ne crée pas de doublon et ne remplace pas la tâche', async () => {
  const { db } = fixture()
  const id = crypto.randomUUID()
  await saveTask(db, actor, id, task)
  await expect(saveTask(db, actor, id, { ...task, title: 'Autre' })).rejects.toMatchObject({
    status: 409,
  })
  expect(await listTasks(db)).toMatchObject([{ ...task, version: 1 }])
})

test('les champs et les contraintes SQL refusent les valeurs non prévues', async () => {
  const { db, sql } = fixture()
  for (const invalid of [
    { title: '' },
    { title: 'a'.repeat(181) },
    { description: 'a'.repeat(4001) },
    { person: 'Inconnu' },
    { status: 'termine' },
  ])
    expect(() => parseTask({ ...task, ...invalid })).toThrow()
  const id = crypto.randomUUID()
  await saveTask(db, actor, id, task)
  expect(() => sql.query("UPDATE team_tasks SET status = 'invalide'").run()).toThrow()
  await expect(saveTask(db, actor, id, task, 0)).rejects.toMatchObject({ status: 400 })
  expect(sql.query('PRAGMA integrity_check').get().integrity_check).toBe('ok')
})

test('une notification par attribution, destinataire contrôlé et contenu figé', async () => {
  const { db, sql } = fixture()
  const id = crypto.randomUUID()
  const sent = []
  globalThis.fetch = async (url, options) => {
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    sent.push(JSON.parse(options.body))
    return new Response('{}', { status: 201 })
  }
  const env = { BREVO_API_KEY: 'fictitious' }
  const notify = (version) => notifyTaskAssignment(db, env, id, version, 'https://euneos.fr')
  await saveTask(db, actor, id, task)
  await saveTask(db, actor, id, { ...task, title: 'Titre corrigé', status: 'today' }, 1)
  expect(await notify(2)).toBe('none')
  expect(await notify(1)).toBe('sent')
  await notify(1)
  expect(sent).toHaveLength(1)
  expect(sent[0].to).toEqual([{ email: 'charlotte@euneos.fr' }])
  expect(sent[0].textContent).toContain(task.title)
  expect(sent[0].textContent).not.toContain('Titre corrigé')
  await saveTask(db, actor, id, { ...task, person: 'Pauline' }, 2)
  const results = await Promise.all([notify(3), notify(3)])
  expect(results.filter((state) => state === 'sent')).toHaveLength(1)
  expect(sent).toHaveLength(2)
  expect(sent[1].to).toEqual([{ email: 'pauline@euneos.fr' }])
  expect(
    sql.query('SELECT state FROM team_task_notifications ORDER BY task_version').all(),
  ).toEqual([{ state: 'sent' }, { state: 'sent' }])
})

test('aucun envoi en preview, en local ou sans configuration, ni nouvelle tentative après timeout', async () => {
  const { db, sql } = fixture()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    throw new Error('Timeout')
  }
  for (const [env, origin, expected] of [
    [{ BREVO_API_KEY: 'fictitious' }, 'http://localhost:4321', 'preview'],
    [
      { BREVO_API_KEY: 'fictitious', INTERNAL_WORKSPACE_PREVIEW: 'true' },
      'https://euneos.fr',
      'preview',
    ],
    [{}, 'https://euneos.fr', 'unavailable'],
    [{ BREVO_API_KEY: 'fictitious' }, 'https://euneos.fr', 'uncertain'],
  ]) {
    const id = crypto.randomUUID()
    await saveTask(db, actor, id, task)
    expect(await notifyTaskAssignment(db, env, id, 1, origin)).toBe(expected)
    await notifyTaskAssignment(db, env, id, 1, origin)
    expect(
      sql.query('SELECT state FROM team_task_notifications WHERE task_id = ?').get(id).state,
    ).toBe(expected)
  }
  expect(calls).toBe(1)
  expect(await listTasks(db)).toHaveLength(4)
})

test('l’historique reste intact et les tâches existantes ne déclenchent aucun email rétroactif', () => {
  const sql = new Database(':memory:')
  connections.push(sql)
  sql.exec(
    readFileSync(new URL('../migrations/interne/0007_team_tasks.sql', import.meta.url), 'utf8'),
  )
  sql.exec(
    "INSERT INTO team_tasks VALUES ('old', 'Existante', '', 'Candice', 'today', 'member@example.test', 'member@example.test', '2026-10-01', '2026-10-01', 1)",
  )
  const before = sql.query('SELECT * FROM team_tasks').all()
  sql.exec(
    readFileSync(
      new URL('../migrations/interne/0008_team_task_notifications.sql', import.meta.url),
      'utf8',
    ),
  )
  expect(sql.query('SELECT * FROM team_tasks').all()).toEqual(before)
  expect(sql.query('SELECT * FROM team_task_notifications').all()).toEqual([])
})

test('un échec du journal annule la création et un conflit ne crée pas de notification', async () => {
  const { db, sql } = fixture()
  const id = crypto.randomUUID()
  await saveTask(db, actor, id, task)
  await saveTask(db, actor, id, { ...task, person: 'Pauline' }, 1)
  await expect(saveTask(db, actor, id, { ...task, person: 'Candice' }, 1)).rejects.toMatchObject({
    status: 409,
  })
  expect(
    sql.query('SELECT person FROM team_task_notifications ORDER BY task_version').all(),
  ).toEqual([{ person: 'Charlotte' }, { person: 'Pauline' }])
  sql.exec('DROP TABLE team_task_notifications')
  await expect(saveTask(db, actor, crypto.randomUUID(), task)).rejects.toThrow()
  expect(await listTasks(db)).toHaveLength(1)
})
