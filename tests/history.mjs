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
const h3 = await readHistory(env, 'PPCCR8VU', { weeks: 3 });
assert.equal(h3.wars.length, 3, 'recent wars only');
assert.ok(h3.players.every(p => h3.wars.some(w => w.week === p.week)), 'players only for those wars');
assert.equal(h3.days.length, h.days.length, 'war in progress always included');
assert.ok(h.players.length > 500);
assert.deepEqual(h.events.filter(e => e.kind !== 'seen').map(e => e.kind).sort(), ['join', 'leave', 'role']);
assert.equal(h.days.length, 1); assert.equal(h.periods.length, 2);
assert.equal(h.raceEvents.length, 1, 'one deck-count change recorded'); assert.equal(h.raceEvents[0].decks, 4);

// members' page: one player's own data, no notes
{
  const { readMember } = await import('../worker/history.js');
  const me = await readMember(env, 'PPCCR8VU', '9R2UUCVY');
  assert.equal(me.name, 'Ninja'); assert.ok(me.weeks.length >= 5); assert.equal(me.war.week, '138-3');
  assert.ok(!('notes' in me) && !JSON.stringify(me).includes('"result"'), 'no leader notes');
  assert.equal(await readMember(env, 'PPCCR8VU', 'NOPE'), null);
  const r = await handleApi(new Request('https://x.dev/api/member?tag=%239R2UUCVY'), env);
  assert.equal(r.status, 200);
  assert.equal((await handleApi(new Request('https://x.dev/api/member?tag=bad!'), env)).status, 400);
}

// notes: save and delete; SQL-unsafe text stays as data
await writeNotes(env, 'PPCCR8VU', [{ week: '138-2', tag: 'YCU8RGVJY', kind: 'join', value: '3' },
  { week: '138-2', tag: 'X', kind: 'over', value: "Kick'); DROP TABLE notes;--" }, { week: '1', tag: 'x', kind: 'bad', value: 'no' }]);
assert.equal((await readHistory(env, 'PPCCR8VU')).notes.length, 2);
await writeNotes(env, 'PPCCR8VU', [{ week: '138-2', tag: 'X', kind: 'over', value: null }]);
assert.equal((await readHistory(env, 'PPCCR8VU')).notes.length, 1);

// endpoints
const call = (path, opt) => handleApi(new Request('https://x.dev' + path, opt), env);
assert.deepEqual(await (await call('/api/status')).json(), { key: true, clans: ['PPCCR8VU'], history: true, edit: true, discord: false });
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
  // after-war digest: a newly finished war sends placing, how many reached the target, and who didn't
  DB.raw.exec("DELETE FROM wars WHERE week = '138-2'; DELETE FROM war_players WHERE week = '138-2';");
  await snapshotAll(env, { force: true, only: 'PPCCR8VU', now: Date.parse('2026-11-19T11:30:00.000Z') });
  const d = (await latestAlerts(env, ['PPCCR8VU'])).find(x => /^War 138-2 finished/.test(x.title));
  assert.ok(d && /reached 1800/.test(d.body) && /Under: /.test(d.body), JSON.stringify(d));
  // alerts are filtered by clan and carry ids (so the phone can show each one once)
  await sendAlert(env, 'OTHER', 'o1', 'Other clan', 'x');
  const mine = await latestAlerts(env, ['PPCCR8VU', 'OTHER'], 'PPCCR8VU');
  assert.ok(mine.length && mine.every(a => a.clan === 'PPCCR8VU' && a.id > 0));
  globalThis.fetch = realFetch;
  console.log('Notification checks passed');
}

// "Request updated data" is limited even while pulls are failing
{
  const { requestSnapshot } = await import('../worker/history.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 403 });
  const t0 = Date.parse('2026-11-21T12:00:00.000Z');
  const a = await requestSnapshot(env, 'PPCCR8VU', false, t0);
  assert.equal(a.status, 502, 'pull failed');
  assert.equal((await requestSnapshot(env, 'PPCCR8VU', false, t0 + 60e3)).status, 429, 'still limited after a failure');
  globalThis.fetch = realFetch;
  console.log('Request limit checks passed');
}


// The race, on the real day log of war 138-3 (20 Nov 2026, just after the first reset): race points = place on that
// day's medals (3,000/1,800/1,000/600/400) + defence bonus. Day 1: Bolo 25,350 medals → 3,012; us 21,150 (3rd) → 1,376.
{ const { raceOutlook, RANK_POINTS } = await import('../worker/logic.gen.js');
  const item = (tag, medals, end, bonus) => ({ clan: { tag: '#' + tag }, pointsEarned: medals, progressStartOfDay: 0, progressEndOfDay: end, progressEarned: end - bonus, progressEarnedFromDefenses: bonus });
  const log = [item('Q9U89V0Y', 25350, 3012, 12), item('L8VJL0Q9', 21750, 2123, 323), item('PPCCR8VU', 21150, 1376, 376), item('JLYYGU', 18200, 1035, 435), item('G0V9YUVC', 12600, 776, 376)];
  log.forEach((x, i) => assert.equal(x.progressEarned, RANK_POINTS[i], 'place ' + (i + 1) + ' earns ' + RANK_POINTS[i]));
  const clans = log.map(x => ({ tag: x.clan.tag, name: x.clan.tag, fame: x.progressEndOfDay, periodPoints: 0, participants: [{ fame: x.pointsEarned }] }));
  const race = { periodType: 'warDay', periodIndex: 18, sectionIndex: 2, clans, periodLogs: [{ periodIndex: 17, items: log }] };
  let o = raceOutlook(race);
  assert.equal(o.day, 2); assert.equal(o.started, false);
  assert.deepEqual(o.rows.map(r => r.ifNow), [3012, 2123, 1376, 1035, 776], 'just after the reset: race points as the game shows them');
  // Mid-day: we're 2nd on today's medals → +1,800 if the day ended now, which passes ATATÜRKİYE (2,123 + 1,000).
  clans.find(c => c.tag === '#PPCCR8VU').periodPoints = 7000; clans.find(c => c.tag === '#L8VJL0Q9').periodPoints = 6000; clans.find(c => c.tag === '#Q9U89V0Y').periodPoints = 8000;
  o = raceOutlook(race);
  assert.deepEqual(o.rows.slice(0, 3).map(r => [r.tag, r.ifNow]), [['Q9U89V0Y', 6012], ['PPCCR8VU', 3176], ['L8VJL0Q9', 3123]]);
  // Ties share the higher place: one clan has played, the other four are level on 0 → all 2nd (+1,800).
  for (const c of clans) c.periodPoints = 0; clans.find(c => c.tag === '#L8VJL0Q9').periodPoints = 125;
  o = raceOutlook(race);
  assert.deepEqual(o.rows.map(r => r.place), [1, 0, 1, 1, 1].map((_, i) => o.rows[i].tag === 'L8VJL0Q9' ? 0 : 1));
  assert.equal(o.rows.find(r => r.tag === 'PPCCR8VU').next, 'L8VJL0Q9', 'the clan to pass');
  // Colosseum: total medals decide it (the clan's own wars 136-4 and 137-4 ended on 90,250 and 106,200 = the members' medals).
  const col = raceOutlook({ ...race, periodType: 'colosseum' });
  assert.equal(col.colosseum, true); assert.deepEqual(col.rows.map(r => r.ifNow), [25350, 21750, 21150, 18200, 12600]);
  assert.equal(raceOutlook({ ...race, clans: clans.map((c, i) => ({ ...c, fame: 30000 - i * 1000 })) }).colosseum, true, 'totals over 10,000: colosseum even if the period type says otherwise');
  console.log('Race points checks passed'); }

// Yesterday's decks are corrected after the reset: the last pull of day 1 saw Ninja on 3, but they played a 4th
// before the reset. On day 2 the war total (5) minus today's decks (1) says 4 by the reset.
{ DB.raw.exec("UPDATE race_days SET decks = 3, today = 3 WHERE week = '138-3' AND day = 1 AND tag = '9R2UUCVY'");
  state.race = { ...state.race, periodIndex: 18, clan: { ...state.race.clan, participants: [{ tag: '#9R2UUCVY', name: 'Ninja', fame: 1100, decksUsed: 5, decksUsedToday: 1, boatAttacks: 0 }] } };
  await snapshot(env, 'PPCCR8VU', '2026-11-20T10:00:00.000Z');
  const d1 = DB.raw.prepare("SELECT decks, today FROM race_days WHERE week = '138-3' AND day = 1 AND tag = '9R2UUCVY'").get();
  assert.deepEqual({ ...d1 }, { decks: 4, today: 4 }, 'day 1 corrected to the decks used by the reset');
  console.log('Yesterday correction checks passed'); }

// Day 4 is corrected from the finished war: Ninja had 12 decks by the end of day 3, the last pull of day 4 saw 3 more,
// and the war log's final count is 16 → 4 on day 4.
{ DB.raw.exec(`INSERT OR REPLACE INTO race_days (clan,week,day,tag,name,fame,decks,today,boats,at) VALUES
    ('PPCCR8VU','139-1',3,'9R2UUCVY','Ninja',2000,12,4,0,'x'),('PPCCR8VU','139-1',4,'9R2UUCVY','Ninja',2600,15,3,0,'x')`);
  const realFetch = globalThis.fetch, entry = { seasonId: 139, sectionIndex: 0, createdDate: '20261130T094300.000Z', standings: [{ rank: 1, trophyChange: 20, clan: { tag: '#PPCCR8VU', fame: 10000, participants: [{ tag: '#9R2UUCVY', name: 'Ninja', fame: 2800, decksUsed: 16, boatAttacks: 0 }] } }] };
  globalThis.fetch = async (url, o) => decodeURIComponent(url).includes('/riverracelog') ? new Response(JSON.stringify({ items: [entry, ...api.log.items] }), { status: 200 }) : realFetch(url, o);
  await snapshot(env, 'PPCCR8VU', '2026-11-30T10:00:00.000Z');
  globalThis.fetch = realFetch;
  assert.deepEqual({ ...DB.raw.prepare("SELECT decks, today FROM race_days WHERE week = '139-1' AND day = 4 AND tag = '9R2UUCVY'").get() }, { decks: 16, today: 4 }, 'day 4 from the final count');
  console.log('Day 4 correction checks passed'); }

// A failing data pull is reported in the leaders' channel too (once per 6 hours), not only as a phone alert.
{ const { snapshotAll } = await import('../worker/history.js');
  const realFetch = globalThis.fetch, posts = [];
  DB.raw.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:GX', '{"clan":"PPCCR8VU","channels":{"leaders":"LC"},"roles":{}}')`);
  globalThis.fetch = async (url, o = {}) => { const u = String(url); if (u.includes('discord.com')) { if (o.method === 'POST') posts.push(JSON.parse(o.body).content); return Response.json({ id: 'P' }); } return new Response('{}', { status: 503 }); };
  const env2 = { ...env, DISCORD_PUBLIC_KEY: 'x', DISCORD_BOT_TOKEN: 't', DISCORD_APP_ID: 'A' }, t0 = Date.parse('2026-11-22T12:00:00Z');
  await snapshotAll(env2, { force: true, only: 'PPCCR8VU', now: t0 });
  await snapshotAll(env2, { force: true, only: 'PPCCR8VU', now: t0 + 15 * 60e3 });
  await snapshotAll(env2, { force: true, only: 'PPCCR8VU', now: t0 + 30 * 60e3 });
  globalThis.fetch = realFetch;
  assert.equal(posts.filter(p => /hasn't been able to update the clan's data for 30 minutes/.test(p)).length, 1, 'a single blip says nothing; from the second failure in a row, once: ' + posts.join(' | '));
  // Working again: the leaders are told.
  globalThis.fetch = async (url, o = {}) => { const u = String(url); if (u.includes('discord.com')) { if (o.method === 'POST') posts.push(JSON.parse(o.body).content); return Response.json({ id: 'P' }); } return realFetch(url, o); };
  await snapshotAll(env2, { force: true, only: 'PPCCR8VU', now: t0 + 45 * 60e3 });
  globalThis.fetch = realFetch;
  assert.ok(posts.some(p => /updating again/.test(p)), 'recovery announced');
  DB.raw.exec("DELETE FROM kv WHERE k = 'discord:GX'");
  console.log('Failure alert checks passed'); }

// Removed vs left: nobody can leave while offline, so someone already offline 30+ minutes when last seen in the clan
// (recently) was removed by a leader. Someone online at the time could have left themselves.
{ const realFetch = globalThis.fetch, t1 = '2026-12-01T10:00:00.000Z', t2 = '2026-12-01T10:15:00.000Z';
  state.race = { ...state.race, periodType: 'training', periodIndex: 21 };
  const [off, on] = state.members.items.slice(-2);
  off.lastSeen = '20261130T080000.000Z';   // offline since yesterday
  on.lastSeen = '20261201T095500.000Z';    // online 5 minutes before we last saw them
  await snapshot(env, 'PPCCR8VU', t1);
  state.members.items = state.members.items.filter(m => m !== off && m !== on);
  await snapshot(env, 'PPCCR8VU', t2);
  const d = tag => DB.raw.prepare("SELECT detail FROM member_events WHERE kind = 'leave' AND tag = ? ORDER BY at DESC LIMIT 1").get(tag.slice(1))?.detail;
  assert.match(d(off.tag), /:removed$/, 'offline when they went: removed');
  assert.doesNotMatch(d(on.tag), /:removed$/, 'online then: could have left themselves');
  globalThis.fetch = realFetch;
  console.log('Removed-or-left checks passed'); }

// After each war, once-only markers of older wars and old dated ones are forgotten; the current and last two wars' stay.
{ const { pruneKv } = await import('../worker/history.js');
  const DB = fakeD1(); const env = { DB };
  await DB.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); CREATE TABLE wars (clan TEXT, week TEXT, ended_at TEXT);
    INSERT INTO wars VALUES ('C','138-2','20261116T0943'),('C','138-3','20261123T0943'),('C','138-1','20261109T0943');`);
  const keys = ['ping:G:138-1:1:eve', 'ping:G:138-2:4:last', 'dsum:C:138-3:4', 'scout:C:138-4', 'wr:C:137-4:G:U1', 'dm:C:138-1:2:U1', 'tidy:G:138-1:3',
    'tidy:C:2026-11-01', 'tidy:C:2026-11-25', 'todo:C:138-2', 'todo:latest:C', 'errpost:C:1', 'backup:C:2026-10', 'backup:C:2026-11', 'digest:due:C', 'discord:rules:G', 'pingmsg:G'];
  for (const k of keys) DB.raw.prepare('INSERT INTO kv VALUES (?, ?)').run(k, '1');
  assert.equal(await pruneKv(env, 'C', Date.parse('2026-11-26T10:00:00Z')), 9);
  assert.deepEqual(DB.raw.prepare('SELECT k FROM kv ORDER BY k').all().map(r => r.k),
    ['backup:C:2026-11', 'digest:due:C', 'discord:rules:G', 'dsum:C:138-3:4', 'ping:G:138-2:4:last', 'pingmsg:G', 'scout:C:138-4', 'tidy:C:2026-11-25']);
  console.log('Old marker clean-up checks passed'); }

// Kicked players who rejoin: found from a "removed" leave or a Kick decision before their latest join; private API.
{ const { rejoins } = await import('../worker/history.js');
  const DB2 = fakeD1(); const env3 = { DB: DB2, ALLOWED_CLANS: 'PPCCR8VU', EDIT_KEY: 'admin', EDIT_KEYS: 'Stan:abc,Co:co' };
  await DB2.exec(`CREATE TABLE members (clan TEXT, tag TEXT, name TEXT, role TEXT, in_clan INTEGER, first_seen TEXT, last_seen_game TEXT, updated_at TEXT);
    CREATE TABLE member_events (clan TEXT, tag TEXT, name TEXT, kind TEXT, detail TEXT, at TEXT); CREATE TABLE notes (clan TEXT, week TEXT, tag TEXT, kind TEXT, value TEXT, at TEXT);
    INSERT INTO members (clan, tag, name, in_clan) VALUES ('PPCCR8VU','K1','Kicked',1),('PPCCR8VU','K2','Marked',1),('PPCCR8VU','L1','Left',1),('PPCCR8VU','K3','Gone',0);
    INSERT INTO member_events VALUES ('PPCCR8VU','K1','Kicked','leave','member:removed','2026-11-23T10:00:00Z'),('PPCCR8VU','K1','Kicked','join','member','2026-11-26T10:00:00Z'),
      ('PPCCR8VU','K2','Marked','leave','member','2026-11-23T10:00:00Z'),('PPCCR8VU','K2','Marked','join','member','2026-11-26T11:00:00Z'),
      ('PPCCR8VU','L1','Left','leave','member','2026-11-23T10:00:00Z'),('PPCCR8VU','L1','Left','join','member','2026-11-26T12:00:00Z'),
      ('PPCCR8VU','K3','Gone','leave','member:removed','2026-11-20T10:00:00Z'),('PPCCR8VU','K3','Gone','join','member','2026-11-22T10:00:00Z');
    INSERT INTO notes VALUES ('PPCCR8VU','138-3','K2','over','Kick','x'),('PPCCR8VU','138-3','L1','over','Warn','x');`);
  const got = await rejoins(DB2, 'PPCCR8VU', '2026-11-01T00:00:00Z');
  assert.deepEqual(got.map(r => [r.tag, !!r.removedAt, r.kickWeeks]), [['K2', false, ['138-3']], ['K1', true, []]], 'kicked (seen or marked) and back in the clan; not someone who just left');
  assert.deepEqual((await rejoins(DB2, 'PPCCR8VU', '2026-11-01T00:00:00Z', ['K1'])).map(r => r.tag), ['K1'], 'only the tags asked about');
  const ask = key => handleApi(new Request('https://x.dev/api/rejoins?clan=PPCCR8VU', { headers: key ? { 'X-Edit-Key': key } : {} }), env3);
  assert.equal((await ask(null)).status, 403); assert.equal((await ask('co')).status, 403, 'per-leader codes: no'); assert.equal((await ask('abc')).status, 403);
  const ok = await ask('admin'); assert.equal(ok.status, 200, 'the admin code (EDIT_KEY)');
  await DB2.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); INSERT INTO kv VALUES ('discord:G', '{"clan":"PPCCR8VU","rejoinCo":true}')`);
  assert.equal((await ask('co')).status, 200, 'Co-Leaders switched on by the Leader: every leader code');
  assert.equal((await ask(null)).status, 403);
  console.log('Rejoin checks passed'); }
