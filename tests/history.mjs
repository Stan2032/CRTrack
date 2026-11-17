// Runs the history snapshot code against an in-memory SQLite (stand-in for Cloudflare D1)
// with fake API replies built from samples/. Usage: node tests/history.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { snapshot, readHistory, writeNotes, weekOf, battleDay, warBattle } from '../worker/history.js';
import { handleApi } from '../worker/api.js';
import { fakeApi } from './check.mjs';

function fakeD1() {
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

const api = fakeApi();
let state = { members: structuredClone(api.members), race: { ...api.race, sectionIndex: 2, periodIndex: 15, periodType: 'training' } };
globalThis.fetch = async url => {
  const u = decodeURIComponent(url);
  if (u.includes('/battlelog')) return new Response(JSON.stringify([
    { type: 'riverRacePvP', battleTime: '20261119T090000.000Z', team: [{ crowns: 2 }], opponent: [{ crowns: 1 }] },
    { type: 'riverRaceDuel', battleTime: '20261119T091000.000Z', team: [{ crowns: 3, rounds: [{ crowns: 1 }, { crowns: 0 }, { crowns: 2 }] }], opponent: [{ crowns: 1, rounds: [{ crowns: 0 }, { crowns: 1 }, { crowns: 1 }] }] },
    { type: 'boatBattle', battleTime: '20261119T092000.000Z', boatBattleSide: 'attacker', boatBattleWon: true, team: [{}], opponent: [{}] },
    { type: 'PvP', battleTime: '20261119T093000.000Z', team: [{ crowns: 3 }], opponent: [{ crowns: 0 }] },
  ]), { status: 200 });
  const body = u.endsWith('/members') ? state.members : u.includes('/currentriverrace') ? state.race
    : u.includes('/riverracelog') ? { items: api.log.items.slice().sort((a, b) => b.seasonId - a.seasonId || b.sectionIndex - a.sectionIndex) } : {};
  return new Response(JSON.stringify(body), { status: 200 });
};

const DB = fakeD1();
const env = { DB, CR_API_KEY: 'K', ALLOWED_CLANS: 'PPCCR8VU', EDIT_KEY: 'secret' };

// first run: baseline, imports 10 weeks
let r = await snapshot(env, 'PPCCR8VU', '2026-11-17T10:00:00.000Z');
assert.equal(r.newWars.length, 10); assert.equal(r.week, '138-3'); assert.equal(r.day, 0);
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
assert.equal(r.newWars.length, 0); assert.deepEqual(r.joined, ['New Guy']); assert.deepEqual(r.left, ['Manny1']); assert.equal(r.day, 1); assert.equal(r.events, 3);
assert.ok(DB.count() <= 50, 'queries ' + DB.count());

const h = await readHistory(env, 'PPCCR8VU');
assert.equal(h.wars.length, 10);
assert.ok(h.players.length > 500);
assert.deepEqual(h.events.filter(e => e.kind !== 'seen').map(e => e.kind).sort(), ['join', 'leave', 'role']);
assert.equal(h.days.length, 1); assert.equal(h.periods.length, 2);
assert.equal(h.raceEvents.length, 1, 'one deck-count change recorded'); assert.equal(h.raceEvents[0].decks, 4);

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
// per-leader codes: the log records who
{
  const env2 = { ...env, EDIT_KEYS: 'Stan:abc, Baki:xyz' };
  const r2 = await handleApi(new Request('https://x.dev/api/notes?clan=PPCCR8VU', { method: 'POST', body: JSON.stringify({ items: [{ week: '138-3', tag: 'X', kind: 'done', value: '1' }] }), headers: { 'X-Edit-Key': 'xyz' } }), env2);
  assert.equal((await r2.json()).by, 'Baki');
  assert.equal((await readHistory(env2, 'PPCCR8VU')).noteLog[0].by, 'Baki');
  const r3 = await handleApi(new Request('https://x.dev/api/notes?clan=PPCCR8VU', { method: 'POST', body: '{"items":[]}', headers: { 'X-Edit-Key': 'secret' } }), env2);
  assert.equal((await r3.json()).by, 'Leader');
}

assert.equal(weekOf({ sectionIndex: 0 }, [{ seasonId: 138, sectionIndex: 3 }]), '139-1');
assert.equal(battleDay({ periodType: 'warDay', periodIndex: 20 }), 4);
// battle logs: 3 players per run, war battles only
assert.ok(h.battles.length >= 3 && h.battles.every(b => ['pvp', 'duel', 'boat'].includes(b.type)), JSON.stringify(h.battles.slice(0, 3)));
assert.deepEqual(warBattle({ type: 'riverRaceDuel', team: [{ rounds: [{ crowns: 1 }, { crowns: 1 }] }], opponent: [{ rounds: [{ crowns: 0 }, { crowns: 0 }] }] }), { type: 'duel', won: 2, lost: 0 });
assert.equal(warBattle({ type: 'PvP' }), null);
assert.equal(warBattle({ type: 'boatBattle', boatBattleSide: 'defender' }), null);
assert.ok(h.stats.length >= 48);
console.log('History checks passed');

// schedule: training days run just after the daily reset and every 12 h; battle days always
{
  const { shouldRun, requestSnapshot } = await import('../worker/history.js');
  const rq = await requestSnapshot(env, 'PPCCR8VU', false, Date.parse('2026-11-19T10:02:00.000Z'));
  assert.equal(rq.status, 429, 'too soon after last run');
  assert.equal((await requestSnapshot(env, 'PPCCR8VU', false, Date.parse('2026-11-19T10:30:00.000Z'))).status, 200);
  assert.ok((await readHistory(env, 'PPCCR8VU')).lastRun.startsWith('2026-11-19T10:30'));
  const reset = Date.UTC(2026, 10, 16, 9, 43), H = 3600e3;
  const at = (d, h, m) => Date.UTC(2026, 10, d, h, m);
  assert.equal(shouldRun({ lastType: 'warDay', lastRun: at(19, 9, 0), resetAt: reset }, at(19, 9, 15)), true);
  assert.equal(shouldRun({ lastType: 'training', lastRun: at(17, 10, 0), resetAt: reset }, at(17, 15, 0)), false);
  assert.equal(shouldRun({ lastType: 'training', lastRun: at(17, 10, 0), resetAt: reset }, at(18, 9, 45)), true);
  assert.equal(shouldRun({ lastType: 'training', lastRun: at(17, 10, 0), resetAt: reset }, at(17, 22, 0)), true);
  assert.equal(shouldRun({ lastType: null }, at(17, 15, 0)), true);
  console.log('Schedule checks passed');
}

// notifications: subscribe, alerts recorded once, push sent with a VAPID header
{
  const { subscribe, sendAlert, latestAlerts, publicKey } = await import('../worker/push.js');
  const pushes = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    if (String(url).startsWith('https://push.example/')) { pushes.push({ url, auth: opt.headers.Authorization }); return new Response('', { status: url.endsWith('/gone') ? 410 : 201 }); }
    return realFetch(url, opt);
  };
  const key = await publicKey(env);
  assert.ok(key.length > 80, 'public key');
  assert.equal(await subscribe(env, 'PPCCR8VU', { endpoint: 'https://push.example/a' }, 'Stan', 'https://site.example'), true);
  assert.equal(await subscribe(env, 'PPCCR8VU', { endpoint: 'https://push.example/gone' }, 'Baki', 'https://site.example'), true);
  assert.equal(await subscribe(env, 'PPCCR8VU', { endpoint: 'javascript:alert(1)' }, 'x', ''), false);
  assert.equal(await sendAlert(env, 'PPCCR8VU', 'k1', 'Hello', 'World'), 1);
  assert.equal(await sendAlert(env, 'PPCCR8VU', 'k1', 'Hello', 'World'), 0, 'same key sends once');
  assert.match(pushes[0].auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(DB.raw.prepare('SELECT count(*) c FROM push_subs').get().c, 1, 'gone endpoint removed');
  assert.equal((await latestAlerts(env, ['PPCCR8VU']))[0].title, 'Hello');
  // a pull that sees someone leave raises an alert
  const { snapshotAll } = await import('../worker/history.js');
  state.members.items = state.members.items.filter(m => m.name !== 'Bob');
  await snapshotAll(env, { force: true, only: 'PPCCR8VU', now: Date.parse('2026-11-19T11:00:00.000Z') });
  const a = await latestAlerts(env, ['PPCCR8VU']);
  assert.ok(a.some(x => x.title === 'Clan members changed' && /Bob/.test(x.body) && /spots open/.test(x.body)), JSON.stringify(a));
  globalThis.fetch = realFetch;
  console.log('Notification checks passed');
}
