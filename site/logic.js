// ---- Pure logic (no DOM). Tested by tests/check.mjs ----

const DEFAULT_RULES = {
  target: 1800,      // medals per full week
  perDay: 450,       // per battle day left, for late joiners
  effortNet: true,   // late joiner passes if they used every deck they could
  demoteElders: true,
  elderWarnFirst: true,  // elders get a warning before demotion
  boatRepeatKick: true,  // boat attackers still under after a warning are kicked
  spareBoats: true,  // active boat users get a warning, not a kick
  boatShare: 50,     // % of decks on boats to count as a boat user
  holdWeeks: 3,      // passed this many wars in a row before...
  holdOffline: 3,    // ...and offline this many days -> check in
  promoWeeks: 6,     // weeks in clan
  promoMisses: 1,    // max misses in that time
  promoAvg: 2200,    // average medals
  chatLimit: 256,    // measured in game with a numbered ruler: clan chat keeps 256 characters
  lookback: 10,      // weeks used for history stats
};

// War medal values (Clan Wars 2)
const MEDALS = { duelWin: 250, winPvp: 200, loss: 100, boatWin: 125, boatLoss: 75 };
// Most medals still possible today, by decks left today (duel needs 3+ decks)
const TODAY_MAX = { 0: 0, 1: 200, 2: 400, 3: 700, 4: 900 };

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function detect(rows) {
  if (!rows.length) return null;
  const c = Object.keys(rows[0]);
  if (c.includes('role') && c.includes('lastSeen')) return 'roster';
  if (c.includes('season_key') && c.includes('player_fame')) return 'log';
  if (c.includes('player_decks_used_today')) return 'race';
  if (c.includes('player_is_current_member')) return 'history';
  return null;
}

const cleanTag = t => String(t || '').replace(/^#/, '').toUpperCase();
// In-game colour codes in names, e.g. "<c4>Baki" (shown in game as a coloured name).
const cleanName = n => String(n ?? '').replace(/<\/?c\d*>/gi, '');
const keyParts = k => String(k).split('-').map(Number);
const cmpKey = (a, b) => { const [x1, y1] = keyParts(a), [x2, y2] = keyParts(b); return x1 - x2 || y1 - y2; };

function parseTime(s) {
  // RoyaleAPI: 20261116T123806.000Z
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (m) return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const t = Date.parse(s); return isNaN(t) ? null : t;
}

// History export (wide) -> log-style rows. No boat data in this file.
function historyToLog(rows) {
  const out = [];
  for (const r of rows) {
    for (const col of Object.keys(r)) {
      const m = col.match(/^s_(\d+-\d+)_fame$/);
      if (!m) continue;
      const k = m[1], fame = +r[col] || 0, decks = +r[`s_${k}_decks_used`] || 0;
      if (!fame && !decks) continue; // can't tell "absent" from "0" here
      out.push({ season_key: k, player_tag: r.player_tag, player_name: r.player_name,
        player_fame: fame, player_decks_used: decks, player_boat_attacks: '', clan_tag: r.clan_tag, clan_name: r.clan_name });
    }
  }
  return out;
}

// opts.season: which finished war to audit (default latest). opts.withGone: include that war's players who have since left.
function build({ roster = [], log = [], race = [], history = [] }, opts = {}) {
  if (!log.length && history.length) log = historyToLog(history);
  const seasons = [...new Set(log.map(r => r.season_key))].sort(cmpKey).reverse();
  const idx = opts.season ? Math.max(0, seasons.indexOf(opts.season)) : 0;
  const season = seasons[idx] || null;
  const prevSeason = seasons[idx + 1] || null;
  const any = log[0] || race[0] || {};
  const clan = { tag: cleanTag(any.clan_tag), name: any.clan_name || '' };

  const weeksBy = {};
  for (const r of log) {
    const t = cleanTag(r.player_tag);
    (weeksBy[t] ||= []).push({ key: r.season_key, fame: +r.player_fame || 0, decks: +r.player_decks_used || 0,
      boats: r.player_boat_attacks === '' ? null : +r.player_boat_attacks || 0, name: r.player_name });
  }
  for (const t in weeksBy) weeksBy[t].sort((a, b) => cmpKey(b.key, a.key));
  const raceBy = Object.fromEntries(race.map(r => [cleanTag(r.player_tag), r]));

  const seen = roster.map(r => parseTime(r.lastSeen)).filter(Boolean);
  const ref = seen.length ? Math.max(...seen) : Date.now();

  let base = roster.length
    ? roster.map(r => ({ tag: cleanTag(r.tag), name: cleanName(r.name), role: r.role || 'member', lastSeen: parseTime(r.lastSeen),
        donations: r.donations === '' || r.donations == null ? null : +r.donations, received: r.donationsReceived === '' || r.donationsReceived == null ? null : +r.donationsReceived }))
    : Object.keys(raceBy).length
      ? Object.values(raceBy).map(r => ({ tag: cleanTag(r.player_tag), name: cleanName(r.player_name), role: 'member', lastSeen: null }))
      : [];
  if (opts.withGone && season) {
    const here = new Set(base.map(p => p.tag));
    for (const r of log) if (r.season_key === season && !here.has(cleanTag(r.player_tag))) {
      here.add(cleanTag(r.player_tag));
      base.push({ tag: cleanTag(r.player_tag), name: cleanName(r.player_name), role: 'member', lastSeen: null, gone: true });
    }
  }

  const players = base.map(p => {
    const weeks = (weeksBy[p.tag] || []).filter(w => !season || cmpKey(w.key, season) <= 0);
    const cur = weeks.find(w => w.key === season) || null;
    const before = weeks.filter(w => w.key !== season);
    const rr = raceBy[p.tag];
    return {
      ...p,
      offlineDays: p.lastSeen ? (ref - p.lastSeen) / 864e5 : null,
      weeks, cur, before,
      prev: before.find(w => w.key === prevSeason) || null,
      isNew: !before.length,
      race: rr ? { fame: +rr.player_fame || 0, decks: +rr.player_decks_used || 0, today: +rr.player_decks_used_today || 0,
        boats: +rr.player_boat_attacks || 0 } : null,
    };
  });
  return { clan, season, prevSeason, seasons, latest: seasons[0] || null, ref, players, hasBoats: log.some(r => r.player_boat_attacks !== '') };
}

// join: 'full' | '1' | '2' | '3' | '4' | 'excused'  (battle day they joined on)
function targetFor(join, r) {
  if (join === 'excused' || join === '4') return { medals: 0, decks: 0, excused: true };
  if (!join || join === 'full' || join === 'unknown') return { medals: r.target, decks: 16, late: false };
  const left = 4 - Number(join);
  return { medals: left * r.perDay, decks: left * 4, late: true };
}

function streakBefore(p, r) {
  let n = 0;
  for (const w of p.before) { if (w.fame >= r.target) n++; else break; }
  return n;
}

function boatSwap(w) {
  // Only exact when every deck was a boat attack.
  if (!w || w.boats == null || !w.boats || w.boats !== w.decks) return null;
  const wins = Math.max(0, Math.min(w.boats, Math.round((w.fame - MEDALS.boatLoss * w.boats) / (MEDALS.boatWin - MEDALS.boatLoss))));
  const losses = w.boats - wins;
  return { wins, losses, pvp: wins * MEDALS.winPvp + losses * MEDALS.loss };
}

const recent = (p, r) => p.weeks.slice(0, (r && r.lookback) || 10);
function missCount(p, r) { return recent(p, r).filter(w => w.fame < r.target).length; }
function avgMedals(p, r) { const w = recent(p, r); return w.length ? Math.round(w.reduce((s, x) => s + x.fame, 0) / w.length) : 0; }

function judgeEnd(p, r, join, override) {
  const t = targetFor(join, r);
  const w = p.cur;
  const out = (status, why) => ({ status, why, target: t.medals });
  const boatPct = w && w.decks && w.boats != null ? Math.round(100 * w.boats / w.decks) : 0;
  const isBoater = r.spareBoats && boatPct >= r.boatShare && w.decks >= 8;

  let res;
  if (!w) res = out('Excused', 'Not in this war');
  else if (t.excused) res = out('Excused', 'Excused by a leader');
  else if (w.fame >= t.medals || (t.late && r.effortNet && w.decks >= t.decks)) {
    const n = recent(p, r).length, miss = missCount(p, r), avg = avgMedals(p, r);
    if ((p.roleNow || p.role) === 'member' && n >= r.promoWeeks && miss <= r.promoMisses && avg >= r.promoAvg && boatPct < r.boatShare)
      res = out('Promote', `Reached ${r.target}+ in ${n - miss} of ${n} wars, average ${avg}`);
    else res = out('OK', t.late ? `Joined late, needed ${t.medals}` : '');
    if (boatPct >= 25) res.why = [res.why, `${boatPct}% of decks on boats`].filter(Boolean).join(' · ');
  } else {
    const streak = streakBefore(p, r);
    if (streak >= r.holdWeeks && p.offlineDays != null && p.offlineDays >= r.holdOffline)
      res = out('Check', `Offline ${Math.floor(p.offlineDays)} days, but reached ${r.target}+ the ${streak} wars before`);
    else if (p.role === 'leader' || p.role === 'coLeader') res = out('Review', `Leader or co-leader under ${r.target}`);
    else if (p.role === 'elder' && r.demoteElders) res = !r.elderWarnFirst || (p.prev && p.prev.fame < r.target) || p.lastResult === 'Warn'
      ? out('Demote', r.elderWarnFirst ? 'Elder, second miss in a row' : `Elder under ${r.target}`) : out('Warn', 'Elder, first miss');
    else if (p.lastResult === 'Warn' && !(isBoater && !r.boatRepeatKick)) res = out('Kick', 'Under again after their first & only warning');
    else if (isBoater) {
      // Boat attackers: a first & only warning; if they were warned (or under on boats) last war and still are, kick.
      const prevBoats = p.prev && p.prev.decks && p.prev.boats != null && 100 * p.prev.boats / p.prev.decks >= r.boatShare;
      const ignored = r.boatRepeatKick && p.lastResult == null && p.prev && p.prev.fame < r.target && prevBoats;
      res = ignored ? out('Kick', `Still on boats after last war's tip (${boatPct}% of decks), under again`)
        : out('Warn', `${p.isNew ? 'New, ' : 'Played, but '}${boatPct}% of decks on boats`);
    }
    else if (p.isNew && join === 'unknown') res = out('Review', `New member, under ${r.target}: set when they joined`);
    else if (p.isNew) res = out('Kick', `New member, under ${r.target}`);
    else if (p.prev && p.prev.fame < r.target) res = out('Kick', 'Second miss in a row');
    else if (!p.prev) res = out('Review', `Back after leaving, under ${r.target}`);
    else res = out('Warn', 'First miss');
  }
  if (w && p.days) {
    const missed = p.days.map((d, i) => d === 0 ? i + 1 : null).filter(Boolean);
    if (missed.length && missed.length < 4) res.why = [res.why, 'No decks on battle day ' + missed.join(', ')].filter(Boolean).join(' · ');
  }
  res.auto = res.status;
  if (override && override !== 'Auto') { res.status = override; res.why = 'Changed by a leader' + (res.why ? ' · ' + res.why : ''); }
  res.boatPct = boatPct;
  return res;
}

function judgeLive(p, r, join, day) {
  const t = targetFor(join, r);
  const x = p.race || { fame: 0, decks: 0, today: 0 };
  const leftToday = Math.max(0, 4 - x.today);
  const max = TODAY_MAX[leftToday] + 900 * Math.max(0, 4 - day);
  const need = Math.max(0, t.medals - x.fame);
  let status;
  if (t.excused) status = 'Excused';
  else if (!need) status = 'Safe';
  else if (need > max) status = 'Out';
  else status = 'Need';
  return { status, need, max, leftToday, fame: x.fame, today: x.today, target: t.medals,
    why: status === 'Out' && x.today === 0 ? 'No decks used today (kick frees a slot)' : '' };
}

function guessDay(players) {
  const most = Math.max(0, ...players.map(p => (p.race ? p.race.decks : 0)));
  return Math.min(4, Math.max(1, Math.ceil(most / 4)));
}

function lines(title, items) { return items.length ? `${title}\n${items.map(s => '- ' + s).join('\n')}` : ''; }

// Split into chat-sized parts on line breaks.
function split(text, limit) {
  if (text.length <= limit) return [text];
  const parts = []; let cur = '';
  for (const ln of text.split('\n')) {
    const next = cur ? cur + '\n' + ln : ln;
    if (next.length > limit && cur) { parts.push(cur.trim()); cur = ln; } else cur = next;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function chatEnd(list, r) {
  const by = s => list.filter(x => x.res.status === s);
  const msgs = [];
  const update = [
    'War update:',
    lines('Kicked:', by('Kick').map(x => x.name)),
    lines('Demoted:', by('Demote').map(x => x.name)),
    lines('Promoted to Elder:', by('Promote').map(x => x.name)),
  ].filter(Boolean);
  if (update.length > 1) msgs.push({ title: 'Update', text: update.join('\n\n') });

  const warn = by('Warn');
  if (warn.length) {
    const rows = warn.map(x => ({ x, n: recent(x, r).length, m: missCount(x, r) }))
      .sort((a, b) => b.m - a.m || b.m / b.n - a.m / a.n)
      .map(({ x, n, m }) => `${x.name}: under in ${m} of ${n} wars`);
    msgs.push({ title: 'Warnings', text: lines(`First & only warnings (need ${r.target}+ next war):`, rows) });
  }

  const boats = list.map(x => ({ x, s: boatSwap(x.cur) })).filter(o => o.s && o.s.pvp > o.x.cur.fame);
  if (boats.length) {
    msgs.push({ title: 'Boats', text: 'Switch boats to duels (best) or 1v1! Same wins would have got you:\n'
      + boats.map(o => `- ${o.x.name}: ${o.x.cur.fame} to ${o.s.pvp}+`).join('\n') });
  }

  const promo = by('Promote');
  if (promo.length) msgs.push({ title: 'Promotions', text: lines(`Congrats to our new Elder${promo.length === 1 ? '' : 's'} 🎉`, promo.map(x => x.name)) + `\nThanks for hitting ${r.target}+ week after week! ⭐` });

  const check = by('Check');
  if (check.length) {
    msgs.push({ title: 'Check in', text: lines(`Holding ${check.length === 1 ? 'a spot' : 'spots'} for:`,
      check.map(x => x.offlineDays != null ? `${x.name} (offline ${Math.floor(x.offlineDays)} days)` : x.name))
      + `\n${check.length === 1 ? "Hope you're ok!" : "Hope you're all ok!"}` });
  }
  return msgs.flatMap(m => split(m.text, r.chatLimit).map((t, i, a) => ({ title: a.length > 1 ? `${m.title} ${i + 1}/${a.length}` : m.title, text: t })));
}

function chatLive(list, r) {
  const out = list.filter(x => x.res.status === 'Out');
  const close = list.filter(x => x.res.status === 'Need').sort((a, b) => b.res.need - a.res.need);
  const msgs = [];
  if (out.length) msgs.push({ title: 'Out', text: lines(`Can't reach ${r.target} now:`, out.map(x => `${x.name} (${x.res.fame})`)) });
  if (close.length) msgs.push({ title: 'Still need', text: lines('Still need:', close.map(x => `${x.name}: +${x.res.need}`)) });
  return msgs.flatMap(m => split(m.text, r.chatLimit).map((t, i, a) => ({ title: a.length > 1 ? `${m.title} ${i + 1}/${a.length}` : m.title, text: t })));
}


// ---- Official API (via a CORS-friendly proxy) -> same row shapes as the CSVs ----
const VALID_TAG = /^[0289PYLQGRJCUV]{3,12}$/;

function apiToRows({ clan, members, race, log }) {
  const ct = cleanTag(clan?.tag || race?.clan?.tag), cn = clan?.name || race?.clan?.name || '';
  const roster = (members?.items || []).map(m => ({ tag: m.tag, name: m.name, role: m.role, lastSeen: m.lastSeen, donations: m.donations, donationsReceived: m.donationsReceived }));
  const raceRows = (race?.clan?.participants || []).map(x => ({
    clan_tag: ct, clan_name: cn, player_tag: x.tag, player_name: x.name, player_fame: x.fame,
    player_boat_attacks: x.boatAttacks, player_decks_used: x.decksUsed, player_decks_used_today: x.decksUsedToday }));
  const logRows = [];
  for (const wk of log?.items || []) {
    const st = (wk.standings || []).find(s => cleanTag(s.clan.tag) === ct);
    if (!st) continue;
    const key = `${wk.seasonId}-${wk.sectionIndex + 1}`;
    for (const x of st.clan.participants || []) logRows.push({
      season_key: key, clan_tag: ct, clan_name: cn, player_tag: x.tag, player_name: x.name,
      player_fame: x.fame, player_decks_used: x.decksUsed, player_boat_attacks: x.boatAttacks });
  }
  const last = (log?.items || [])[0];
  const raceWeek = race && last ? `${race.sectionIndex > last.sectionIndex ? last.seasonId : last.seasonId + 1}-${race.sectionIndex + 1}` : null;
  const standings = (race?.clans || []).map(c => ({ tag: cleanTag(c.tag), name: c.name, fame: c.fame || 0 })).sort((a, b) => b.fame - a.fame);
  return { roster, race: raceRows, log: logRows, raceWeek, raceDay: raceDay(race), racePeriod: race?.periodType || null, standings };
}

// periodIndex: 0-2 training, 3-6 battle days 1-4 (repeats each week)
function raceDay(race) {
  if (!race || !['warDay', 'colosseum'].includes(race.periodType)) return 0;
  return Math.min(4, Math.max(1, (race.periodIndex % 7) - 2));
}

// ---- History from the site's /api/history ----
const ms = s => parseTime(s);

function historyLogRows(h) {
  return (h.players || []).map(p => ({ season_key: p.week, clan_tag: h.clan, clan_name: '', player_tag: p.tag, player_name: p.name,
    player_fame: p.fame, player_decks_used: p.decks, player_boat_attacks: p.boats }));
}
function mergeLog(primary, extra) {
  const have = new Set(primary.map(r => r.season_key));
  return primary.concat(extra.filter(r => !have.has(r.season_key)));
}
function battleStarts(h, week) {
  return (h.periods || []).filter(x => x.week === week && x.type !== 'training').map(x => ms(x.first_seen)).sort((a, b) => a - b);
}
// Battle day a player joined on during `week`: 'full' (before battles), '1'-'4', or null if unknown.
function autoJoin(h, week, tag) {
  const all = (h.periods || []).filter(x => x.week === week).map(x => ms(x.first_seen));
  if (!all.length) return null;
  const starts = battleStarts(h, week);
  const war = (h.wars || []).find(x => x.week === week);
  const from = Math.min(...all), to = war ? ms(war.ended_at) : Infinity;
  const joins = (h.events || []).filter(e => e.tag === tag && e.kind === 'join').map(e => ms(e.at)).filter(t => t >= from && t <= to);
  if (!joins.length) return null;
  const j = joins[joins.length - 1];
  const day = starts.filter(t => t <= j).length;
  return day ? String(day) : 'full';
}
function roleAt(h, tag, role, t) {
  const later = (h.events || []).filter(e => e.tag === tag && e.kind === 'role' && ms(e.at) > t).sort((a, b) => ms(b.at) - ms(a.at));
  for (const e of later) role = String(e.detail).split('>')[0];
  return role;
}
function dayDecks(h, week, tag) {
  const rows = (h.days || []).filter(d => d.week === week && d.tag === tag);
  if (!rows.length) return null;
  const out = [null, null, null, null];
  for (const d of rows) out[d.day - 1] = d.today;
  return out;
}
function joinedAt(h, tag) {
  const e = (h.events || []).filter(x => x.tag === tag && (x.kind === 'join' || x.kind === 'seen'));
  return e.length ? { at: ms(e[e.length - 1].at), seen: e[e.length - 1].kind === 'seen' } : null;
}
function notesMap(h) {
  const m = {};
  for (const n of h.notes || []) m[`${n.kind}|${n.week}|${n.tag}`] = n.value;
  return m;
}
// Adds history facts to players: role at war end, auto join day, decks per day, last saved result.
function applyHistory(model, h, liveWeek) {
  if (!h) return model;
  const notes = notesMap(h);
  const war = (h.wars || []).find(x => x.week === model.season);
  for (const p of model.players) {
    p.roleNow = p.role;
    if (war) p.role = roleAt(h, p.tag, p.role, ms(war.ended_at));
    p.autoJoin = model.season ? autoJoin(h, model.season, p.tag) : null;
    p.autoJoinLive = liveWeek ? autoJoin(h, liveWeek, p.tag) : null;
    p.days = model.season ? dayDecks(h, model.season, p.tag) : null;
    p.daysLive = liveWeek ? dayDecks(h, liveWeek, p.tag) : null;
    p.joined = joinedAt(h, p.tag);
    const prevRes = model.prevSeason ? notes[`result|${model.prevSeason}|${p.tag}`] || null : null;
    // A first & only warning only counts if a leader marked it as posted.
    p.lastResult = prevRes === 'Warn' && notes[`done|${model.prevSeason}|${p.tag}`] !== '1' ? 'WarnNotPosted' : prevRes;
    p.roleEvents = (h.events || []).filter(e => e.tag === p.tag && e.kind === 'role').map(e => ({ at: ms(e.at), detail: String(e.detail) }));
    const left = (h.events || []).filter(e => e.tag === p.tag && e.kind === 'leave').map(e => ms(e.at));
    p.leftAt = left.length ? Math.max(...left) : null;
  }
  model.endedAt = war ? ms(war.ended_at) : null;
  // War battles grouped by war week: a battle belongs to the first war that ended after it.
  const ends = (h.wars || []).map(w => [w.week, ms(w.ended_at)]).filter(x => x[1]).sort((a, b) => a[1] - b[1]);
  const weekOfBattle = t => (ends.find(e => t <= e[1]) || [liveWeek || 'current'])[0];
  const byTag = {};
  for (const b of h.battles || []) {
    const wk = weekOfBattle(ms(b.at)), x = ((byTag[b.tag] ||= {})[wk] ||= { duel: [0, 0], pvp: [0, 0], boat: [0, 0] });
    if (x[b.type]) { x[b.type][0] += b.won; x[b.type][1] += b.lost; }
  }
  for (const p of model.players) p.battles = byTag[p.tag] || null;
  const real = (h.events || []).filter(e => e.kind !== 'seen');
  model.history = {
    since: (h.events || []).length ? Math.min(...h.events.map(e => ms(e.at))) : null,
    weeks: (h.wars || []).length,
    events: real.slice(-30).reverse(),
    notes,
    saved: !!model.season && Object.keys(notes).some(k => k.startsWith(`result|${model.season}|`)),
  };
  return model;
}

// Was the action already carried out in game? (left the clan, or role changed after the war ended)
function autoDone(p, status, endMs) {
  if (status === 'Kick') return !!p.gone;
  const after = (p.roleEvents || []).filter(e => !endMs || e.at > endMs).map(e => e.detail);
  if (status === 'Demote') return after.some(d => /^(elder>member|coLeader>(elder|member))$/.test(d));
  if (status === 'Promote') return after.some(d => /^member>(elder|coLeader)$/.test(d));
  return false;
}

function battleText(x) {
  if (!x) return '';
  const part = (k, l) => x[k][0] + x[k][1] ? `${l} ${x[k][0]}W–${x[k][1]}L` : '';
  return [part('duel', 'Duels'), part('pvp', '1v1'), part('boat', 'Boats')].filter(Boolean).join(' · ');
}

if (typeof module !== 'undefined') module.exports = { cleanName, battleText, autoDone, historyLogRows, mergeLog, autoJoin, roleAt, dayDecks, applyHistory, recent, apiToRows, raceDay, VALID_TAG, missCount, avgMedals, DEFAULT_RULES, parseCSV, detect, build, judgeEnd, judgeLive, guessDay, chatEnd, chatLive, boatSwap, split, targetFor };
