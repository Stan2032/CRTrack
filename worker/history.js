// History store (Cloudflare D1). Snapshots run on a schedule (see wrangler.jsonc "triggers").
// Free plan limits: 50 D1 queries and 10 ms CPU per run, so rows are written with one
// multi-row statement per table, with values inlined as escaped SQL literals.

import { sendAlert, PUSH_SCHEMA } from './push.js';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (clan TEXT, tag TEXT, name TEXT, role TEXT, in_clan INTEGER, first_seen TEXT, last_seen_game TEXT, updated_at TEXT, PRIMARY KEY (clan, tag));
CREATE TABLE IF NOT EXISTS member_events (clan TEXT, tag TEXT, name TEXT, kind TEXT, detail TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS member_events_clan ON member_events (clan, at);
CREATE TABLE IF NOT EXISTS wars (clan TEXT, week TEXT, ended_at TEXT, rank INTEGER, fame INTEGER, trophy_change INTEGER, PRIMARY KEY (clan, week));
CREATE TABLE IF NOT EXISTS war_players (clan TEXT, week TEXT, tag TEXT, name TEXT, fame INTEGER, decks INTEGER, boats INTEGER, PRIMARY KEY (clan, week, tag));
CREATE TABLE IF NOT EXISTS periods (clan TEXT, week TEXT, period INTEGER, type TEXT, first_seen TEXT, PRIMARY KEY (clan, week, period));
CREATE TABLE IF NOT EXISTS race_days (clan TEXT, week TEXT, day INTEGER, tag TEXT, name TEXT, fame INTEGER, decks INTEGER, today INTEGER, boats INTEGER, at TEXT, PRIMARY KEY (clan, week, day, tag));
CREATE TABLE IF NOT EXISTS notes (clan TEXT, week TEXT, tag TEXT, kind TEXT, value TEXT, at TEXT, PRIMARY KEY (clan, week, tag, kind));
CREATE TABLE IF NOT EXISTS member_stats (clan TEXT, week TEXT, tag TEXT, donations INTEGER, received INTEGER, trophies INTEGER, exp INTEGER, at TEXT, PRIMARY KEY (clan, week, tag));
CREATE TABLE IF NOT EXISTS race_standings (clan TEXT, week TEXT, day INTEGER, rival TEXT, name TEXT, fame INTEGER, at TEXT, PRIMARY KEY (clan, week, day, rival));
CREATE TABLE IF NOT EXISTS war_battles (clan TEXT, tag TEXT, at TEXT, type TEXT, won INTEGER, lost INTEGER, PRIMARY KEY (clan, tag, at));
CREATE TABLE IF NOT EXISTS note_log (clan TEXT, week TEXT, tag TEXT, kind TEXT, value TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS race_events (clan TEXT, week TEXT, tag TEXT, at TEXT, day INTEGER, fame INTEGER, decks INTEGER, today INTEGER, boats INTEGER, PRIMARY KEY (clan, tag, at));
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
  // An empty member list means a bad reply, not an empty clan: don't record everyone as leaving.
  if (!(members.items || []).length) throw new Error('empty member list');

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
  // Every time a player's deck count goes up, keep a timestamped row: when they played, and how it went.
  if (week && day && live.length) {
    const prev = new Map((await db.prepare('SELECT tag, max(decks) AS d FROM race_events WHERE clan = ? AND week = ? GROUP BY tag').bind(clan, week).all()).results.map(r => [r.tag, r.d]));
    const moved = live.filter(p => p.decksUsed > (prev.get(clean(p.tag)) ?? 0));
    if (moved.length) sql.push(`INSERT OR IGNORE INTO race_events (clan,week,tag,at,day,fame,decks,today,boats) VALUES ${
      rows(moved.map(p => [clan, week, clean(p.tag), now, day, p.fame, p.decksUsed, p.decksUsedToday, p.boatAttacks]))}`);
  }
  if (week && day && live.length) sql.push(`INSERT OR REPLACE INTO race_days (clan,week,day,tag,name,fame,decks,today,boats,at) VALUES ${
    rows(live.map(p => [clan, week, day, clean(p.tag), p.name, p.fame, p.decksUsed, p.decksUsedToday, p.boatAttacks, now]))}`);

  // Donations and trophies, per war week (donations reset weekly in game)
  const statWeek = week || 'unknown';
  const stats = (members.items || []).map(m => [clan, statWeek, clean(m.tag), m.donations, m.donationsReceived, m.trophies, m.expLevel, now]);
  if (stats.length) sql.push(`INSERT OR REPLACE INTO member_stats (clan,week,tag,donations,received,trophies,exp,at) VALUES ${rows(stats)}`);

  // Rival clans in this race, per battle day
  if (week && day && race.clans?.length) sql.push(`INSERT OR REPLACE INTO race_standings (clan,week,day,rival,name,fame,at) VALUES ${
    rows(race.clans.map(c => [clan, week, day, clean(c.tag), c.name, c.fame, now]))}`);

  // War battles from players' battle logs (each log holds their last 25 battles).
  // A few players per run, in rotation, to stay inside the free plan's per-run limits.
  const tags = [...here].sort(), per = Number(env.BATTLELOGS_PER_RUN || 3);
  const slot = Math.floor(Date.parse(now) / (15 * 60 * 1000)) % Math.max(1, Math.ceil(tags.length / per));
  const pick = tags.slice(slot * per, slot * per + per);
  const logs = await Promise.all(pick.map(tag => cr(env, `/players/${encodeURIComponent('#' + tag)}/battlelog`).catch(() => [])));
  const battles = [];
  pick.forEach((tag, i) => { for (const b of Array.isArray(logs[i]) ? logs[i] : []) { const x = warBattle(b); if (x) battles.push([clan, tag, b.battleTime, x.type, x.won, x.lost]); } });
  if (battles.length) sql.push(`INSERT OR IGNORE INTO war_battles (clan,tag,at,type,won,lost) VALUES ${rows(battles)}`);

  if (sql.length) await db.batch(sql.map(s => db.prepare(s)));
  // For alerts: who joined/left this run, finished wars, and (on battle day 4) who can no longer reach the target.
  const TODAY_MAX = [0, 200, 400, 700, 900];
  let target = 1800, perDay = 450;
  try { const n = await db.prepare("SELECT value FROM notes WHERE clan = ? AND kind = 'rules' AND week = '*' AND tag = '*'").bind(clan).first(); if (n) { const j = JSON.parse(n.value); target = j.target || target; perDay = j.perDay || perDay; } } catch (e) {}
  let out = [];
  if (day === 4) {
    // Each player's own target, as the page works it out: excused players skipped; late joiners
    // (set by a leader, or seen joining after a battle day started) need perDay per battle day left.
    const joins = Object.fromEntries((await db.prepare("SELECT tag, value FROM notes WHERE clan = ? AND week = ? AND kind = 'join'").bind(clan, week).all()).results.map(r => [r.tag, r.value]));
    const starts = (await db.prepare("SELECT first_seen FROM periods WHERE clan = ? AND week = ? AND type != 'training' ORDER BY first_seen").bind(clan, week).all()).results.map(r => Date.parse(r.first_seen));
    const joinedAt = Object.fromEntries((await db.prepare("SELECT tag, max(at) AS at FROM member_events WHERE clan = ? AND kind = 'join' GROUP BY tag").bind(clan).all()).results.map(r => [r.tag, Date.parse(r.at)]));
    const goalFor = tag => {
      const j = joins[tag] || (() => { const t = joinedAt[tag]; if (!t || !starts.length || t < starts[0]) return 'full'; return String(starts.filter(s => s <= t).length); })();
      if (j === 'excused' || j === '4') return null;
      return !j || j === 'full' || j === 'unknown' ? target : (4 - Number(j)) * perDay;
    };
    out = live.filter(p => here.has(clean(p.tag))).filter(p => { const g = goalFor(clean(p.tag)); return g != null && p.fame + TODAY_MAX[Math.max(0, 4 - p.decksUsedToday)] < g; }).map(p => p.name);
  }
  return {
    clan, members: upserts.length, events: events.length, newWars: wars.map(w => w[1]), week, day, battlesFrom: pick, battles: battles.length,
    joined: firstRun ? [] : events.filter(e => e[3] === 'join').map(e => e[2]), left: events.filter(e => e[3] === 'leave').map(e => e[2]),
    out, target, firstRun, wars: wars.map(w => ({ week: w[1], rank: w[3], trophies: w[5] })),
    notPlayed: day ? live.filter(p => here.has(clean(p.tag)) && p.decksUsedToday === 0).map(p => p.name) : [],
    decksLeft: day ? live.filter(p => here.has(clean(p.tag))).reduce((n, p) => n + Math.max(0, 4 - p.decksUsedToday), 0) : 0,
  };
}

// A war battle from a battle log entry: duel (wins/losses counted per game), 1v1 / special mode, or boat attack.
export function warBattle(b) {
  const t = String(b.type || '');
  if (t === 'boatBattle') {
    if (b.boatBattleSide && b.boatBattleSide !== 'attacker') return null;
    return { type: 'boat', won: b.boatBattleWon ? 1 : 0, lost: b.boatBattleWon ? 0 : 1 };
  }
  if (!/^riverRace/.test(t)) return null;
  const me = b.team?.[0] || {}, op = b.opponent?.[0] || {};
  if (/Duel/.test(t)) {
    const a = me.rounds || [], o = op.rounds || [];
    if (a.length && a.length === o.length) {
      let won = 0, lost = 0;
      a.forEach((r, i) => (r.crowns > o[i].crowns ? won++ : lost++));
      return { type: 'duel', won, lost };
    }
    return { type: 'duel', won: me.crowns > op.crowns ? 1 : 0, lost: me.crowns > op.crowns ? 0 : 1 };
  }
  return { type: 'pvp', won: me.crowns > op.crowns ? 1 : 0, lost: me.crowns > op.crowns ? 0 : 1 };
}

// Battle days: every run (15 min), so each day's last snapshot is close to the reset.
// Training days: only in the hour after the daily reset (catches battle day 1 starting) and every 12 hours.
export function shouldRun({ lastType, lastRun, resetAt }, now) {
  if (!lastType || lastType !== 'training' || !lastRun) return true;
  if (now - lastRun >= 12 * 3600e3 - 60e3) return true;
  if (resetAt == null) return true;
  const day = 864e5, sinceReset = ((now - resetAt) % day + day) % day;
  return sinceReset < 3600e3;
}

const ms = s => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.parse(s); };

const ukDay = t => new Date(t).toISOString().slice(0, 10);
const list = (a, n = 6) => a.slice(0, n).map(x => String(x).replace(/<\/?c\d*>/gi, '')).join(', ') + (a.length > n ? ` +${a.length - n} more` : '');

async function alertsFor(env, r, now) {
  if (!env.DB || r.firstRun) return;
  if (r.joined.length || r.left.length) {
    const parts = [r.joined.length && `Joined: ${list(r.joined)}`, r.left.length && `Left: ${list(r.left)}`, r.members < 50 && `${50 - r.members} spot${r.members === 49 ? '' : 's'} open`].filter(Boolean);
    await sendAlert(env, r.clan, `ev:${r.clan}:${now}`, 'Clan members changed', parts.join(' · '));
  }
  for (const w of r.wars) {
    const place = w.rank > 0 ? ` · ${['1st', '2nd', '3rd', '4th', '5th'][w.rank - 1] || w.rank + 'th'} place` : '';
    await sendAlert(env, r.clan, `war:${r.clan}:${w.week}`, `War ${w.week} finished${place}`, 'Open the app to see who to act on.');
  }
  // Every battle day, in its last 4 hours: who still has decks to play.
  if (r.day && r.decksLeft) {
    const st0 = await env.DB.prepare('SELECT ended_at FROM wars WHERE clan = ? ORDER BY ended_at DESC LIMIT 1').bind(r.clan).first();
    const reset0 = st0 ? ms(st0.ended_at) : null, left0 = reset0 == null ? 864e5 : (((reset0 - now) % 864e5) + 864e5) % 864e5;
    if (left0 < 4 * 3600e3) await sendAlert(env, r.clan, `left:${r.clan}:${r.week}:${r.day}`, `Battle day ${r.day}: ${r.decksLeft} decks still unused`,
      (r.notPlayed.length ? `Not played yet: ${list(r.notPlayed)}` : 'Everyone has played at least once') + ' · under 4 hours left');
  }
  if (r.day === 4 && r.out.length) {
    const st = await env.DB.prepare('SELECT ended_at FROM wars WHERE clan = ? ORDER BY ended_at DESC LIMIT 1').bind(r.clan).first();
    const reset = st ? ms(st.ended_at) : null, dayMs = 864e5;
    const left = reset == null ? dayMs : (((reset - now) % dayMs) + dayMs) % dayMs;
    const when = left < 4 * 3600e3 ? 'late' : 'start';
    await sendAlert(env, r.clan, `d4:${r.clan}:${r.week}:${when}`, `Battle day 4: ${r.out.length} can't reach ${r.target}`,
      `${list(r.out)}${when === 'late' ? ' · under 4 hours left' : ''}`);
  }
}

export async function snapshotAll(env, { force = false, now = Date.now(), only = null } = {}) {
  const out = [];
  for (const clan of only ? [only] : trackedClans(env)) {
    try {
      if (!force) {
        await env.DB.exec(SCHEMA);
        const st = await env.DB.prepare(`SELECT
          (SELECT type FROM periods WHERE clan = ?1 ORDER BY first_seen DESC LIMIT 1) AS lastType,
          (SELECT max(updated_at) FROM members WHERE clan = ?1) AS lastRun,
          (SELECT ended_at FROM wars WHERE clan = ?1 ORDER BY ended_at DESC LIMIT 1) AS lastEnd`).bind(clan).first();
        const state = { lastType: st?.lastType, lastRun: st?.lastRun ? Date.parse(st.lastRun) : null, resetAt: st?.lastEnd ? ms(st.lastEnd) : null };
        if (!shouldRun(state, now)) { out.push({ clan, skipped: 'training day' }); continue; }
      }
      const res = await snapshot(env, clan, new Date(now).toISOString());
      out.push(res);
      await alertsFor(env, res, now).catch(() => {});
    } catch (e) {
      out.push({ clan, error: String(e.message || e) });
      // Tell leaders once every 6 hours while pulls keep failing.
      await sendAlert(env, clan, `err:${clan}:${Math.floor(now / (6 * 3600e3))}`, 'Data pull failing', `Couldn't update ${clan}: ${String(e.message || e).slice(0, 80)}. Check the Clash Royale key.`).catch(() => {});
    }
  }
  return out;
}

// On request from the page: anyone may ask, at most once every 5 minutes per clan.
export async function requestSnapshot(env, clan, isEditor, now = Date.now()) {
  await env.DB.exec(SCHEMA + '\n' + PUSH_SCHEMA);
  // Limited by the last request (successful or not) and the last successful pull, whichever is later.
  const r = await env.DB.prepare("SELECT (SELECT max(updated_at) FROM members WHERE clan = ?1) AS ok, (SELECT v FROM kv WHERE k = 'snapreq:' || ?1) AS asked").bind(clan).first();
  const last = Math.max(r?.ok ? Date.parse(r.ok) : 0, r?.asked ? Number(r.asked) : 0);
  if (!isEditor && now - last < 5 * 60e3) return { status: 429, body: { reason: 'tooSoon', lastRun: r?.ok || null, retryAfter: Math.ceil((last + 5 * 60e3 - now) / 1000) } };
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('snapreq:' + clan, String(now)).run();
  const res = await snapshotAll(env, { force: true, now, only: clan });
  return res[0]?.error ? { status: 502, body: res[0] } : { status: 200, body: res[0] };
}

export async function readHistory(env, clan) {
  const db = env.DB;
  await db.exec(SCHEMA);
  const all = s => db.prepare(s).bind(clan).all().then(r => r.results);
  const [members, events, wars, players, periods, days, notes, stats, standings, battles, noteLog, raceEvents] = await Promise.all([
    all('SELECT tag,name,role,in_clan,first_seen,last_seen_game,updated_at FROM members WHERE clan = ?'),
    all('SELECT tag,name,kind,detail,at FROM member_events WHERE clan = ? ORDER BY at'),
    all('SELECT week,ended_at,rank,fame,trophy_change FROM wars WHERE clan = ?'),
    all('SELECT week,tag,name,fame,decks,boats FROM war_players WHERE clan = ?'),
    all('SELECT week,period,type,first_seen FROM periods WHERE clan = ? ORDER BY first_seen'),
    all('SELECT week,day,tag,fame,decks,today,boats,at FROM race_days WHERE clan = ?'),
    all('SELECT week,tag,kind,value,at FROM notes WHERE clan = ?'),
    all('SELECT week,tag,donations,received,trophies,exp FROM member_stats WHERE clan = ?'),
    all('SELECT week,day,rival,name,fame FROM race_standings WHERE clan = ?'),
    all('SELECT tag,at,type,won,lost FROM war_battles WHERE clan = ?'),
    all('SELECT week,tag,kind,value,by,at FROM note_log WHERE clan = ? ORDER BY at DESC LIMIT 60'),
    all("SELECT week,tag,at,day,fame,decks,today,boats FROM race_events WHERE clan = ? AND at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-70 days')"),
  ]);
  const lastRun = members.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '') || null;
  return { clan, lastRun, members, events, wars, players, periods, days, notes, stats, standings, battles, noteLog, raceEvents };
}

const NOTE_KINDS = ['join', 'over', 'result', 'rules', 'done'];

export async function writeNotes(env, clan, items, now = new Date().toISOString(), by = null) {
  const ok = (items || []).filter(i => i && NOTE_KINDS.includes(i.kind) && typeof i.week === 'string' && typeof i.tag === 'string'
    && i.week.length < 20 && i.tag.length < 20 && (i.value == null || String(i.value).length < 4000)).slice(0, 200);
  const put = ok.filter(i => i.value != null).map(i => [clan, i.week, clean(i.tag) || '*', i.kind, String(i.value), now]);
  const del = ok.filter(i => i.value == null);
  const sql = [];
  if (put.length) sql.push(`INSERT OR REPLACE INTO notes (clan,week,tag,kind,value,at) VALUES ${rows(put)}`);
  // Who changed what (results are saved automatically, so they're left out of the log).
  const logged = ok.filter(i => i.kind !== 'result').map(i => [clan, i.week, clean(i.tag) || '*', i.kind, i.value == null ? null : String(i.value), by, now]);
  if (logged.length) sql.push(`INSERT INTO note_log (clan,week,tag,kind,value,by,at) VALUES ${rows(logged)}`);
  if (del.length) sql.push(`DELETE FROM notes WHERE clan = ${q(clan)} AND (${del.map(i => `(week = ${q(i.week)} AND tag = ${q(clean(i.tag) || '*')} AND kind = ${q(i.kind)})`).join(' OR ')})`);
  await env.DB.exec(SCHEMA);
  if (sql.length) await env.DB.batch(sql.map(s => env.DB.prepare(s)));
  return { saved: put.length, removed: del.length, by };
}
