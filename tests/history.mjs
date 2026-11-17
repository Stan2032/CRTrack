// Runs the history snapshot code against an in-memory SQLite (stand-in for Cloudflare D1)
// with fake API replies built from samples/. Usage: node tests/history.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { snapshot, readHistory, writeNotes, weekOf, battleDay } from '../worker/history.js';
import { handleApi } from '../worker/api.js';
import { fakeApi } from './check.mjs';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  let queries = 0;
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => { queries++; return { results: db.prepare(sql).all(...args) }; },
    run: async () => { queries++; db.prepare(sql).run(...args); return {}; },
  });
  return {
    prepare: sql => stmt(sql),
    batch: async list => { for (const s of list) await s.run(); },
    exec: async sql => { queries += sql.split(';').filter(s => s.trim()).length; db.exec(sql); },
    raw: db, count: () => queries, reset: () => { queries = 0; },
  };
}

const api = fakeApi();
let state = { members: structuredClone(api.members), race: { ...api.race, sectionIndex: 2, periodIndex: 15, periodType: 'training' } };
globalThis.fetch = async url => {
  const u = decodeURIComponent(url);
  const body = u.endsWith('/members') ? state.members : u.includes('/currentriverrace') ? state.race
    : u.includes('/riverracelog') ? { items: api.log.items.slice().sort((a, b) => b.seasonId - a.seasonId || b.sectionIndex - a.sectionIndex) } : {};
  return new Response(JSON.stringify(body), { status: 200 });
};

const DB = fakeD1();
const env = { DB, CR_API_KEY: 'K', ALLOWED_CLANS: 'PPCCR8VU', EDIT_KEY: 'secret' };

// first run: baseline, imports 10 weeks
let r = await snapshot(env, 'PPCCR8VU', '2026-11-17T10:00:00.000Z');
assert.equal(r.newWars, 10); assert.equal(r.week, '138-3'); assert.equal(r.day, 0);
assert.ok(DB.count() <= 50, 'queries ' + DB.count());
assert.equal(DB.raw.prepare("SELECT count(*) c FROM member_events WHERE kind='seen'").get().c, 48);

// second run: someone leaves, someone joins, a promotion; battle day 1 starts
DB.reset();
state.members.items = state.members.items.filter(m => m.name !== 'Manny1');
state.members.items.find(m => m.name === 'Ninja').role = 'elder';
state.members.items.push({ tag: '#NEWGUY', name: 'New Guy', role: 'member', lastSeen: '20261120T100000.000Z' });
state.race = { ...state.race, periodIndex: 17, periodType: 'warDay',
  clan: { ...state.race.clan, participants: [{ tag: '#9R2UUCVY', name: 'Ninja', fame: 800, decksUsed: 4, decksUsedToday: 4, boatAttacks: 0 }] } };
r = await snapshot(env, 'PPCCR8VU', '2026-11-19T10:00:00.000Z');
assert.equal(r.newWars, 0); assert.equal(r.day, 1); assert.equal(r.events, 3);
assert.ok(DB.count() <= 50, 'queries ' + DB.count());

const h = await readHistory(env, 'PPCCR8VU');
assert.equal(h.wars.length, 10);
assert.ok(h.players.length > 500);
assert.deepEqual(h.events.filter(e => e.kind !== 'seen').map(e => e.kind).sort(), ['join', 'leave', 'role']);
assert.equal(h.days.length, 1); assert.equal(h.periods.length, 2);

// notes: save and delete; SQL-unsafe text stays as data
await writeNotes(env, 'PPCCR8VU', [{ week: '138-2', tag: 'YCU8RGVJY', kind: 'join', value: '3' },
  { week: '138-2', tag: 'X', kind: 'over', value: "Kick'); DROP TABLE notes;--" }, { week: '1', tag: 'x', kind: 'bad', value: 'no' }]);
assert.equal((await readHistory(env, 'PPCCR8VU')).notes.length, 2);
await writeNotes(env, 'PPCCR8VU', [{ week: '138-2', tag: 'X', kind: 'over', value: null }]);
assert.equal((await readHistory(env, 'PPCCR8VU')).notes.length, 1);

// endpoints
const call = (path, opt) => handleApi(new Request('https://x.dev' + path, opt), env);
assert.deepEqual(await (await call('/api/status')).json(), { key: true, clans: ['PPCCR8VU'], history: true, edit: true });
assert.equal((await call('/api/history?clan=PPCCR8VU')).status, 200);
assert.equal((await call('/api/history?clan=2PP')).status, 403);
assert.equal((await call('/api/notes?clan=PPCCR8VU', { method: 'POST', body: '{"items":[]}' })).status, 401);
assert.equal((await call('/api/notes?clan=PPCCR8VU', { method: 'POST', body: '{"items":[]}', headers: { 'X-Edit-Key': 'secret' } })).status, 200);
assert.equal((await call('/api/snapshot', { method: 'POST' })).status, 401);

assert.equal(weekOf({ sectionIndex: 0 }, [{ seasonId: 138, sectionIndex: 3 }]), '139-1');
assert.equal(battleDay({ periodType: 'warDay', periodIndex: 20 }), 4);
console.log('History checks passed');
