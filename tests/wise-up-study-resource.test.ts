import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'

test('study links open the French PDF, preserve unrelated resources and can be reapplied', () => {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE workspace_resources (id TEXT PRIMARY KEY, title TEXT, url TEXT)')
    const insert = db.query('INSERT INTO workspace_resources VALUES (?, ?, ?)')
    insert.run('465ae9f3-9fa2-4c02-84a8-76d5ea4caeb7', 'Etude européenne Wise Up', 'https://example.test/old')
    insert.run('duplicate', 'Etude européenne Wise Up', 'https://drive.google.com/file/d/1v7g2lRDpnYJhosRC-TLvTKIYfMEaXOGW/view?usp=share_link')
    insert.run('folder', 'Étude européenne', 'https://drive.google.com/drive/folders/1f8LriiI66en89twgxY7Y91znDwnZVoG0?usp=sharing')
    insert.run('other', 'Guide', 'https://example.test/guide')
    const sql = readFileSync(new URL('../migrations/interne/0016_wise_up_study_resource.sql', import.meta.url), 'utf8')
    db.exec(sql)
    const rows = db.query('SELECT * FROM workspace_resources ORDER BY id').all() as { id: string; title: string; url: string }[]
    for (const row of rows.filter(row => row.id !== 'other')) {
      expect(row.title.startsWith('Étude')).toBe(true)
      expect(row.url).toBe('https://drive.google.com/file/d/1guC2NUHHhTqDCkq-BMIQmgci7_wP000H/view')
    }
    expect(rows.find(row => row.id === 'other')).toEqual({ id: 'other', title: 'Guide', url: 'https://example.test/guide' })
    db.exec(sql)
    expect(db.query('SELECT * FROM workspace_resources ORDER BY id').all()).toEqual(rows)
  } finally {
    db.close()
  }
})
