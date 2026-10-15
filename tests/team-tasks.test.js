import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { listTasks, parseTask, saveTask } from '../src/lib/team-tasks'
import { notifyTaskAssignment } from '../src/lib/team-task-notifications'
import { moveTask } from '../src/lib/task-movement'

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
  expect(results).toContain('sent')
  expect(sent).toHaveLength(3)
  expect(sent[1].to).toEqual([{ email: 'pauline@euneos.fr' }])
  expect(sent[2].to).toEqual([{ email: 'charlotte@euneos.fr' }])
  expect(sent[2].textContent).toContain('Vous n’êtes plus responsable')
  expect(sent[2].textContent).toContain('Pauline')
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

test('contributeurs : une seule tâche, validation et conservation par un ancien client', async () => {
  const { db, sql } = fixture()
  const id = crypto.randomUUID()
  await saveTask(db, actor, id, { ...task, contributors: ['Pauline', 'Candice'] })
  expect(await listTasks(db)).toMatchObject([{ id, contributors: ['Candice', 'Pauline'] }])
  for (const contributors of [null, 'Pauline', ['Inconnu'], ['Pauline', 'Pauline'], ['Charlotte']])
    expect(() => parseTask({ ...task, contributors })).toThrow()
  await saveTask(db, actor, id, { ...task, status: 'today' }, 1)
  expect((await listTasks(db))[0].contributors).toEqual(['Candice', 'Pauline'])
  await saveTask(db, actor, id, { ...task, person: 'Pauline' }, 2)
  expect((await listTasks(db))[0]).toMatchObject({ person: 'Pauline', contributors: ['Candice'] })
  await saveTask(db, actor, id, { ...task, person: 'Pauline', contributors: [] }, 3)
  expect(await listTasks(db)).toHaveLength(1)
  expect((await listTasks(db))[0].contributors).toEqual([])
  expect(sql.query('SELECT count(*) n FROM team_task_notifications').get().n).toBe(2)
})

test('déplacement : rôles conservés, promotion et statut commun', () => {
  const shared = { ...task, contributors: ['Pauline'] }
  expect(moveTask(shared, 'Charlotte', 'Pauline', 'today')).toMatchObject({
    person: 'Pauline',
    contributors: [],
    status: 'today',
  })
  expect(moveTask(shared, 'Pauline', 'Candice', 'today')).toMatchObject({
    person: 'Charlotte',
    contributors: ['Candice'],
    status: 'today',
  })
  expect(moveTask(shared, 'Pauline', 'Pauline', 'today')).toMatchObject({
    person: 'Charlotte',
    contributors: ['Pauline'],
    status: 'today',
  })
  expect(() => moveTask(shared, 'Pauline', 'Charlotte', 'today')).toThrow('participe déjà')
  expect(shared).toMatchObject({
    person: 'Charlotte',
    contributors: ['Pauline'],
    status: 'en-attente',
  })
})

test('une erreur pour un destinataire ne bloque pas l’autre et ne provoque aucun renvoi', async () => {
  const { db, sql } = fixture()
  const id = crypto.randomUUID()
  await saveTask(db, actor, id, task)
  await saveTask(db, actor, id, { ...task, person: 'Pauline', contributors: ['Charlotte'] }, 1)
  const sends = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    sends.push(body)
    if (body.to[0].email === 'pauline@euneos.fr') throw new Error('Timeout')
    return new Response('{}', { status: 201 })
  }
  const env = { BREVO_API_KEY: 'fake' }
  expect(await notifyTaskAssignment(db, env, id, 2, 'https://euneos.fr')).toBe('uncertain')
  await notifyTaskAssignment(db, env, id, 2, 'https://euneos.fr')
  expect(sends).toHaveLength(2)
  expect(sends.find((body) => body.to[0].email === 'charlotte@euneos.fr').textContent).toContain(
    'Vous restez contributeur',
  )
  expect(
    sql
      .query('SELECT state, previous_state FROM team_task_notifications WHERE task_version=2')
      .get(),
  ).toEqual({ state: 'uncertain', previous_state: 'sent' })
})

test('la migration des rôles préserve les tâches et les reçus historiques', () => {
  const sql = new Database(':memory:')
  connections.push(sql)
  for (const file of ['0007_team_tasks.sql', '0008_team_task_notifications.sql'])
    sql.exec(readFileSync(new URL('../migrations/interne/' + file, import.meta.url), 'utf8'))
  sql.exec(
    "INSERT INTO team_tasks VALUES ('old', 'Existante', '', 'Candice', 'today', 'member@example.test', 'member@example.test', '2026-10-01', '2026-10-01', 5)",
  )
  sql.exec(
    "INSERT INTO team_task_notifications(task_id,task_version,person,title,description,task_status,assigned_by,state) VALUES ('old',5,'Candice','Existante','','today','member@example.test','sent')",
  )
  sql.exec(
    readFileSync(
      new URL('../migrations/interne/0010_team_task_roles.sql', import.meta.url),
      'utf8',
    ),
  )
  expect(sql.query('SELECT person,contributors,version FROM team_tasks').get()).toEqual({
    person: 'Candice',
    contributors: '[]',
    version: 5,
  })
  expect(sql.query('SELECT state,previous_person FROM team_task_notifications').get()).toEqual({
    state: 'sent',
    previous_person: '',
  })
})

test('priorité, échéance et blocage sont indépendants de l’avancement et conservés par les anciens clients', async () => {
  const { db } = fixture()
  const id = crypto.randomUUID()
  const planning = {
    priority: true,
    due_on: '2028-02-29',
    blocked: true,
    blocker: 'Attente du proviseur',
  }
  await saveTask(db, actor, id, { ...task, ...planning })
  await saveTask(db, actor, id, { ...task, status: 'today' }, 1)
  expect((await listTasks(db))[0]).toMatchObject({ ...planning, status: 'today' })
  for (const invalid of [
    { due_on: '2027-02-29' },
    { due_on: '2026-13-01' },
    { priority: 'true' },
    { blocked: true, blocker: '' },
    { archived: true },
  ])
    expect(() => parseTask({ ...task, ...invalid })).toThrow()
})

test('terminer, archiver, retrouver et rouvrir une tâche conserve une seule fiche et son historique', async () => {
  const { db, sql } = fixture()
  const id = crypto.randomUUID()
  await saveTask(db, actor, id, { ...task, contributors: ['Pauline'], priority: true })
  const completed = await saveTask(db, actor, id, { ...task, status: 'terminee' }, 1)
  expect(completed.completed_at).not.toBe('')
  expect(completed).toMatchObject({
    status: 'terminee',
    archived: false,
    contributors: ['Pauline'],
    priority: true,
  })
  const archived = await saveTask(db, actor, id, { ...task, status: 'terminee', archived: true }, 2)
  expect(archived).toMatchObject({ archived: true, completed_at: completed.completed_at })
  expect(archived.archived_at).not.toBe('')
  expect(await listTasks(db)).toHaveLength(1)
  const reopened = await saveTask(
    db,
    actor,
    id,
    { ...task, status: 'en-cours', archived: false },
    3,
  )
  expect(reopened).toMatchObject({
    status: 'en-cours',
    archived: false,
    completed_at: '',
    archived_at: '',
    contributors: ['Pauline'],
  })
  expect(sql.query('SELECT count(*) n FROM team_task_notifications').get().n).toBe(1)
  expect(reopened.created_at).toBe(completed.created_at)
})
