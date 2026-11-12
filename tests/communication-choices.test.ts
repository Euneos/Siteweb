import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import {
  readChoices,
  mutateChoice,
  resolveCells,
  effectiveChoiceCells,
} from '../src/lib/communication-choices'
import { mutateCommunicationRows } from '../src/lib/communication-bulk'
function fixture() {
  const sql = new Database(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const f of readdirSync('migrations/interne')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sql.exec(readFileSync('migrations/interne/' + f, 'utf8'))
  const db: any = {
    prepare: (query: string) => ({
      bind: (...values: any[]) => ({
        all: async () => ({ results: sql.query(query).all(...values) }),
        first: async () => sql.query(query).get(...values),
        run: async () => {
          sql.query(query).run(...values)
          return { meta: { changes: (sql.query('SELECT changes() n').get() as any).n } }
        },
      }),
    }),
  }
  sql
    .query('INSERT INTO communication_sheets VALUES(?,?,?,?,?,?)')
    .run('s', 'partenariats', 'Parrainage', '["Nom","Statut","Priorité","Notes"]', 0, 0)
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const id of ids)
    sql
      .query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)')
      .run(id, 's', '["Personne","En attente de réponse","A","Note source"]', 'fixture')
  return { sql, db, ids }
}
test('renamed status retains role, existing fiches, color identity and twenty-day follow-up', async () => {
  const { db, sql, ids } = fixture()
  try {
    let catalog = await readChoices(db, 'partenariats'),
      waiting = catalog.choices.find((c) => c.role === 'waiting')!
    await mutateChoice(db, 'partenariats', {
      choiceAction: 'rename',
      column: 'Statut',
      choiceId: waiting.id,
      version: waiting.version,
      value: 'Attente de retour',
    })
    catalog = await readChoices(db, 'partenariats')
    expect(resolveCells(['En attente de réponse'], ['Statut'], 'partenariats', catalog)).toEqual([
      'Attente de retour',
    ])
    expect(
      effectiveChoiceCells(
        ['En attente de réponse'],
        ['Statut'],
        'partenariats',
        catalog,
        '2026-01-01T00:00:00Z',
        Date.parse('2026-01-21T00:00:00Z'),
      ),
    ).toEqual(['À relancer'])
    sql.query('UPDATE communication_rows SET status_changed_at=?').run('2026-01-01T00:00:00Z')
    sql
      .query('UPDATE communication_rows SET cells_json=? WHERE id=?')
      .run('["Personne","Attente de retour","A","Autre note"]', ids[0])
    expect(
      (sql.query('SELECT status_changed_at FROM communication_rows WHERE id=?').get(ids[0]) as any)
        .status_changed_at,
    ).toBe('2026-01-01T00:00:00Z')
    await expect(
      mutateChoice(db, 'partenariats', {
        choiceAction: 'rename',
        column: 'Statut',
        choiceId: waiting.id,
        version: waiting.version,
        value: 'Écrasement',
      }),
    ).rejects.toThrow('déjà changé')
    expect(
      (await readChoices(db, 'suivimedias')).choices.find((c) => c.id === waiting.id)?.value,
    ).toBe('Attente de retour')
  } finally {
    sql.close()
  }
})
test('menu additions persist without a fiche; deleted values can be restored without deleting fiche data', async () => {
  const { db, sql } = fixture()
  try {
    const id = await mutateChoice(db, 'veille', {
      choiceAction: 'add',
      column: 'Tags',
      value: 'Éducation',
    })
    let catalog = await readChoices(db, 'veille'),
      choice = catalog.choices.find((c) => c.id === id)!
    await mutateChoice(db, 'veille', {
      choiceAction: 'rename',
      column: 'Tags',
      choiceId: id,
      version: choice.version,
      value: 'Apprentissage',
    })
    catalog = await readChoices(db, 'veille')
    expect(resolveCells(['Éducation, Éducation'], ['Tags'], 'veille', catalog)).toEqual([
      'Apprentissage',
    ])
    choice = catalog.choices.find((c) => c.id === id)!
    await mutateChoice(db, 'veille', {
      choiceAction: 'delete',
      column: 'Tags',
      choiceId: id,
      version: choice.version,
    })
    catalog = await readChoices(db, 'veille')
    expect(resolveCells(['Éducation'], ['Tags'], 'veille', catalog)).toEqual([''])
    expect(() => resolveCells(['Éducation'], ['Tags'], 'veille', catalog, true)).toThrow('a changé')
    expect(
      await mutateChoice(db, 'veille', {
        choiceAction: 'add',
        column: 'Tags',
        value: 'Apprentissage',
      }),
    ).toBe(id)
    expect(
      resolveCells(['Éducation'], ['Tags'], 'veille', await readChoices(db, 'veille')),
    ).toEqual(['Apprentissage'])
    expect((sql.query('SELECT count(*) n FROM communication_rows').get() as any).n).toBe(2)
  } finally {
    sql.close()
  }
})
test('bulk duplication, trash and restore are all-or-nothing and version guarded', async () => {
  const { db, sql, ids } = fixture()
  try {
    const picked = ids.map((id) => ({ id, version: 1 }))
    expect(
      await mutateCommunicationRows(
        db,
        'partenariats',
        { bulkAction: 'duplicate', rows: picked },
        'actor',
      ),
    ).toBe(2)
    expect((sql.query('SELECT count(*) n FROM communication_rows').get() as any).n).toBe(4)
    await expect(
      mutateCommunicationRows(
        db,
        'partenariats',
        { bulkAction: 'delete', rows: [picked[0], { ...picked[1], version: 42 }] },
        'actor',
      ),
    ).rejects.toThrow('aucune action partielle')
    expect(
      (
        sql
          .query('SELECT count(*) n FROM communication_rows WHERE deleted_at IS NOT NULL')
          .get() as any
      ).n,
    ).toBe(0)
    expect(
      await mutateCommunicationRows(
        db,
        'partenariats',
        { bulkAction: 'delete', rows: picked },
        'actor',
      ),
    ).toBe(2)
    expect(
      (
        sql
          .query('SELECT count(*) n FROM communication_rows WHERE deleted_at IS NOT NULL')
          .get() as any
      ).n,
    ).toBe(2)
    await expect(
      mutateCommunicationRows(
        db,
        'veille',
        { bulkAction: 'restore', rows: ids.map((id) => ({ id, version: 2 })) },
        'actor',
      ),
    ).rejects.toThrow()
    expect(
      await mutateCommunicationRows(
        db,
        'partenariats',
        { bulkAction: 'restore', rows: ids.map((id) => ({ id, version: 2 })) },
        'actor',
      ),
    ).toBe(2)
    expect(
      (
        sql
          .query('SELECT count(*) n FROM communication_rows WHERE deleted_at IS NOT NULL')
          .get() as any
      ).n,
    ).toBe(0)
    expect(sql.query('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    sql.close()
  }
})
