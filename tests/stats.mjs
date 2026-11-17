// Checks the analytics in site/stats.js on the sample clan. Usage: node tests/stats.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const load = f => { const ctx = { module: { exports: {} } }; vm.runInNewContext(readFileSync(new URL('../site/' + f, import.meta.url), 'utf8'), ctx); return ctx.module.exports; };
const L = load('logic.js'), S = load('stats.js');
const read = f => L.parseCSV(readFileSync(new URL('../samples/' + f, import.meta.url), 'utf8'));
const m = L.build({ roster: read('roster.csv'), log: read('war-log.csv') });
const by = n => m.players.find(p => p.name === n);

// Habits: AzzA plays every deck; perc mostly boats so fewer medals per deck.
const az = S.habits(by('AzzA')), pc = S.habits(by('perc'));
assert.ok(az.use > 0.95, 'AzzA uses ~all decks'); assert.ok(pc.perDeck < az.perDeck, 'boat user earns less per deck');

// Reliability: a 10/10 regular beats a repeat misser.
const ra = S.reliability(by('AzzA'), 1800), rb = S.reliability(by('bestgirlclasher'), 1800);
assert.ok(ra.score > 75 && rb.score < ra.score, `${ra.score} vs ${rb.score}`);
assert.equal(S.reliability({ weeks: [{ fame: 2000, decks: 16 }] }, 1800), null, 'needs 2+ wars');

// Forecast: sensible bounds, and monotonic in what's already earned.
const clan = S.clanHabits(m.players, 10);
const ctx = { target: 1800, day: 2, leftToday: 4, lookback: 10, clan };
const f0 = S.forecast(by('AzzA'), { ...ctx, fame: 500 }), f1 = S.forecast(by('AzzA'), { ...ctx, fame: 1200 });
assert.ok(f0.prob >= 0 && f0.prob <= 1 && f1.prob >= f0.prob, `${f0.prob} -> ${f1.prob}`);
assert.ok(f1.low <= f1.expected && f1.expected <= f1.high);
assert.equal(S.forecast(by('AzzA'), { ...ctx, day: 4, leftToday: 0, fame: 1000 }).prob, 0, 'no decks left, under target');
assert.equal(S.forecast(by('AzzA'), { ...ctx, fame: 1900 }).prob, 1);
const fNew = S.forecast({ tag: 'X', weeks: [] }, { ...ctx, fame: 0 });
assert.match(fNew.basis, /clan typical/);
// Same inputs, same answer (seeded).
assert.equal(S.forecast(by('AzzA'), { ...ctx, fame: 500 }).prob, f0.prob);

// Battle types: per-deck medals use the confirmed values.
const ms = S.modeStats([{ tag: 'A', type: 'duel', won: 7, lost: 2 }, { tag: 'A', type: 'pvp', won: 1, lost: 2 }, { tag: 'A', type: 'boat', won: 4, lost: 0 }], 'A');
assert.equal(ms.duel.perDeck, (250 * 7 + 100 * 2) / 9); assert.equal(ms.boat.perDeck, 125);
assert.deepEqual(S.bestMode(ms), null, 'needs 5+ games in two types');
const ms2 = S.modeStats([{ tag: 'A', type: 'duel', won: 6, lost: 2 }, { tag: 'A', type: 'boat', won: 5, lost: 1 }], 'A');
assert.equal(S.bestMode(ms2).mode, 'Duels');

// Play times: two decks at 19:00 UK and one at 08:00 UK.
const pt = S.playTimes([{ tag: 'A', week: 'w', at: '2026-11-19T19:05:00.000Z', decks: 2 }, { tag: 'A', week: 'w', at: '2026-11-20T08:10:00.000Z', decks: 3 }], 'A');
assert.equal(pt.total, 3); assert.equal(pt.hours[19], 2); assert.equal(pt.hours[8], 1);

// Race projection: steady pace carries to day 4.
const pr = S.projectRace([{ tag: 'U', fame: 10000 }, { tag: 'R', fame: 12000 }], 2, 864e5 / 2);
assert.equal(pr[0].tag, 'R'); assert.equal(pr[1].projected, Math.round(10000 / 1.5 * 4));

// Clan series uses member medal totals.
const cs = S.clanSeries([{ week: '1-1', ended_at: 'a', rank: 2, fame: 7700, trophy_change: 10 }], [{ week: '1-1', fame: 2000, decks: 16 }, { week: '1-1', fame: 1500, decks: 16 }], 1800);
assert.deepEqual([cs[0].medals, cs[0].passed, cs[0].played], [3500, 1, 2]);
console.log(`Stats checks passed (AzzA reliability ${ra.score}, bestgirlclasher ${rb.score}; AzzA from 500 on day 2: ${Math.round(f0.prob * 100)}%)`);

// Calibration: rerun forecasts on stored battle-day data, scored against what happened.
{
  const hist = { wars: [{ week: '9-1' }], players: [], days: [] };
  for (let i = 0; i < 20; i++) {
    const tag = 'P' + i, good = i < 14;
    for (const w of ['8-1', '8-2', '8-3']) hist.players.push({ week: w, tag, fame: good ? 2400 : 1200, decks: good ? 16 : 8 });
    hist.players.push({ week: '9-1', tag, fame: good ? 2400 : 1200, decks: good ? 16 : 8 });
    for (let d = 1; d <= 3; d++) hist.days.push({ week: '9-1', tag, day: d, fame: (good ? 600 : 300) * d });
  }
  const c = S.calibrate(hist, 1800);
  assert.ok(c && c.n > 0 && c.brier < 0.1 && c.brier <= c.baseline, JSON.stringify(c));
  // a forecast-'Likely' player who then plays nothing is counted as a miss
  hist.players.push({ week: '9-1', tag: 'Z', fame: 0, decks: 0 });
  for (const w of ['8-1', '8-2', '8-3']) hist.players.push({ week: w, tag: 'Z', fame: 2500, decks: 16 });
  hist.days.push({ week: '9-1', tag: 'Z', day: 1, fame: 0 });
  const c2 = S.calibrate(hist, 1800);
  assert.ok(c2.bands.Likely.n - c2.bands.Likely.hit > c.bands.Likely.n - c.bands.Likely.hit, 'no-show counted as a miss');
  // a day-3 joiner is only forecast from day 3, against 2 days x 450
  hist.players.push({ week: '9-1', tag: 'L', fame: 950, decks: 8 });
  hist.days.push({ week: '9-1', tag: 'L', day: 3, fame: 500 });
  const c3 = S.calibrate(hist, 1800);
  assert.equal(c3.n, c2.n + 2, 'late joiner forecast from their first day only (days 3 and 4)');
  // excused players are skipped
  hist.notes = [{ week: '9-1', tag: 'L', kind: 'join', value: 'excused' }];
  assert.equal(S.calibrate(hist, 1800).n, c2.n);
  assert.equal(S.band(0.85), 'Likely'); assert.equal(S.band(0.5), 'At risk'); assert.equal(S.band(0.1), 'Unlikely');
  assert.ok(c.bands.Likely.hit / c.bands.Likely.n > 0.9, 'likely ones made it');
  assert.equal(S.calibrate({ wars: [], players: [], days: [] }, 1800), null);
  console.log(`Calibration checks passed (Brier ${c.brier.toFixed(3)} on ${c.n} forecasts)`);
}
