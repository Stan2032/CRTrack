// Runs the audit logic from index.html against samples/ and checks known calls.
// Usage: node tests/check.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const code = html.match(/<script id="logic">([\s\S]*?)<\/script>/)[1];
const ctx = { module: { exports: {} } };
vm.runInNewContext(code, ctx);
const L = ctx.module.exports;

const read = f => L.parseCSV(readFileSync(new URL('../samples/' + f, import.meta.url), 'utf8'));
const files = { roster: read('roster.csv'), log: read('war-log.csv'), race: read('current-race.csv'), history: read('war-history.csv') };
for (const [k, v] of Object.entries(files)) assert.equal(L.detect(v), k, 'detect ' + k);

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
console.log(summary);

// Boat swap: stuart 16 boats, 1800 -> 12W 4L -> 2800 in 1v1
const st = m.players.find(p => p.name === 'stuart');
assert.equal(L.boatSwap(st.cur).pvp, 2800);

// Chat fits
const list = m.players.map(p => ({ ...p, res: res[p.name] }));
for (const c of L.chatEnd(list, r)) {
  assert.ok(c.text.length <= r.chatLimit, c.title + ' too long');
  console.log(`--- ${c.title} (${c.text.length})\n${c.text}`);
}

// History-only fallback still works
const h = L.build({ roster: files.roster, history: files.history });
assert.equal(h.season, '138-2');

// Live: race file (new week, nobody has medals yet)
const live = L.build({ roster: files.roster, race: files.race });
const day = L.guessDay(live.players);
const a = live.players.find(p => p.name === 'Astin');
assert.equal(L.judgeLive(a, r, 'full', day).today, 4);
// Day 4 elimination math
const fake = { race: { fame: 850, decks: 12, today: 0 } };
assert.equal(L.judgeLive(fake, r, 'full', 4).status, 'Out');   // 850 + 900 < 1800
assert.equal(L.judgeLive({ race: { fame: 900, decks: 12, today: 0 } }, r, 'full', 4).status, 'Need');
assert.equal(L.judgeLive({ race: { fame: 1300, decks: 14, today: 2 } }, r, 'full', 4).status, 'Out'); // 1300+400
assert.equal(L.split('a\n'.repeat(300), 194).every(s => s.length <= 194), true);


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
console.log('All checks passed');
