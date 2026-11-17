// ---- Analytics (pure functions, no DOM). Tested by tests/stats.mjs ----
// Every number here comes from stored game data; each function says how it's worked out.

// Medal values per war battle (Clan Wars 2), confirmed against real totals.
const PER = { duel: [250, 100], pvp: [200, 100], boat: [125, 75] };

// Small seeded random generator, so a player's forecast doesn't jump around between page loads.
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Forecast bands, shared by the page and the accuracy check.
const BANDS = [['Likely', 0.8], ['At risk', 0.2], ['Unlikely', 0]];
const band = prob => BANDS.find(([, min]) => prob >= min)[0];
// War week order, e.g. "138-2" < "138-3" < "139-1".
const weekCmp = (a, b) => { const [a1, a2] = String(a).split('-').map(Number), [b1, b2] = String(b).split('-').map(Number); return a1 - b1 || a2 - b2; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// How a player usually plays, from their recent full wars:
//   use  = share of their 16 decks they actually play
//   perDeck = medals per deck played (skill + battle type mix)
//   sd   = spread of medals per deck between wars
function habits(p, lookback = 10) {
  const ws = (p.weeks || []).slice(0, lookback).filter(w => w.decks > 0 || w.fame > 0);
  if (!ws.length) return null;
  const decks = ws.reduce((s, w) => s + w.decks, 0), fame = ws.reduce((s, w) => s + w.fame, 0);
  const use = clamp(ws.reduce((s, w) => s + Math.min(16, w.decks) / 16, 0) / ws.length, 0, 1);
  const pd = ws.filter(w => w.decks > 0).map(w => w.fame / w.decks);
  const perDeck = decks ? fame / decks : null;
  const mean = pd.length ? pd.reduce((s, x) => s + x, 0) / pd.length : perDeck;
  const sd = pd.length > 1 ? Math.sqrt(pd.reduce((s, x) => s + (x - mean) ** 2, 0) / (pd.length - 1)) : 25;
  return { wars: ws.length, use, perDeck, sd };
}

function clanHabits(players, lookback) {
  const hs = players.map(p => habits(p, lookback)).filter(Boolean);
  return { use: median(hs.map(h => h.use)) ?? 0.8, perDeck: median(hs.map(h => h.perDeck)) ?? 140, sd: median(hs.map(h => h.sd)) ?? 25 };
}

// Chance of reaching the target by the end of this war (Monte Carlo, 2,000 runs).
//   Each remaining deck is played with the player's usual chance; each played deck earns
//   their usual medals per deck, varied by their usual spread (clipped to the game's 75–250).
//   New players use the clan's typical habits. Capped at the game's daily maximum (900).
function forecast(p, ctx) {
  const { target, day, leftToday, fame, clan } = ctx;
  if (fame >= target) return { prob: 1, expected: fame, low: fame, high: fame, basis: 'already reached' };
  const own = ctx.habits !== undefined ? ctx.habits : habits(p, ctx.lookback), h = own || clan;
  const daysAfter = Math.max(0, 4 - day);
  const r = rng(p.tag + ':' + day + ':' + leftToday), runs = ctx.runs || 2000, finals = [];
  const sd = Math.max(15, h.sd || 25);
  for (let i = 0; i < runs; i++) {
    let total = fame;
    for (const n of [leftToday, ...Array(daysAfter).fill(4)]) {
      let dayGain = 0;
      for (let d = 0; d < n; d++) {
        if (r() >= h.use) continue;
        const z = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
        dayGain += clamp(h.perDeck + z * sd, 75, 250);
      }
      total += Math.min(900, dayGain);
    }
    finals.push(total);
  }
  finals.sort((a, b) => a - b);
  const prob = finals.filter(x => x >= target).length / runs;
  return { prob, expected: Math.round(finals[runs >> 1]), low: Math.round(finals[Math.floor(runs * 0.1)]), high: Math.round(finals[Math.floor(runs * 0.9)]),
    basis: own ? `their last ${h.wars} wars: plays ${Math.round(h.use * 100)}% of decks, ~${Math.round(h.perDeck)} medals each` : 'clan typical (new player)' };
}

// Reliability score 0–100 from recent wars (needs 2+):
//   40% how often they reach the target, 30% decks used, 20% medals vs target (1.5× target = full),
//   10% trend (last 3 wars vs the ones before; no change = half marks).
function reliability(p, target, lookback = 10) {
  const ws = (p.weeks || []).slice(0, lookback);
  if (ws.length < 2) return null;
  const hit = ws.filter(w => w.fame >= target).length / ws.length;
  const deck = ws.reduce((s, w) => s + Math.min(16, w.decks) / 16, 0) / ws.length;
  const avg = ws.reduce((s, w) => s + w.fame, 0) / ws.length;
  const strength = clamp(avg / (target * 1.5), 0, 1);
  const recent = ws.slice(0, 3), older = ws.slice(3);
  const ra = recent.reduce((s, w) => s + w.fame, 0) / recent.length;
  const oa = older.length ? older.reduce((s, w) => s + w.fame, 0) / older.length : ra;
  const trend = clamp(0.5 + (ra - oa) / (2 * target), 0, 1);
  const score = Math.round(100 * (0.4 * hit + 0.3 * deck + 0.2 * strength + 0.1 * trend));
  return { score, hit, deck, avg: Math.round(avg), trend: Math.round(ra - oa), wars: ws.length };
}

// When someone plays, from timestamped deck-count increases (race_events), in UK hours.
// Each row counts once per deck played since the previous row.
function playTimes(events, tag) {
  const rows = events.filter(e => !tag || e.tag === tag).sort((a, b) => (a.tag > b.tag ? 1 : a.tag < b.tag ? -1 : a.at < b.at ? -1 : 1));
  const hours = Array(24).fill(0), last = {};
  for (const e of rows) {
    const key = e.tag + '|' + e.week, n = Math.max(0, e.decks - (last[key] ?? 0));
    last[key] = e.decks;
    const h = +new Date(e.at).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }) % 24;
    hours[h] += n;
  }
  const total = hours.reduce((s, x) => s + x, 0);
  if (!total) return { hours, total, window: null };
  // The 4-hour window holding the most plays.
  let best = 0, at = 0;
  for (let h = 0; h < 24; h++) { const s = [0, 1, 2, 3].reduce((t, k) => t + hours[(h + k) % 24], 0); if (s > best) { best = s; at = h; } }
  return { hours, total, window: { from: at, to: (at + 4) % 24, share: best / total } };
}

// Win rates and medals per deck by battle type, from war battles in battle logs.
function modeStats(battles, tag) {
  const out = {};
  for (const k of Object.keys(PER)) out[k] = { won: 0, lost: 0 };
  for (const b of battles) if ((!tag || b.tag === tag) && out[b.type]) { out[b.type].won += b.won; out[b.type].lost += b.lost; }
  for (const [k, x] of Object.entries(out)) {
    const n = x.won + x.lost;
    x.games = n; x.rate = n ? x.won / n : null;
    x.perDeck = n ? (PER[k][0] * x.won + PER[k][1] * x.lost) / n : null;
  }
  return out;
}

// Which battle type earns them most per deck. Needs 5+ games in at least two types to compare.
function bestMode(ms) {
  const ok = Object.entries(ms).filter(([, x]) => x.games >= 5).sort((a, b) => b[1].perDeck - a[1].perDeck);
  if (ok.length < 2) return null;
  const names = { duel: 'Duels', pvp: '1v1', boat: 'Boat attacks' };
  return { mode: names[ok[0][0]], perDeck: Math.round(ok[0][1].perDeck), next: names[ok[1][0]], gain: Math.round(ok[0][1].perDeck - ok[1][1].perDeck) };
}

// Projected end-of-war medals for every clan in the race, at their pace so far.
//   elapsed = battle days fully done + share of today gone (from the daily reset time).
function projectRace(standings, day, msSinceReset) {
  const elapsed = Math.max(0.25, (day - 1) + clamp(msSinceReset / 864e5, 0, 1));
  return standings.map(c => ({ ...c, projected: Math.round(c.fame / elapsed * 4) })).sort((a, b) => b.projected - a.projected);
}

// Clan war history: medals, place, trophy change and pass rate per war (oldest first).
function clanSeries(wars, players, target) {
  return [...wars].sort((a, b) => (a.ended_at < b.ended_at ? -1 : 1)).map(w => {
    const ps = players.filter(p => p.week === w.week && p.decks > 0);
    // Total medals = sum of members' medals (the clan "fame" field in the war log is race progress, not total medals).
    return { week: w.week, medals: ps.reduce((s, p) => s + p.fame, 0), rank: w.rank, trophies: w.trophy_change, played: ps.length, passed: ps.filter(p => p.fame >= target).length };
  });
}

// How accurate the forecasts were, rerun after the fact using only what was known at the time.
// For each of the last `lookback` finished wars with stored battle-day data, at the start of each battle day:
//   who: players seen in the race that day (late joiners from their first day; players who then played
//        nothing still count, as misses); excused players are skipped,
//   medals so far: their total in the last snapshot of the previous battle day (0 on their first day;
//        snapshots are up to 15 minutes before the reset, so this can be slightly low),
//   target: the clan target, or per battle day left for late joiners (as the page does),
//   habits: only their wars before this one.
// Scored per band and with a Brier score, next to the score of simply guessing the clan's usual pass rate.
function calibrate(h, target, lookback = 10, perDay = 450) {
  if (!h) return null;
  const weeksBy = {}, resultsBy = {};
  for (const r of h.players || []) {
    (weeksBy[r.tag] ||= []).push({ key: r.week, fame: r.fame, decks: r.decks });
    (resultsBy[r.week] ||= {})[r.tag] = r.fame;
  }
  for (const t in weeksBy) weeksBy[t].sort((a, b) => weekCmp(b.key, a.key));
  const dayRows = {};
  for (const d of h.days || []) ((dayRows[d.week] ||= {})[d.tag] ||= {})[d.day] = d.fame;
  const excused = new Set((h.notes || []).filter(n => n.kind === 'join' && (n.value === 'excused' || n.value === '4')).map(n => n.week + '|' + n.tag));
  const bands = Object.fromEntries(BANDS.map(([k]) => [k, { n: 0, hit: 0 }]));
  const samples = [];
  const wars = (h.wars || []).map(w => w.week).filter(w => dayRows[w] && resultsBy[w]).sort(weekCmp).slice(-lookback);
  for (const week of wars) {
    const tags = Object.keys(dayRows[week]).filter(t => resultsBy[week][t] != null && !excused.has(week + '|' + t));
    const ps = tags.map(tag => ({ tag, weeks: (weeksBy[tag] || []).filter(w => weekCmp(w.key, week) < 0) }));
    const clan = clanHabits(ps, lookback);
    for (const p of ps) {
      const seen = dayRows[week][p.tag], first = Math.min(...Object.keys(seen).map(Number));
      if (first >= 4) continue;                                       // joined on the last day: excused, as on the page
      const goal = first > 1 ? (4 - first) * perDay : target;         // same as the page: joined during day N -> (4 - N) days x perDay
      const own = habits(p, lookback);
      for (let day = first; day <= 4; day++) {
        const so = day === first ? 0 : seen[day - 1];
        if (so == null || so >= goal) continue;
        const f = forecast(p, { target: goal, day, leftToday: 4, fame: so, lookback, clan, habits: own, runs: 400 });
        samples.push({ prob: f.prob, hit: resultsBy[week][p.tag] >= goal ? 1 : 0 });
      }
    }
  }
  if (!samples.length) return null;
  for (const x of samples) { const b = bands[band(x.prob)]; b.n++; b.hit += x.hit; }
  const base = samples.reduce((t, x) => t + x.hit, 0) / samples.length;
  const brier = samples.reduce((t, x) => t + (x.prob - x.hit) ** 2, 0) / samples.length;
  const baseline = samples.reduce((t, x) => t + (base - x.hit) ** 2, 0) / samples.length;
  return { n: samples.length, wars: wars.length, brier, baseline, base, bands };
}

// Season summary (a season is the wars sharing the first number, e.g. 137-1 to 137-4).
//   total medals per player over the season, who reached the target in every war they played (all 4),
//   and placings per war where known.
function seasonSummary(log, wars, season, target) {
  const rows = log.filter(r => String(r.season_key).split('-')[0] === String(season));
  const weeks = [...new Set(rows.map(r => r.season_key))].sort(weekCmp);
  if (!weeks.length) return null;
  const by = {};
  for (const r of rows) {
    const x = (by[r.player_tag] ||= { name: r.player_name, total: 0, wars: 0, passed: 0 });
    const f = +r.player_fame || 0, d = +r.player_decks_used || 0;
    if (!d && !f) continue;
    x.total += f; x.wars++; if (f >= target) x.passed++;
  }
  const ps = Object.values(by).filter(x => x.wars);
  const top = ps.slice().sort((a, b) => b.total - a.total).slice(0, 5);
  const perfect = ps.filter(x => x.wars === weeks.length && x.passed === x.wars).sort((a, b) => b.total - a.total);
  const placings = weeks.map(w => ({ week: w, rank: (wars || []).find(x => x.week === w)?.rank || null }));
  return { season, weeks, top, perfect, placings, complete: weeks.length >= 4, medals: ps.reduce((t, x) => t + x.total, 0) };
}

if (typeof module !== 'undefined') module.exports = { seasonSummary, band, BANDS, weekCmp, calibrate, habits, clanHabits, forecast, reliability, playTimes, modeStats, bestMode, projectRace, clanSeries, median };
