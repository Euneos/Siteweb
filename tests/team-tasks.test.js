import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { listTasks, parseTask, saveTask } from '../src/lib/team-tasks'

const connections = []
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
      prepare: (query) => ({
        bind: (...values) => ({
          all: async () => ({ results: sql.query(query).all(...values) }),
          first: async () => sql.query(query).get(...values),
          run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
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
