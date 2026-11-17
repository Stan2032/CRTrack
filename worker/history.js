// History store (Cloudflare D1). Snapshots run on a schedule (see wrangler.jsonc "triggers").
// Free plan limits: 50 D1 queries and 10 ms CPU per run, so rows are written with one
// multi-row statement per table, with values inlined as escaped SQL literals.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (clan TEXT, tag TEXT, name TEXT, role TEXT, in_clan INTEGER, first_seen TEXT, last_seen_game TEXT, updated_at TEXT, PRIMARY KEY (clan, tag));
CREATE TABLE IF NOT EXISTS member_events (clan TEXT, tag TEXT, name TEXT, kind TEXT, detail TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS member_events_clan ON member_events (clan, at);
CREATE TABLE IF NOT EXISTS wars (clan TEXT, week TEXT, ended_at TEXT, rank INTEGER, fame INTEGER, trophy_change INTEGER, PRIMARY KEY (clan, week));
CREATE TABLE IF NOT EXISTS war_players (clan TEXT, week TEXT, tag TEXT, name TEXT, fame INTEGER, decks INTEGER, boats INTEGER, PRIMARY KEY (clan, week, tag));
CREATE TABLE IF NOT EXISTS periods (clan TEXT, week TEXT, period INTEGER, type TEXT, first_seen TEXT, PRIMARY KEY (clan, week, period));
CREATE TABLE IF NOT EXISTS race_days (clan TEXT, week TEXT, day INTEGER, tag TEXT, name TEXT, fame INTEGER, decks INTEGER, today INTEGER, boats INTEGER, at TEXT, PRIMARY KEY (clan, week, day, tag));
CREATE TABLE IF NOT EXISTS notes (clan TEXT, week TEXT, tag TEXT, kind TEXT, value TEXT, at TEXT, PRIMARY KEY (clan, week, tag, kind));
`.trim();

export const q = v => v == null ? 'NULL'
  : typeof v === 'number' ? (Number.isFinite(v) ? String(Math.trunc(v)) : 'NULL')
  : "'" + String(v).replace(/\0/g, '').replace(/'/g, "''") + "'";
const rows = list => list.map(r => '(' + r.map(q).join(',') + ')').join(',');
const clean = t => String(t || '').replace(/^#/, '').toUpperCase();

export function trackedClans(env) {
  return (env.TRACK_CLANS || env.ALLOWED_CLANS || '').split(',').map(clean).filter(Boolean);
}

// Week key of the current race, e.g. "138-3". The log holds finished weeks only.
export function weekOf(race, logItems) {
  const last = logItems && logItems[0];
  if (!last || race == null) return null;
  const season = race.sectionIndex > last.sectionIndex ? last.seasonId : last.seasonId + 1;
  return `${season}-${race.sectionIndex + 1}`;
}

// periodIndex: 0-2 training, 3-6 battle days 1-4 (repeats each week)
export function battleDay(race) {
  if (!race || !['warDay', 'colosseum'].includes(race.periodType)) return 0;
  return Math.min(4, Math.max(1, (race.periodIndex % 7) - 2));
}

async function cr(env, path) {
  const r = await fetch('https://proxy.royaleapi.dev/v1' + path, { headers: { Authorization: 'Bearer ' + env.CR_API_KEY } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

export async function snapshot(env, clan, now = new Date().toISOString()) {
  const db = env.DB, t = encodeURIComponent('#' + clan);
  await db.exec(SCHEMA);
  const haveWars = (await db.prepare('SELECT week FROM wars WHERE clan = ?').bind(clan).all()).results.map(r => r.week);
  const [members, race, log] = await Promise.all([
    cr(env, `/clans/${t}/members`),
    cr(env, `/clans/${t}/currentriverrace`),
    cr(env, `/clans/${t}/riverracelog?limit=${haveWars.length ? 3 : 10}`),
  ]);
  const sql = [];

  // Members: joins, leaves, role changes
  const known = (await db.prepare('SELECT tag, name, role, in_clan FROM members WHERE clan = ?').bind(clan).all()).results;
  const byTag = new Map(known.map(r => [r.tag, r]));
  const firstRun = !known.length;
  const events = [], upserts = [], here = new Set();
  for (const m of members.items || []) {
    const tag = clean(m.tag), k = byTag.get(tag);
    here.add(tag);
    if (!k || !k.in_clan) events.push([clan, tag, m.name, firstRun ? 'seen' : 'join', m.role, now]);
    else if (k.role !== m.role) events.push([clan, tag, m.name, 'role', `${k.role}>${m.role}`, now]);
    upserts.push([clan, tag, m.name, m.role, 1, now, m.lastSeen || null, now]);
  }
  const gone = known.filter(k => k.in_clan && !here.has(k.tag));
  for (const k of gone) events.push([clan, k.tag, k.name, 'leave', k.role, now]);
  if (upserts.length) sql.push(`INSERT INTO members (clan,tag,name,role,in_clan,first_seen,last_seen_game,updated_at) VALUES ${rows(upserts)}
    ON CONFLICT(clan,tag) DO UPDATE SET name=excluded.name, role=excluded.role, in_clan=1, last_seen_game=excluded.last_seen_game, updated_at=excluded.updated_at`);
  if (gone.length) sql.push(`UPDATE members SET in_clan = 0, updated_at = ${q(now)} WHERE clan = ${q(clan)} AND tag IN (${gone.map(k => q(k.tag)).join(',')})`);
  if (events.length) sql.push(`INSERT INTO member_events (clan,tag,name,kind,detail,at) VALUES ${rows(events)}`);

  // Finished wars (kept forever; the API only returns the last 10)
  const wars = [], players = [];
  for (const w of log.items || []) {
    const week = `${w.seasonId}-${w.sectionIndex + 1}`;
    if (haveWars.includes(week)) continue;
    const st = (w.standings || []).find(s => clean(s.clan.tag) === clan);
    if (!st) continue;
    wars.push([clan, week, w.createdDate, st.rank, st.clan.fame, st.trophyChange]);
    for (const p of st.clan.participants || []) players.push([clan, week, clean(p.tag), p.name, p.fame, p.decksUsed, p.boatAttacks]);
  }
  if (wars.length) sql.push(`INSERT OR REPLACE INTO wars (clan,week,ended_at,rank,fame,trophy_change) VALUES ${rows(wars)}`);
  if (players.length) sql.push(`INSERT OR REPLACE INTO war_players (clan,week,tag,name,fame,decks,boats) VALUES ${rows(players)}`);

  // Current race: when each period started, and each player's decks per battle day
  const week = weekOf(race, log.items), day = battleDay(race);
  if (week) sql.push(`INSERT OR IGNORE INTO periods (clan,week,period,type,first_seen) VALUES ${rows([[clan, week, race.periodIndex, race.periodType, now]])}`);
  const live = (race.clan?.participants || []).filter(p => here.has(clean(p.tag)) || p.decksUsed > 0);
  if (week && day && live.length) sql.push(`INSERT OR REPLACE INTO race_days (clan,week,day,tag,name,fame,decks,today,boats,at) VALUES ${
    rows(live.map(p => [clan, week, day, clean(p.tag), p.name, p.fame, p.decksUsed, p.decksUsedToday, p.boatAttacks, now]))}`);

  if (sql.length) await db.batch(sql.map(s => db.prepare(s)));
  return { clan, members: upserts.length, events: events.length, newWars: wars.length, week, day };
}

export async function snapshotAll(env) {
  const out = [];
  for (const clan of trackedClans(env)) {
    try { out.push(await snapshot(env, clan)); } catch (e) { out.push({ clan, error: String(e.message || e) }); }
  }
  return out;
}

export async function readHistory(env, clan) {
  const db = env.DB;
  await db.exec(SCHEMA);
  const all = s => db.prepare(s).bind(clan).all().then(r => r.results);
  const [members, events, wars, players, periods, days, notes] = await Promise.all([
    all('SELECT tag,name,role,in_clan,first_seen,last_seen_game FROM members WHERE clan = ?'),
    all('SELECT tag,name,kind,detail,at FROM member_events WHERE clan = ? ORDER BY at'),
    all('SELECT week,ended_at,rank,fame,trophy_change FROM wars WHERE clan = ?'),
    all('SELECT week,tag,name,fame,decks,boats FROM war_players WHERE clan = ?'),
    all('SELECT week,period,type,first_seen FROM periods WHERE clan = ? ORDER BY first_seen'),
    all('SELECT week,day,tag,fame,decks,today,boats,at FROM race_days WHERE clan = ?'),
    all('SELECT week,tag,kind,value,at FROM notes WHERE clan = ?'),
  ]);
  return { clan, members, events, wars, players, periods, days, notes };
}

const NOTE_KINDS = ['join', 'over', 'result', 'rules'];

export async function writeNotes(env, clan, items, now = new Date().toISOString()) {
  const ok = (items || []).filter(i => i && NOTE_KINDS.includes(i.kind) && typeof i.week === 'string' && typeof i.tag === 'string'
    && i.week.length < 20 && i.tag.length < 20 && (i.value == null || String(i.value).length < 4000)).slice(0, 200);
  const put = ok.filter(i => i.value != null).map(i => [clan, i.week, clean(i.tag) || '*', i.kind, String(i.value), now]);
  const del = ok.filter(i => i.value == null);
  const sql = [];
  if (put.length) sql.push(`INSERT OR REPLACE INTO notes (clan,week,tag,kind,value,at) VALUES ${rows(put)}`);
  if (del.length) sql.push(`DELETE FROM notes WHERE clan = ${q(clan)} AND (${del.map(i => `(week = ${q(i.week)} AND tag = ${q(clean(i.tag) || '*')} AND kind = ${q(i.kind)})`).join(' OR ')})`);
  await env.DB.exec(SCHEMA);
  if (sql.length) await env.DB.batch(sql.map(s => env.DB.prepare(s)));
  return { saved: put.length, removed: del.length };
}
