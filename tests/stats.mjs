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
  assert.ok(c.accuracy > 0.9, 'plain accuracy: right most of the time');
  assert.equal(JSON.stringify(c.byDay.map(d => d.day)), '[1,2,3,4]'); assert.ok(c.byDay[0].n > 0 && c.byDay[0].right != null);
  assert.equal(c.byDay.reduce((t, d) => t + d.n, 0), c.n, 'every forecast counted once by day');
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
  assert.equal(c3.n, c2.n + 1, 'late joiner: forecast from day 3 against 1 day x 450 (already past it by day 4)');
  // excused players are skipped
  hist.notes = [{ week: '9-1', tag: 'L', kind: 'join', value: 'excused' }];
  assert.equal(S.calibrate(hist, 1800).n, c2.n);
  assert.equal(S.band(0.85), 'Likely'); assert.equal(S.band(0.5), 'At risk'); assert.equal(S.band(0.1), 'Unlikely');
  assert.ok(c.bands.Likely.hit / c.bands.Likely.n > 0.9, 'likely ones made it');
  assert.equal(S.calibrate({ wars: [], players: [], days: [] }, 1800), null);
  console.log(`Calibration checks passed (Brier ${c.brier.toFixed(3)} on ${c.n} forecasts)`);
}

// Season summary on the sample log: season 137 has 4 wars.
{
  const log = read('war-log.csv');
  const ss = S.seasonSummary(log, [], 137, 1800);
  assert.equal(ss.weeks.join(','), '137-1,137-2,137-3,137-4'); assert.ok(ss.complete);
  assert.ok(ss.top[0].total >= ss.top[1].total && ss.perfect.every(x => x.passed === 4));
  assert.equal(S.seasonSummary(log, [], 999, 1800), null);
  console.log(`Season checks passed (season 137 top: ${ss.top[0].name} ${ss.top[0].total}, ${ss.perfect.length} at 1800+ every war)`);
}

// Forecast spread matches real wars (checked 20 Nov 2026 on the clan's 10 wars: a player's full-war total varies by
// ~±260 medals; the old model said ~±66, so it showed 0% / 100% far too often).
{ const steady = { wars: 5, use: 1, perDeck: 150, sd: 16 };
  const f0 = S.forecast({ tag: 'X1', weeks: [] }, { target: 1800, day: 1, leftToday: 4, fame: 0, habits: steady });
  assert.ok(f0.high - f0.low >= 300, 'a war\'s total can swing by hundreds: ' + f0.low + '–' + f0.high);
  // perc's real case: ~105 a deck, plays everything, 450 after day 1 → reached 1,800 in 1 of their last 5 wars.
  const low = { wars: 5, use: 1, perDeck: 105, sd: 12 };
  const fp = S.forecast({ tag: 'X2', weeks: [] }, { target: 1800, day: 1, leftToday: 0, fame: 450, habits: low });
  assert.ok(fp.prob > 0.08 && fp.prob < 0.45, 'about 1 in 5, not ~3%: ' + fp.prob);
  assert.ok(Math.abs(fp.expected - (450 + 12 * 100)) <= 100, 'average kept: ' + fp.expected);
  console.log(`Forecast spread checks passed (steady player ${f0.low}–${f0.high}; low scorer ${Math.round(fp.prob * 100)}%)`); }

// Missed decks on finished days: one message per day, only for days that counted for the player.
{ const r = { target: 1800, chatLimit: 256 }, mk = (name, days, join) => ({ name, gone: false, warDays: days, join, res: { today: days[1] ?? 0, status: 'Need', need: 900 } });
  const list = [mk('A', [4, 1, null, null]), mk('B', [2, 4, null, null]), mk('C', [0, 0, null, null], '1')];
  const ms = L.chatLive(list, r, { day: 2, counts: (p, k) => (/^\d$/.test(p.join || '') ? k > Number(p.join) : true) });
  const missed = ms.find(m => m.title === 'Missed day 1');
  assert.match(missed.text, /^Missed decks yesterday: 2 unused[\s\S]*B: 2 unused/, 'total, then each name with their unused count');
  assert.ok(!/\bA: /.test(missed.text), 'A played all 4');
  assert.ok(!/\bC: /.test(missed.text), 'C joined during day 1: not counted');
  console.log('Missed decks message checks passed'); }

// Linked on Discord: one extra chance before a kick (a final warning), once until cleared; demotions unchanged.
{ const r = L.sanitizeRules({}).rules, wk = (key, fame) => ({ key, fame, decks: 16, boats: 0 });
  const mk = (extra = {}) => { const before = [wk('138-2', 1000), wk('138-1', 2000), wk('137-4', 2000)];
    return { tag: 'X', name: 'Xavi', role: 'member', cur: wk('138-3', 900), before, prev: before[0], weeks: [wk('138-3', 900), ...before], isNew: false, offlineDays: 0, ...extra }; };
  assert.equal(L.judgeEnd(mk(), r, 'full').status, 'Kick', 'not linked: second miss in a row is a kick');
  const fin = L.judgeEnd(mk({ linked: true }), r, 'full');
  assert.equal(fin.status, 'Warn'); assert.ok(fin.extra); assert.match(fin.why, /^Final warning: linked on Discord[\s\S]*second miss in a row/);
  assert.equal(L.judgeEnd(mk({ linked: true, extraIn: '138-2' }), r, 'full').status, 'Kick', 'extra chance already used (and not cleared): kick');
  const cleared = mk({ linked: true, extraIn: '137-1' });   // then 137-4, 138-1 at the target... and 138-2 under: not 3 in a row
  assert.equal(L.judgeEnd(cleared, r, 'full').status, 'Kick', 'used in 137-1, not cleared since (only 2 in a row): kick');
  const ok3 = mk({ linked: true, extraIn: '137-1' }); ok3.before = [wk('138-2', 1000), wk('138-1', 2000), wk('137-4', 2000), wk('137-3', 2000), wk('137-2', 2000)]; ok3.prev = ok3.before[0];
  assert.ok(L.judgeEnd(ok3, r, 'full').extra, 'cleared (3 wars in a row at the target since): the extra chance is back');
  assert.equal(L.judgeEnd(mk({ linked: true, role: 'elder' }), r, 'full').status, 'Demote', 'demotions still happen');
  assert.equal(L.judgeEnd(mk({ linked: true }), { ...r, linkBonus: false }, 'full').status, 'Kick', 'rule switched off');
  const msgs = L.chatEnd([{ ...mk({ linked: true }), res: fin }, { ...mk(), name: 'Yan', res: { status: 'Warn', why: 'First miss' } }], r);
  assert.match(msgs.find(m => m.title === 'Final warnings').text, /linked on our Discord[\s\S]*Xavi/);
  assert.match(msgs.find(m => m.title === 'Warnings').text, /Yan/); assert.doesNotMatch(msgs.find(m => m.title === 'Warnings').text, /Xavi/);
  console.log('Discord extra chance checks passed'); }
