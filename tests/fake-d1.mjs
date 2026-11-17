// In-memory SQLite standing in for Cloudflare D1 (same calls the Worker uses).
import { DatabaseSync } from 'node:sqlite';
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  let queries = 0;
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => { queries++; return { results: db.prepare(sql).all(...args) }; },
    first: async () => { queries++; return db.prepare(sql).get(...args) ?? null; },
    run: async () => { queries++; const x = db.prepare(sql).run(...args); return { meta: { changes: Number(x.changes) } }; },
  });
  return {
    prepare: sql => stmt(sql),
    batch: async list => { for (const s of list) await s.run(); },
    exec: async sql => { queries += sql.split(';').filter(s => s.trim()).length; db.exec(sql); },
    raw: db, count: () => queries, reset: () => { queries = 0; },
  };
}
