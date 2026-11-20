// Request budget per run: worst-case battle-day runs with Discord set up: count D1 calls (a batch or exec = 1, as D1 counts them)
// and external fetches (Clash Royale API + Discord), against the free plan's 50 + 50 per run.
// Usage: node tests/budget.mjs   (VERBOSE=1 to print each run)
import assert from 'node:assert/strict';
let worst = 0;
const R = new URL('../', import.meta.url).href;   // the repo root
const { DatabaseSync } = await import('node:sqlite');
const { fakeApi } = await import(R + 'tests/check.mjs');
const { snapshotAll } = await import(R + 'worker/history.js');

const db = new DatabaseSync(':memory:');
let q = 0;
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  all: async () => { q++; return { results: db.prepare(sql).all(...args) }; },
  first: async () => { q++; return db.prepare(sql).get(...args) ?? null; },
  run: async () => { q++; db.prepare(sql).run(...args); return { meta: { changes: 1 } }; },
  _run: () => db.prepare(sql).run(...args),
});
const DB = { prepare: sql => stmt(sql), batch: async l => { q++; for (const s of l) s._run(); return []; }, exec: async sql => { q++; db.exec(sql); } };

const api = fakeApi();
let fetches = 0, discord = 0, cr = 0;
const members = api.members.items;
const race = (today, decks) => ({ ...api.race, sectionIndex: 2, periodIndex: 18, periodType: 'warDay',
  clans: [{ tag: '#PPCCR8VU', name: '#WINNING', fame: 1376, periodPoints: 9000, participants: [] }, { tag: '#AAA', name: 'Rival', fame: 3000, periodPoints: 9500, participants: [] }],
  periodLogs: [{ periodIndex: 17, items: [{ clan: { tag: '#PPCCR8VU' }, pointsEarned: 21000, progressEndOfDay: 1376, progressEarnedFromDefenses: 376 }, { clan: { tag: '#AAA' }, pointsEarned: 25000, progressEndOfDay: 3000, progressEarnedFromDefenses: 0 }] }],
  clan: { ...api.race.clan, participants: members.map((m, i) => ({ tag: m.tag, name: m.name, fame: 400 + i * 10, decksUsed: decks(i), decksUsedToday: today(i), boatAttacks: 0 })) } });
let cur = race(i => i % 5, i => 4 + (i % 5));
globalThis.fetch = async (url, opt = {}) => {
  fetches++; const u = decodeURIComponent(String(url));
  if (u.includes('discord.com')) { discord++; return opt.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 'M' + discord, author: { id: 'A' } }); }
  cr++;
  if (u.includes('/battlelog')) return Response.json([]);
  const body = u.endsWith('/members') ? api.members : u.includes('/currentriverrace') ? cur : u.includes('/riverracelog') ? { items: api.log.items.slice().sort((a, b) => b.seasonId - a.seasonId || b.sectionIndex - a.sectionIndex) } : {};
  return Response.json(body);
};
const env = { DB, CR_API_KEY: 'K', ALLOWED_CLANS: 'PPCCR8VU', DISCORD_PUBLIC_KEY: 'x', DISCORD_BOT_TOKEN: 't', DISCORD_APP_ID: 'A' };
const run = async (label, iso) => {
  q = 0; fetches = 0; discord = 0; cr = 0;
  await snapshotAll(env, { force: true, only: 'PPCCR8VU', now: Date.parse(iso) });
  if (process.env.VERBOSE) console.log(label.padEnd(44), 'D1 calls', String(q).padStart(3), '| external fetches', String(fetches).padStart(3), `(game ${cr}, Discord ${discord})`);
  if (!/first run/.test(label)) { assert.ok(q <= 45, `${label}: ${q} D1 calls (free plan: 50)`); assert.ok(fetches <= 45, `${label}: ${fetches} requests (free plan: 50)`); }
  if (!/first run/.test(label)) worst = Math.max(worst, q, fetches);   // the first run imports 10 wars of history, once
};
await run('first run (imports history)', '2026-11-20T10:00:00Z');
db.exec("UPDATE wars SET ended_at = '20261116T094306.000Z' WHERE week = '138-2'");
// Discord set up in a server, with every job's channel, and 25 linked members (half with DM reminders).
db.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:G1', '${JSON.stringify({ clan: 'PPCCR8VU', channels: { war: 'C1', results: 'C2', joins: 'C3', leaders: 'C4', scout: 'C5', guests: 'C6', bot: 'C7' }, roles: { member: 'R1', elder: 'R2', coLeader: 'R3', leader: 'R4' } })}')`);
for (const [i, m] of members.slice(0, 25).entries()) {
  db.exec(`INSERT INTO discord_links (guild,user_id,clan,tag,at,by) VALUES ('G1','U${i}','PPCCR8VU','${m.tag.slice(1)}','x','x')`);
  if (i % 2) db.exec(`INSERT INTO discord_reminders (guild,user_id,hours,dm) VALUES ('G1','U${i}',3,'D${i}')`);
}
await run('ordinary battle-day run', '2026-11-20T14:00:00Z');
await run('evening ping due (posts + DMs due?)', '2026-11-20T19:01:00Z');
await run('next run (edits the ping)', '2026-11-20T19:16:00Z');
await run('DM reminders due (3 h before reset)', '2026-11-21T06:45:00Z');
await run('last call', '2026-11-21T07:44:00Z');
cur = race(i => 0, i => 8 + (i % 5)); cur.periodIndex = 19;
cur.periodLogs.push({ periodIndex: 18, items: cur.periodLogs[0].items });
await run('first run after the reset (summary, fixes)', '2026-11-21T09:45:00Z');
cur = { ...cur, periodIndex: 20 }; cur.periodLogs.push({ periodIndex: 19, items: cur.periodLogs[0].items });
await run('battle day 4', '2026-11-22T12:00:00Z');
// The war ends: training day of the next war, and the finished war appears in the log (result, shout-outs, day 4
// summary, war-report DMs for everyone opted in, stats board).
for (const [i] of members.slice(0, 25).entries()) db.exec(`INSERT OR REPLACE INTO discord_warreport (guild,user_id,dm) VALUES ('G1','U${i}','D${i}')`);
const finished = { seasonId: 138, sectionIndex: 2, createdDate: '20261123T094300.000Z', standings: [{ rank: 2, trophyChange: 10, clan: { tag: '#PPCCR8VU', fame: 7700,
  participants: members.map((m, i) => ({ tag: m.tag, name: m.name, fame: 1500 + i * 20, decksUsed: 12 + (i % 5), boatAttacks: 0 })) } }] };
api.log.items.unshift(finished);
cur = { ...cur, sectionIndex: 3, periodIndex: 21, periodType: 'training', clan: { ...cur.clan, participants: [] } };
await run('war ends (result, shout-outs, summary, DMs)', '2026-11-23T09:50:00Z');
// The run after a war ends (as the schedule runs it, not forced): war-report DMs (up to 20) and the stats board.
{ q = 0; fetches = 0; discord = 0; cr = 0;
  await snapshotAll(env, { now: Date.parse('2026-11-23T10:05:00Z') });
  if (process.env.VERBOSE) console.log('war reports + stats board'.padEnd(44), 'D1 calls', String(q).padStart(3), '| external fetches', String(fetches).padStart(3), `(game ${cr}, Discord ${discord})`);
  assert.ok(discord >= 20, 'war-report DMs sent: ' + discord);
  assert.ok(q <= 45, `war reports run: ${q} D1 calls (free plan: 50)`); assert.ok(fetches <= 45, `war reports run: ${fetches} requests`); worst = Math.max(worst, q, fetches); }
for (const t of ['10:20', '10:35', '10:50']) await run('after the war ' + t, `2026-11-23T${t}:00Z`);
void ('DBG dsum', db.prepare("SELECT k FROM kv WHERE k LIKE 'dsum:%'").all().map(x=>x.k), 'days', db.prepare("SELECT week, day, count(*) n FROM race_days GROUP BY week, day").all().map(x=>x.week+'/'+x.day+':'+x.n), 'wars', db.prepare("SELECT week FROM wars ORDER BY week DESC LIMIT 2").all().map(x=>x.week));
assert.ok(db.prepare("SELECT count(*) c FROM kv WHERE k LIKE 'dsum:%:138-3:4'").get().c === 1, 'day 4 summary posted');
assert.ok(db.prepare("SELECT count(*) c FROM kv WHERE k LIKE 'ping:G1:138-3:2:%'").get().c === 2, 'evening ping and last call both sent');
console.log(`Request budget checks passed (worst battle-day run: ${worst} of 50)`);
