// ---- Pure logic (no DOM). Tested by tests/check.mjs ----

const DEFAULT_RULES = {
  target: 1800,      // medals per full week
  perDay: 450,       // per battle day left, for late joiners
  effortNet: true,   // late joiner passes if they used every deck they could
  demoteElders: true,
  elderWarnFirst: true,  // elders get a warning before demotion
  boatRepeatKick: true,  // boat attackers still under after a warning are kicked
  warnClear: 3,      // a first & only warning clears after this many wars in a row at the target
  linkBonus: true,   // members linked on Discord get one extra chance (a final warning) before a kick
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

// What each rule means and the values that make sense, used to build the Rules screen and to
// correct anything out of range (a typo, an old saved value) before it reaches the decisions.
//   Medal limits: 3,600 is the most possible in a war (4 days x 900); 1,600 is losing all 16 decks.
//   Chat: the game keeps 256 characters. History: the page loads the last 26 wars.
const RULE_SPEC = {
  target:         { group: 'Target', label: 'Medals needed each war', min: 400, max: 3600, step: 50, unit: 'medals' },
  perDay:         { group: 'Late joiners', label: 'Medals per battle day left after joining', min: 100, max: 900, step: 50, unit: 'medals' },
  effortNet:      { group: 'Late joiners', label: 'Pass anyway if they used every deck they could' },
  warnClear:      { group: 'Warnings', label: 'A warning clears after this many wars in a row at the target', min: 1, max: 10, step: 1, unit: 'wars' },
  demoteElders:   { group: 'Warnings', label: 'Elders who miss are demoted, not kicked' },
  elderWarnFirst: { group: 'Warnings', label: 'Elders get a first & only warning before demotion' },
  linkBonus:      { group: 'Warnings', label: 'Members linked on Discord get one extra chance before a kick (a final warning)' },
  spareBoats:     { group: 'Boat attackers', label: 'Mostly-boat players get a warning and a tip, not a kick' },
  boatShare:      { group: 'Boat attackers', label: 'Counts as a boat attacker from this share of decks on boats', min: 10, max: 100, step: 5, unit: '%' },
  boatRepeatKick: { group: 'Boat attackers', label: 'Kick if still under on boats after the warning' },
  holdWeeks:      { group: 'Check on them', label: 'Hold their spot if they reached the target this many wars in a row before', min: 1, max: 10, step: 1, unit: 'wars' },
  holdOffline:    { group: 'Check on them', label: '…and have been offline at least', min: 1, max: 14, step: 1, unit: 'days' },
  promoWeeks:     { group: 'Promotions', label: 'Wars in the clan', min: 2, max: 26, step: 1, unit: 'wars' },
  promoMisses:    { group: 'Promotions', label: 'Most misses allowed in that time', min: 0, max: 5, step: 1, unit: 'misses' },
  promoAvg:       { group: 'Promotions', label: 'Average medals', min: 400, max: 3600, step: 50, unit: 'medals' },
  chatLimit:      { group: 'Messages and history', label: 'Clan chat message length', min: 50, max: 256, step: 1, unit: 'characters' },
  lookback:       { group: 'Messages and history', label: 'Recent wars used for history and stats', min: 3, max: 26, step: 1, unit: 'wars' },
};

// Corrects out-of-range or non-numeric values; returns the rules and what was changed.
function sanitizeRules(r) {
  const out = { ...DEFAULT_RULES, ...r }, fixed = [];
  for (const [k, spec] of Object.entries(RULE_SPEC)) {
    if (typeof DEFAULT_RULES[k] === 'boolean') { if (typeof out[k] !== 'boolean') { out[k] = DEFAULT_RULES[k]; fixed.push(k); } continue; }
    let v = Number(out[k]);
    if (!Number.isFinite(v)) v = DEFAULT_RULES[k];
    const c = Math.min(spec.max, Math.max(spec.min, Math.round(v / spec.step) * spec.step));
    if (c !== out[k]) fixed.push(k);
    out[k] = c;
  }
  return { rules: out, fixed };
}

// Combinations that can't work as intended.
function ruleProblems(r) {
  const p = [];
  if (r.promoWeeks > r.lookback) p.push(`Promotions need ${r.promoWeeks} wars, but only ${r.lookback} recent wars are used, so nobody can be promoted. Raise the wars used or lower the wars needed.`);
  if (r.holdWeeks > r.lookback) p.push(`Check-ins need ${r.holdWeeks} wars in a row, more than the ${r.lookback} recent wars used.`);
  if (r.perDay * 3 > r.target) p.push(`Someone joining on battle day 1 would need ${r.perDay * 3} medals, more than the full-war target of ${r.target}.`);
  if (r.promoAvg < r.target) p.push(`The promotion average (${r.promoAvg}) is below the war target (${r.target}).`);
  return p;
}

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
const _keyNum = new Map();   // "138-2" -> 138002, cached: compared thousands of times when sorting
const keyNum = k => { let v = _keyNum.get(k); if (v === undefined) { const [x, y] = keyParts(k); v = x * 1000 + (y || 0); _keyNum.set(k, v); } return v; };
const cmpKey = (a, b) => keyNum(a) - keyNum(b);

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

// Is a first & only warning still active for this war?
//   warnedIn: the latest war before this one where a leader posted (ticked) a warning for them.
//   It clears once they reach the target r.warnClear wars in a row after it.
function warnState(p, r, since = p.warnedIn) {
  if (!since) return null;
  const after = p.before.filter(w => cmpKey(w.key, since) > 0).sort((a, b) => cmpKey(a.key, b.key));
  let run = 0, cleared = false;
  for (const w of after) { run = w.fame >= r.target ? run + 1 : 0; if (run >= r.warnClear) { cleared = true; break; } }
  return { week: since, active: !cleared, run };
}

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
    const streak = streakBefore(p, r), warned = warnState(p, r)?.active;
    if (p.awayWar) res = out('Review', `Said they'd be away ${awayText(p.awayWar)}`);
    else if (streak >= r.holdWeeks && p.offlineDays != null && p.offlineDays >= r.holdOffline)
      res = out('Check', `Offline ${Math.floor(p.offlineDays)} days, but reached ${r.target}+ the ${streak} wars before`);
    else if (p.role === 'leader' || p.role === 'coLeader') res = out('Review', `Leader or co-leader under ${r.target}`);
    else if (p.role === 'elder' && r.demoteElders) res = !r.elderWarnFirst || (p.prev && p.prev.fame < r.target) || warned
      ? out('Demote', warned ? `Elder, under again while on a warning (from war ${p.warnedIn})` : r.elderWarnFirst ? 'Elder, second miss in a row' : `Elder under ${r.target}`) : out('Warn', 'Elder, first miss');
    else if (warned && !(isBoater && !r.boatRepeatKick)) res = out('Kick', `Under again while on a first & only warning (from war ${p.warnedIn})`);
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
  // Linked on Discord: one extra chance. A kick becomes a final warning, once; it counts as used when the leaders
  // post it (tick it done), and comes back after they clear it like a warning (warnClear wars in a row at the target).
  if (res.status === 'Kick' && r.linkBonus && p.linked && !p.gone && !warnState(p, r, p.extraIn)?.active) {
    res = { ...out('Warn', `Final warning: linked on Discord, so one extra chance before a kick (${res.why.charAt(0).toLowerCase() + res.why.slice(1)})`), extra: true };
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

// In-game clan description (128 characters), from the rules: several versions, most detail first, all that fit.
// Avoids "=" and ">" (the game's font draws them like ":" and ")"). `extra` (e.g. "Discord: abc") is added where it fits.
function clanDescriptions(r, extra = '', limit = 128) {
  const T = r.target, A = r.promoAvg, W = r.promoWeeks, x = String(extra || '').trim();
  const kick = r.demoteElders ? 'kick (Elders demoted)' : 'kick';
  const base = [
    `⚔️ ${T}+ medals every war. Miss once: warning. Miss again: ${kick}. Elder: ${W} wars, avg ${A}+. Away? Tell a leader!`,
    `⚔️ ${T}+ medals every war. Miss once: warning, again: kick. Elder: ${W} wars, avg ${A}+. Away? Tell a leader!`,
    `⚔️ ${T}+ medals every war! 1 miss: warning. 2: kick. Elder: avg ${A}+ over ${W} wars. Away? Tell us.`,
    `⚔️ War clan: ${T}+ medals every war. 1 miss: warning, 2: kick. Elder at avg ${A}+.`,
    `⚔️ ${T}+ war medals every week. 1 miss: warning, 2: kick.`,
  ];
  const out = [];
  for (const b of base) {
    const t = x && (b + ' ' + x).length <= limit ? b + ' ' + x : b;
    if (t.length <= limit && !/[=>]/.test(t) && !out.includes(t)) out.push(t);
  }
  if (x && !out.some(t => t.includes(x))) { const t = `⚔️ ${T}+ medals every war. ${x}`; if (t.length <= limit) out.push(t); }
  return out.slice(0, 4);
}

// One player's after-war result, as the leaders' page shows it (the Discord bot uses the same).
//   note(kind, tag): the shared choice for this war; past: looking back at an older war; fmt: date format.
const ACTIONS = ['Kick', 'Demote', 'Warn', 'Check', 'Review', 'Promote'];
const AUTO_CHECKED = ['Kick', 'Demote', 'Promote'];   // the game shows these; no manual tick
function endResult(p, model, r, note, past, fmt = ukDay) {
  const manual = note('join', p.tag), auto = p.autoJoin;
  const join = manual || auto || (p.isNew && !p.gone ? 'unknown' : 'full');
  const saved = past ? note('result', p.tag) : null;
  const res = judgeEnd(p, r, join, note('over', p.tag) || saved);
  if (saved && !note('over', p.tag)) res.why = res.why.replace(/^Changed by a leader/, 'Saved result');
  // Gone: counts as a kick only if they left after the war ended (seen by the tracker); otherwise they just left.
  // (From the start of the last battle day: leaders often act on day 4.)
  const from = model.endedAt ? model.endedAt - 864e5 : null;
  const keptAfterWar = p.gone && p.leftAt && from && p.leftAt > from;
  if (p.gone && !(res.status === 'Kick' && keptAfterWar)) { res.before = { status: res.status, why: res.why }; res.status = 'Left'; res.why = p.leftAt ? 'Left ' + fmt(p.leftAt) : 'Left during or before this war'; }
  // A promotion or demotion seen in game after this war counts as this war's action, whatever was suggested.
  if (!p.gone && from) {
    const after = (p.roleEvents || []).filter(e => e.at > from).map(e => e.detail);
    const promoted = after.some(d => /^member>(elder|coLeader)$/.test(d)), demoted = after.some(d => /^(elder>member|coLeader>(elder|member))$/.test(d));
    if (promoted && res.status !== 'Promote') { res.status = 'Promote'; res.why = 'Promoted after this war'; }
    if (demoted && res.status !== 'Demote') { res.status = 'Demote'; res.why = 'Demoted after this war'; }
  }
  const done = ACTIONS.includes(res.status)
    ? { auto: autoDone(p, res.status, model.endedAt && model.endedAt - 864e5), manual: !AUTO_CHECKED.includes(res.status) && note('done', p.tag) === '1' } : null;
  return { join, joinAuto: !manual && !!auto, res, done };
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
    why: p.awayLive && status !== 'Safe' ? `Away ${awayText(p.awayLive)}` : status === 'Out' && x.today === 0 ? 'No decks used today (kick frees a slot)' : '' };
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
    if (next.length > limit && cur) {
      // Keep a heading ("Promoted to Elder:") and blank lines with the list that follows it.
      const ls = cur.split('\n'); let carry = [];
      while (ls.length > 1 && (/:\s*$/.test(ls[ls.length - 1]) || !ls[ls.length - 1].trim())) carry.unshift(ls.pop());
      parts.push(ls.join('\n').trim()); cur = [...carry.filter(l => l.trim()), ln].join('\n');
    } else cur = next;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// A short reason for the clan chat, e.g. "1,350, 2nd miss in a row" or "10/10 wars at 1800+, avg 2,270".
function shortReason(x, r) {
  const fame = x.cur ? x.cur.fame.toLocaleString('en-GB') : '', why = x.res.why || '', s = x.res.status;
  if (s === 'Promote') {
    const n = recent(x, r).length, m = missCount(x, r);
    return n ? `${n - m}/${n} wars ${r.target}+, avg ${avgMedals(x, r).toLocaleString('en-GB')}` : '';
  }
  const reason = /warning/i.test(why) ? 'missed again after a warning'
    : /boats/i.test(why) ? 'still on boats'
    : /second miss|2nd miss/i.test(why) ? '2nd miss in a row'
    : /new member/i.test(why) ? 'new, under target'
    : s === 'Demote' && !/after this war/.test(why) ? 'missed as Elder' : 'under target';
  return [fame && fame + ' medals', reason].filter(Boolean).join(', ');
}

// opts.from / opts.until: when given (the page, for a war it has history for), the results message says what actually
// happened in game in that time (from the start of the last battle day), not what was suggested: everyone who left
// or was removed, and rank changes seen. The game doesn't say who removed someone, so only suggested kicks are
// called "kicked"; anyone else who went "left the clan" (true either way).
function chatEnd(list, r, opts = {}) {
  const here = list.filter(x => !x.gone || x.res.status === 'Kick');
  const by = s => here.filter(x => x.res.status === s);
  const msgs = [];
  const line = x => `${x.name} (${shortReason(x.res.before ? { ...x, res: x.res.before } : x, r)})`;
  let update;
  if (opts.from != null) {
    const inTime = t => t && t >= opts.from && t <= (opts.until ?? Infinity), done = x => x.done && x.done.auto;
    const out = list.filter(x => x.gone && inTime(x.leftAt));
    // Kicked: suggested and gone, or seen to be removed (offline when they went); otherwise they may have left themselves.
    const kicked = x => x.removed || x.res.status === 'Kick' || (x.res.before || {}).status === 'Kick';
    update = ['War update:',
      lines('Kicked:', out.filter(kicked).map(line)),
      lines('Left the clan:', out.filter(x => !kicked(x)).map(line)),
      lines('Demoted:', by('Demote').filter(done).map(line)),
      lines('Promoted to Elder:', by('Promote').filter(done).map(line)),
    ].filter(Boolean);
  } else update = [
    'War update:',
    lines('Kicked:', by('Kick').map(line)),
    lines('Demoted:', by('Demote').map(line)),
    lines('Promoted to Elder:', by('Promote').map(line)),
  ].filter(Boolean);
  if (update.length > 1) msgs.push({ title: 'Update', text: update.join('\n\n') });

  const finals = by('Warn').filter(x => x.res && x.res.extra);
  if (finals.length) msgs.push({ title: 'Final warnings', text: lines(`Final warnings: you'd have been kicked, but you're linked on our Discord, so you get one more chance. ${r.target}+ next war:`, finals.map(x => x.name)) });
  // Already on an active warning and kept on another (a leader's choice): a last warning, not a "first & only".
  const again = by('Warn').filter(x => !(x.res && x.res.extra) && warnState(x, r)?.active);
  if (again.length) msgs.push({ title: 'Last warnings', text: lines(`Last warnings (already warned; under ${r.target} next war = kick):`, again.map(x => x.name)) });
  const warn = by('Warn').filter(x => !(x.res && x.res.extra) && !again.includes(x));
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
  if (promo.length) msgs.push({ title: 'Promotions', text: lines(`Congrats to our new Elder${promo.length === 1 ? '' : 's'} 🎉`, promo.map(x => `${x.name}: ${shortReason(x, r)}`)) + `\nThanks for hitting ${r.target}+ week after week! ⭐` });

  const check = by('Check');
  if (check.length) {
    msgs.push({ title: 'Check in', text: lines(`Holding ${check.length === 1 ? 'a spot' : 'spots'} for:`,
      check.map(x => x.offlineDays != null ? `${x.name} (offline ${Math.floor(x.offlineDays)} days)` : x.name))
      + `\n${check.length === 1 ? "Hope you're ok!" : "Hope you're all ok!"}` });
  }
  return msgs.flatMap(m => split(m.text, r.chatLimit).map((t, i, a) => ({ title: a.length > 1 ? `${m.title} ${i + 1}/${a.length}` : m.title, text: t })));
}

// opts: { day, reset, counts } — battle day number, the daily reset time ("09:43") for the reminder, and counts(p, k):
// whether battle day k counted for that player (for the "missed decks" message of each finished day).
function chatLive(list, r, opts = {}) {
  const here = list.filter(x => !x.gone);
  const left = here.filter(x => x.res.today < 4).sort((a, b) => a.res.today - b.res.today || a.name.localeCompare(b.name));
  const out = here.filter(x => x.res.status === 'Out');
  const close = here.filter(x => x.res.status === 'Need').sort((a, b) => b.res.need - a.res.need);
  const msgs = [];
  if (left.length) msgs.push({ title: 'Decks left', text: lines(`Battle day ${opts.day || ''}: ${opts.reset ? `decks reset at ${opts.reset} UK` : 'decks reset soon'}! Still to play:`.replace('day :', 'day:'),
    left.map(x => `${x.name} (${4 - x.res.today} left)`)) });
  if (out.length) msgs.push({ title: 'Out', text: lines(`Can't reach ${r.target} now:`, out.map(x => `${x.name} (${x.res.fame})`)) });
  if (close.length) msgs.push({ title: 'Still need', text: lines('Still need:', close.map(x => `${x.name}: +${x.res.need}`)) });
  // Each finished battle day: who left decks unused (from the war's per-day decks; see warDays on the page).
  for (let k = 1; k < (opts.day || 0); k++) {
    const missed = here.filter(x => x.warDays && x.warDays[k - 1] != null && x.warDays[k - 1] < 4 && (!opts.counts || opts.counts(x, k)))
      .sort((a, b) => a.warDays[k - 1] - b.warDays[k - 1] || a.name.localeCompare(b.name));
    const unused = missed.reduce((t, x) => t + 4 - x.warDays[k - 1], 0), when = k === opts.day - 1 ? 'yesterday' : `on battle day ${k}`;
    if (missed.length) msgs.push({ title: `Missed day ${k}`, text: lines(`Missed decks ${when}: ${unused} unused (every deck is 100+ medals, win or lose). Please play all 4 today:`,
      missed.map(x => `${x.name}: ${4 - x.warDays[k - 1]} unused`)) });
  }
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
  const outlook = raceOutlook(race);
  return { roster, race: raceRows, log: logRows, raceWeek, raceDay: raceDay(race), racePeriod: race?.periodType || null, outlook };
}

// periodIndex: 0-2 training, 3-6 battle days 1-4 (repeats each week)
// ---- The race (worked out from the clan's own day logs: 9 battle days, Nov 2026, all consistent) ----
// Normal weeks: each battle day the clans are ranked by THAT DAY's medals; the place earns race points
// (1st 3,000 · 2nd 1,800 · 3rd 1,000 · 4th 600 · 5th 400) plus a small bonus for boat defences left standing.
// Most race points after day 4 wins (10,000 is the finish line). Colosseum (a season's last week): total medals win.
// The game shows a clan's race points ("fame") only as of the last reset; today's medals are "periodPoints".
const RANK_POINTS = [3000, 1800, 1000, 600, 400], FINISH = 10000;
function raceOutlook(race) {
  const day = raceDay(race);
  if (!day || !race.clans?.length) return null;
  // Colosseum: the API says so; as a fallback, a normal race can't pass 10,000 (the finish), colosseum totals can.
  const colosseum = race.periodType === 'colosseum' || race.clans.some(c => Number(c.fame) > FINISH), sum = a => a.reduce((t, x) => t + x, 0);
  const past = {};   // each clan's logged battle days (this season's logs): medals and defence bonus
  for (const l of race.periodLogs || []) for (const it of l.items || []) (past[cleanTag(it.clan?.tag)] ||= []).push({ medals: it.pointsEarned || 0, bonus: it.progressEarnedFromDefenses || 0 });
  const rows = race.clans.map(c => {
    const tag = cleanTag(c.tag), h = past[tag] || [], medals = sum((c.participants || []).map(p => Number(p.fame) || 0));
    return { tag, name: c.name, points: colosseum ? medals : Number(c.fame) || 0, today: Number(c.periodPoints) || 0, medals,
      avgMedals: h.length ? Math.round(sum(h.map(x => x.medals)) / h.length) : null, avgBonus: h.length ? Math.round(sum(h.map(x => x.bonus)) / h.length) : 0 };
  });
  const started = rows.some(r => r.today > 0);
  // Today's place: clans level on medals share the higher place (how the game splits a tie isn't known).
  for (const r of rows) r.place = started ? rows.filter(x => x.today > r.today).length : null;
  // The next clan up on today's medals (the closest one with more).
  for (const r of rows) r.next = started ? rows.filter(x => x.today > r.today).sort((a, b) => a.today - b.today)[0]?.tag || null : null;
  for (const r of rows) r.ifNow = colosseum ? r.points : Math.min(FINISH, r.points + (started ? RANK_POINTS[r.place] || 0 : 0));
  // Projection on recent form: today ends at their usual daily medals (or today's, if already more), then the
  // remaining days at their usual medals; places by those, plus their usual defence bonus.
  const est = r => r.avgMedals ?? r.today;
  const placeBy = f => { const o = rows.slice().sort((a, b) => f(b) - f(a)); return r => o.indexOf(r); };
  const todayPl = placeBy(r => Math.max(r.today, est(r))), laterPl = placeBy(est), left = 4 - day;
  for (const r of rows) r.projected = colosseum ? r.medals + Math.max(0, est(r) - r.today) + left * est(r)
    : Math.min(FINISH, r.points + RANK_POINTS[todayPl(r)] + r.avgBonus + left * (RANK_POINTS[laterPl(r)] + r.avgBonus));
  rows.sort((a, b) => b.ifNow - a.ifNow || b.today - a.today);
  return { day, colosseum, started, rows, unit: colosseum ? 'medals' : 'race points' };
}

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
// History looked up per player many times: indexed once per history object.
const _idx = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function idx(h) {
  let x = _idx && _idx.get(h);
  if (x) return x;
  x = { ev: {}, days: {}, warned: {}, extra: {}, periods: {} };
  for (const e of h.events || []) (x.ev[e.tag] ||= []).push({ ...e, t: ms(e.at) });
  for (const d of h.days || []) (x.days[d.week + '|' + d.tag] ||= []).push(d);
  for (const p of h.periods || []) (x.periods[p.week] ||= []).push(p);
  for (const n of h.notes || []) if (n.kind === 'result' && n.value === 'Warn') (x.warned[n.tag] ||= []).push(n.week);
  for (const n of h.notes || []) if (n.kind === 'extra' && n.value === '1') (x.extra[n.tag] ||= []).push(n.week);
  if (_idx) _idx.set(h, x);
  return x;
}
function battleStarts(h, week) {
  return (idx(h).periods[week] || []).filter(x => x.type !== 'training').map(x => ms(x.first_seen)).sort((a, b) => a - b);
}
// Battle day a player joined on during `week`: 'full' (before battles), '1'-'4', or null if unknown.
function autoJoin(h, week, tag) {
  const all = (idx(h).periods[week] || []).map(x => ms(x.first_seen));
  if (!all.length) return null;
  const starts = battleStarts(h, week);
  const war = (h.wars || []).find(x => x.week === week);
  const from = Math.min(...all), to = war ? ms(war.ended_at) : Infinity;
  const joins = (idx(h).ev[tag] || []).filter(e => e.kind === 'join').map(e => e.t).filter(t => t >= from && t <= to);
  if (!joins.length) return null;
  const j = joins[joins.length - 1];
  const day = starts.filter(t => t <= j).length;
  return day ? String(day) : 'full';
}
function roleAt(h, tag, role, t) {
  const later = (idx(h).ev[tag] || []).filter(e => e.kind === 'role' && e.t > t).sort((a, b) => b.t - a.t);
  for (const e of later) role = String(e.detail).split('>')[0];
  return role;
}
function dayDecks(h, week, tag) {
  const rows = idx(h).days[week + '|' + tag] || [];
  if (!rows.length) return null;
  const out = [null, null, null, null];
  for (const d of rows) out[d.day - 1] = d.today;
  return out;
}
function joinedAt(h, tag) {
  const e = (idx(h).ev[tag] || []).filter(x => x.kind === 'join' || x.kind === 'seen');
  return e.length ? { at: e[e.length - 1].t, seen: e[e.length - 1].kind === 'seen' } : null;
}
function notesMap(h) {
  const m = {};
  for (const n of h.notes || []) m[`${n.kind}|${n.week}|${n.tag}`] = n.value;
  return m;
}
// Absences members post with /away in Discord: notes kind 'away', week '*', value {from, until, reason}.
const ukDay = t => new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
function awayText(a) { return `${ukDay(a.from)} to ${ukDay(a.until)}${a.reason ? ': ' + a.reason : ''}`; }
function parseAway(v) {
  try { const a = JSON.parse(v); const from = ms(a.from), until = ms(a.until); return from && until ? { from, until, reason: String(a.reason || '').slice(0, 100) } : null; } catch (e) { return null; }
}
// Away for at least a day of the war's battle days (the 4 days before it ended)?
function awayDuring(a, start, end) { return a && a.from < end && a.until > start && Math.min(a.until, end) - Math.max(a.from, start) >= 864e5 ? a : null; }

// Adds history facts to players: role at war end, auto join day, decks per day, last saved result.
function applyHistory(model, h, liveWeek) {
  if (!h) return model;
  const notes = notesMap(h);
  const war = (h.wars || []).find(x => x.week === model.season);
  for (const p of model.players) {
    p.roleNow = p.role;
    // Rank as it was going into the last battle day: leaders often act on day 4, once it's clear who can't make it,
    // and those changes are this war's decisions, not the rank to judge from.
    if (war) p.role = roleAt(h, p.tag, p.role, ms(war.ended_at) - 864e5);
    p.autoJoin = model.season ? autoJoin(h, model.season, p.tag) : null;
    p.autoJoinLive = liveWeek ? autoJoin(h, liveWeek, p.tag) : null;
    p.days = model.season ? dayDecks(h, model.season, p.tag) : null;
    p.daysLive = liveWeek ? dayDecks(h, liveWeek, p.tag) : null;
    p.joined = joinedAt(h, p.tag);
    const prevRes = model.prevSeason ? notes[`result|${model.prevSeason}|${p.tag}`] || null : null;
    // A first & only warning only counts if a leader marked it as posted.
    p.lastResult = prevRes === 'Warn' && notes[`done|${model.prevSeason}|${p.tag}`] !== '1' ? 'WarnNotPosted' : prevRes;
    // Latest war before this one where a first & only warning was given and posted (ticked done).
    p.warnedIn = (idx(h).warned[p.tag] || []).filter(w => model.season && cmpKey(w, model.season) < 0 && notes[`done|${w}|${p.tag}`] === '1')
      .sort(cmpKey).pop() || null;
    // Linked on Discord (any server set up for this clan), and the latest war their extra chance was used (posted).
    p.linked = (h.linked || []).includes(p.tag);
    p.extraIn = (idx(h).extra[p.tag] || []).filter(w => model.season && cmpKey(w, model.season) < 0 && notes[`done|${w}|${p.tag}`] === '1')
      .sort(cmpKey).pop() || null;
    const mine = idx(h).ev[p.tag] || [];
    p.roleEvents = mine.filter(e => e.kind === 'role').map(e => ({ at: e.t, detail: String(e.detail) }));
    const leaves = mine.filter(e => e.kind === 'leave').sort((a, b) => a.t - b.t), left = leaves.map(e => e.t);
    p.leftAt = left.length ? Math.max(...left) : null;
    // Removed by a leader (they were offline when they went; see the tracker), not left by themselves.
    p.removed = leaves.length ? /:removed$/.test(String(leaves[leaves.length - 1].detail || '')) : false;
    p.away = parseAway(notes[`away|*|${p.tag}`]);
    p.awayWar = war ? awayDuring(p.away, ms(war.ended_at) - 4 * 864e5, ms(war.ended_at)) : null;
    p.awayLive = p.away && p.away.from <= Date.now() && p.away.until > Date.now() ? p.away : null;
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
// endMs: from when in-game changes count as done for this war (the start of its last battle day).
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

if (typeof module !== 'undefined') module.exports = { raceOutlook, RANK_POINTS, historyToLog, clanDescriptions, endResult, ACTIONS, AUTO_CHECKED, awayText, parseAway, awayDuring, shortReason, RULE_SPEC, sanitizeRules, ruleProblems, warnState, cleanName, battleText, autoDone, historyLogRows, mergeLog, autoJoin, roleAt, dayDecks, applyHistory, recent, apiToRows, raceDay, VALID_TAG, missCount, avgMedals, DEFAULT_RULES, parseCSV, detect, build, judgeEnd, judgeLive, guessDay, chatEnd, chatLive, boatSwap, split, targetFor };
