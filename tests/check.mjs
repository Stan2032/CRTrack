// Runs the audit logic (site/logic.js) against samples/ and checks known calls.
// Usage: node tests/check.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sample } from './samples.mjs';
import { fileURLToPath } from 'node:url';
// Only print details when run directly (other tests import fakeApi from here).
const main = process.argv[1] === fileURLToPath(import.meta.url);
const log = (...a) => { if (main) console.log(...a); };
import assert from 'node:assert/strict';

const code = readFileSync(new URL('../site/logic.js', import.meta.url), 'utf8');
const ctx = { module: { exports: {} } };
vm.runInNewContext(code, ctx);
const L = ctx.module.exports;

const files = { roster: sample('roster.csv'), log: sample('war-log.csv'), race: sample('current-race.csv') };

const m = L.build({ roster: files.roster, log: files.log });
assert.equal(m.season, '138-2');
assert.equal(m.players.length, 48);
const r = { ...L.DEFAULT_RULES };
const join = { 'brayyisaac': '3', '>FRXNCHY<': 'excused' };
const res = Object.fromEntries(m.players.map(p => [p.name, L.judgeEnd(p, r, join[p.name] || 'full')]));
const expect = {
  'Manny1': 'Kick', 'ty': 'Kick', 'bestgirlclasher': 'Kick',
  'notorious mike': 'Warn', 'Pirate Steve': 'Check',
  'perc': 'Kick', 'boi in a jar': 'Kick', 'Mohammad nazari': 'Warn',   // perc, boi: on boats and under 2 wars running (no saved warning in this test)
  'mattmk': 'Warn', 'Bob': 'Warn', 'Thomas king': 'Warn', 'Ninja': 'Warn',
  'brayyisaac': 'OK', '>FRXNCHY<': 'Excused', 'stuart': 'OK', 'Astin': 'OK',
  'Luke': 'Promote', 'Veiz': 'Promote', 'Marcus.B:)': 'Promote', 'Spud': 'Promote',
};
let bad = 0;
for (const [n, s] of Object.entries(expect)) {
  if (res[n].status !== s) { bad++; console.log(`FAIL ${n}: got ${res[n].status} (${res[n].why}), want ${s}`); }
}
const summary = {};
for (const [n, x] of Object.entries(res)) (summary[x.status] ||= []).push(n);
log(summary);

// Boat swap: stuart 16 boats, 1800 -> 12W 4L -> 2800 in 1v1
const st = m.players.find(p => p.name === 'stuart');
assert.equal(L.boatSwap(st.cur).pvp, 2800);

// Chat fits
const list = m.players.map(p => ({ ...p, res: res[p.name] }));
for (const c of L.chatEnd(list, r)) {
  assert.ok(c.text.length <= r.chatLimit, c.title + ' too long');
  log(`--- ${c.title} (${c.text.length})\n${c.text}`);
}

// Live: race file (new week, nobody has medals yet)
const live = L.build({ roster: files.roster, race: files.race });
const day = 1;   // a new week: nobody has played yet
const a = live.players.find(p => p.name === 'Astin');
assert.equal(L.judgeLive(a, r, 'full', day).today, 4);
// Day 4 elimination math
const fake = { race: { fame: 850, decks: 12, today: 0 } };
assert.equal(L.judgeLive(fake, r, 'full', 4).status, 'Out');   // 850 + 900 < 1800
assert.equal(L.judgeLive({ race: { fame: 900, decks: 12, today: 0 } }, r, 'full', 4).status, 'Need');
assert.equal(L.judgeLive({ race: { fame: 1300, decks: 14, today: 2 } }, r, 'full', 4).status, 'Out'); // 1300+400
assert.equal(L.split('a\n'.repeat(300), 256).every(s => s.length <= 256), true);


// API path: fake API replies built from the samples give the same results
export function fakeApi() {
  const members = { items: files.roster.map(r => ({ tag: r.tag, name: r.name, role: r.role, lastSeen: r.lastSeen })) };
  const seasons = [...new Set(files.log.map(r => r.season_key))];
  const log = { items: seasons.map(k => {
    const [sid, sec] = k.split('-').map(Number);
    return { seasonId: sid, sectionIndex: sec - 1, standings: [{ clan: { tag: '#PPCCR8VU', name: '#WINNING',
      participants: files.log.filter(r => r.season_key === k).map(r => ({ tag: '#' + r.player_tag, name: r.player_name,
        fame: +r.player_fame, decksUsed: +r.player_decks_used, boatAttacks: +r.player_boat_attacks })) } }] };
  }) };
  const race = { periodType: 'warDay', periodIndex: 6, clan: { tag: '#PPCCR8VU', name: '#WINNING',
    participants: files.race.map(r => ({ tag: '#' + r.player_tag, name: r.player_name, fame: 0, decksUsed: 0, decksUsedToday: +r.player_decks_used_today, boatAttacks: 0 })) } };
  return { clan: { tag: '#PPCCR8VU', name: '#WINNING' }, members, race, log };
}
const api = fakeApi();
const am = L.build(L.apiToRows(api));
assert.equal(am.season, '138-2');
for (const p of am.players) {
  const got = L.judgeEnd(p, r, join[p.name] || 'full').status;
  assert.equal(got, res[p.name].status, 'api path ' + p.name);
}
assert.equal(L.raceDay(api.race), 4);
assert.equal(L.raceDay({ periodType: 'training', periodIndex: 1 }), 0);
assert.equal(L.raceDay({ periodType: 'warDay', periodIndex: 10 }), 1);

if (bad) { console.log(bad + ' failed'); process.exit(1); }
log('All checks passed');

// First & only warning: lasts until the target is reached r.warnClear wars in a row.
{
  const r3 = { ...L.DEFAULT_RULES, warnClear: 3 };
  const mk = (before, cur) => ({ role: 'member', isNew: false, offlineDays: 0, warnedIn: '1-1', weeks: [cur, ...before], cur, before, prev: before[0] });
  const w = (key, fame) => ({ key, fame, decks: 16, boats: 0 });
  // warned in 1-1, passed 1-2, misses 1-3 -> kick
  let p = mk([w('1-2', 2000), w('1-1', 1500)], w('1-3', 1500));
  assert.equal(L.judgeEnd(p, r3, 'full').status, 'Kick');
  assert.equal(L.warnState(p, r3).active, true);
  // warned in 1-1, then 3 good wars, then a miss -> first warning again
  p = mk([w('2-1', 2000), w('1-4', 2000), w('1-3', 1500), w('1-2', 2000), w('1-1', 1500)], w('2-2', 1500));
  assert.equal(L.warnState(p, r3).active, true, 'a miss in 1-3 restarts the count: only 2 good wars since');
  assert.equal(L.judgeEnd(p, r3, 'full').status, 'Kick');
  p = mk([w('2-1', 2000), w('1-4', 2000), w('1-3', 2000), w('1-2', 2000), w('1-1', 1500)], w('2-2', 1500));
  assert.equal(L.warnState(p, r3).active, false);
  assert.equal(L.judgeEnd(p, r3, 'full').status, 'Warn');
  log('Warning duration checks passed');
}

// Rules are corrected to sensible ranges, and impossible combinations are flagged.
{
  const s = L.sanitizeRules({ lookback: 0, target: 99999, chatLimit: 300, boatShare: 47, promoAvg: 'abc' });
  assert.equal(s.rules.lookback, 3); assert.equal(s.rules.target, 3600); assert.equal(s.rules.chatLimit, 256);
  assert.equal(s.rules.boatShare, 45); assert.equal(s.rules.promoAvg, L.DEFAULT_RULES.promoAvg);
  assert.equal(L.sanitizeRules({}).fixed.length, 0, 'defaults are all valid');
  assert.equal(L.ruleProblems(L.DEFAULT_RULES).length, 0, 'defaults make sense together');
  assert.ok(L.ruleProblems({ ...L.DEFAULT_RULES, lookback: 4 }).some(x => /nobody can be promoted/.test(x)));
  log('Rule limit checks passed');
}

// Absences from Discord /away: under target while away during the war -> leaders decide, not kick.
{
  const r = L.DEFAULT_RULES, end = Date.parse('2026-11-23T09:43:00Z');
  const away = JSON.stringify({ from: '2026-11-19T10:00:00Z', until: '2026-11-22T10:00:00Z', reason: 'holiday' });
  const a = L.awayDuring(L.parseAway(away), end - 4 * 864e5, end);
  assert.ok(a, 'away during battle days');
  assert.equal(L.awayDuring(L.parseAway(away), end + 864e5, end + 5 * 864e5), null, 'not during the next war');
  const cur = { key: '9-1', fame: 900, decks: 8, boats: 0 };
  const p = { role: 'member', isNew: true, offlineDays: 4, weeks: [cur], cur, before: [], prev: null, awayWar: a };
  const res = L.judgeEnd(p, r, 'full');
  assert.equal(res.status, 'Review'); assert.match(res.why, /Said they'd be away Thu 19 Nov to Sun 22 Nov: holiday/);
  assert.equal(L.judgeEnd({ ...p, awayWar: null }, r, 'full').status, 'Kick');
  log('Absence checks passed');
}

// The Worker's copies of logic.js / stats.js match the site (node worker/gen.mjs updates them).
{
  const { outOfDate } = await import('../worker/gen.mjs');
  assert.deepEqual(outOfDate(), [], 'run: node worker/gen.mjs');
  log('Worker copy checks passed');
}

// Clan description: every version fits, none uses characters the game draws wrongly, rules show through.
{
  const ds = L.clanDescriptions({ ...L.DEFAULT_RULES, target: 2000, promoAvg: 2400 }, 'Discord: dsc.gg/abc');
  assert.ok(ds.length >= 2 && ds.every(t => t.length <= 128 && !/[=>]/.test(t)));
  assert.match(ds[0], /2000\+ medals every war/); assert.ok(ds.some(t => /avg 2400\+/.test(t)) && ds.some(t => t.includes('Discord: dsc.gg/abc')));
  log('Clan description checks passed');
}
