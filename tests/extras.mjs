// Season recaps, rival scouting, the leaders' weekly digest and monthly backups. Usage: node tests/extras.mjs
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { fakeApi } from './check.mjs';
import { SCHEMA, snapshotAll } from '../worker/history.js';
import { seasonRecap, scoutRivals, leaderDigest, backupFile } from '../worker/extras.js';
import { sendDigest, postBackup } from '../worker/discord.js';

const api = fakeApi(), calls = [];
// Like the real log: the clan's own fame is race points (≤ 10,000); its players' medals are the comparable number.
const rivalLog = (tag, fames) => ({ items: fames.map((f, i) => ({ standings: [{ rank: i % 2 + 1, clan: { tag: '#' + tag, fame: 10000 - i * 1000, participants: [{ fame: f - 500 }, { fame: 500 }] } }] })) });
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const body = opt.body instanceof FormData ? opt.body : opt.body ? JSON.parse(opt.body) : null;
  calls.push({ url, method: opt.method || 'GET', body });
  if (url.includes('proxy.royaleapi.dev')) {
    if (url.includes('%23AAA/riverracelog')) return Response.json(rivalLog('AAA', [50000, 48000, 52000]));
    if (url.includes('%23BBB/riverracelog')) return Response.json(rivalLog('BBB', [30000, 31000]));
    if (url.includes('%23PPCCR8VU/riverracelog')) return Response.json(url.includes('limit=5') ? rivalLog('PPCCR8VU', [40000, 42000]) : api.log);
    if (url.endsWith('/members')) return Response.json(api.members);
    if (url.includes('/currentriverrace')) return Response.json({ ...api.race, periodType: 'training', periodIndex: 2, sectionIndex: 0,
      clans: [{ tag: '#PPCCR8VU', name: '#WINNING', clanScore: 3000 }, { tag: '#AAA', name: 'Alpha', clanScore: 3400 }] });
  }
  if (/\/users\/@me\/channels$/.test(url)) return Response.json({ id: 'DM-' + body.recipient_id });
  if (/\/channels\/\w+\/messages$/.test(url) && opt.method === 'POST') return Response.json({ id: 'M' + calls.length });
  return new Response('{}', { status: 200 });
};
const DB = fakeD1();
const env = { DB, CR_API_KEY: 'k', DISCORD_PUBLIC_KEY: 'p', DISCORD_BOT_TOKEN: 'T', DISCORD_APP_ID: 'A', ALLOWED_CLANS: 'PPCCR8VU' };
await DB.exec(SCHEMA);
await DB.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  INSERT INTO kv (k, v) VALUES ('discord:G', '{"clan":"PPCCR8VU","channels":{"leaders":"LC","war":"W","results":"R"},"roles":{}}');`);
await DB.exec(`INSERT INTO members (clan, tag, name, in_clan, role) VALUES ${api.members.items.map(m => `('PPCCR8VU','${m.tag.slice(1)}','${m.name.replace(/'/g, "''")}',1,'${m.role}')`).join(',')};`);

// Season recap: from saved wars, compared with the season before.
const wp = (week, tag, name, fame) => `('PPCCR8VU','${week}','${tag}','${name}',${fame},16,0)`;
await DB.exec(`INSERT INTO war_players (clan,week,tag,name,fame,decks,boats) VALUES
  ${[['136-1', 1500], ['136-2', 1600], ['137-1', 2400], ['137-2', 2500], ['137-3', 2600], ['137-4', 2400]].map(([w, f]) => wp(w, 'AA', 'Riser', f)).join(',')},
  ${['137-1', '137-2', '137-3', '137-4'].map(w => wp(w, 'BB', 'Steady', 2000)).join(',')}, ${wp('137-1', 'CC', 'Once', 900)};
  INSERT INTO wars (clan,week,ended_at,rank,trophy_change) VALUES ('PPCCR8VU','137-1','2026-10-05T09:00:00Z',1,20),('PPCCR8VU','137-2','2026-10-12T09:00:00Z',2,10),
  ('PPCCR8VU','137-3','2026-10-19T09:00:00Z',1,20),('PPCCR8VU','137-4','2026-10-26T09:00:00Z',3,-5);`);
const sr = await seasonRecap(env, 'PPCCR8VU', 137);
assert.match(sr, /Season 137 recap\*\* · 4 wars/);
assert.match(sr, /Placings: 1st, 2nd, 1st, 3rd · \+45 war trophies/);
assert.match(sr, /🥇 Riser · 9,900 \(4\/4 wars at 1,800\+\)[\s\S]*🥈 Steady · 8,000[\s\S]*🥉 Once · 900 \(0\/1/);
assert.match(sr, /1,800\+ every war \(2\):\*\* Riser, Steady/);
assert.match(sr, /Most improved[^\n]*Riser \+925/);
assert.equal(await seasonRecap(env, 'PPCCR8VU', 99), null);

// Rival scouting: their last wars vs ours, biggest threat.
const sc = await scoutRivals(env, 'PPCCR8VU', '139-1', [{ tag: 'PPCCR8VU', name: '#WINNING', score: 3000 }, { tag: 'AAA', name: 'Alpha', score: 3400 }, { tag: 'BBB', name: 'Beta', score: 2500 }]);
assert.match(sc, /War 139-1: who we're up against[\s\S]*\*\*Alpha\*\* · 3,400 trophies\n   avg \*\*50,000\*\* medals · avg place 1\.3 · 2\/3 wins[\s\S]*\*\*Beta\*\*[\s\S]*\*\*Us\*\* · 3,000 trophies\n   avg \*\*41,000\*\*/);
assert.match(sc, /Biggest threat: \*\*Alpha\*\* \(about 9,000 more medals a war than us\)/);

// Weekly digest: worked out like the page; DM to leaders who asked, else the leaders' channel.
const dg = await leaderDigest(env, 'PPCCR8VU', 'G');
assert.match(dg, /Leaders' weekly digest[\s\S]*On a first & only warning|Nobody on a warning/);
assert.match(dg, /Close to Elder:\*\* James \(needs average 2,175 → 2,200\)/);
assert.match(dg, /Slipping\*\* \(last 3 wars vs before\): Pirate Steve -988/);
assert.match(dg, /\d+\/50 members/);
calls.length = 0;
assert.equal(await sendDigest(env, 'PPCCR8VU'), 1);
assert.match(calls.find(c => /channels\/LC\/messages$/.test(c.url)).body.content, /Not linked on Discord \(48\)/, 'nobody opted in: leaders channel');
await DB.exec(`INSERT INTO discord_digest (guild, user_id, dm) VALUES ('G', 'L1', 'DML1')`);
calls.length = 0;
assert.equal(await sendDigest(env, 'PPCCR8VU'), 2);
assert.ok(calls.some(c => /channels\/DML1\/messages$/.test(c.url)) && calls.some(c => /channels\/LC\/messages$/.test(c.url)), 'opted in: leaders channel and a private copy');

// Backup: gzipped full history that unzips to the same data; posted as a file.
const f = await backupFile(env, 'PPCCR8VU', Date.parse('2026-12-01T10:00:00Z'));
assert.equal(f.name, 'crtrack-PPCCR8VU-2026-12.json.gz');
const back = JSON.parse(await new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
assert.equal(back.clan, 'PPCCR8VU'); assert.equal(back.history.wars.length, 4); assert.ok(f.size < f.raw, 'compressed');
calls.length = 0;
assert.equal(await postBackup(env, 'PPCCR8VU'), 1);
const up = calls.find(c => /channels\/LC\/messages$/.test(c.url));
assert.ok(up.body instanceof FormData && up.body.get('files[0]').name === f.name.replace('2026-12', new Date().toISOString().slice(0, 7)));

// Schedule: backup once a month on a training day; scouting once per race; digest on the last training day.
await DB.exec(`INSERT INTO periods (clan,week,period,type,first_seen) VALUES ('PPCCR8VU','139-1',2,'training','2026-11-18T09:43:00Z')`);
calls.length = 0;
let out = await snapshotAll(env, { now: Date.parse('2026-11-18T10:00:00Z') });
assert.equal(out[0].backup, 1, 'monthly backup in a run of its own');
out = await snapshotAll(env, { now: Date.parse('2026-11-18T10:15:00Z') });
assert.ok(!('backup' in out[0]), 'only once a month');
const posted = calls.filter(c => c.method === 'POST' && /channels\/W\/messages$/.test(c.url));
assert.equal(posted.length, 1); assert.match(posted[0].body.content, /who we're up against[\s\S]*Alpha/, 'scouted the new race');
assert.ok(await DB.prepare("SELECT 1 FROM kv WHERE k = 'digest:due:PPCCR8VU'").first(), 'last training day: digest queued');
calls.length = 0;
out = await snapshotAll(env, { now: Date.parse('2026-11-18T10:30:00Z') });
assert.equal(out[0].stats, 0, 'the first snapshot saw finished wars: stats boards refresh first (none set up here)');
out = await snapshotAll(env, { now: Date.parse('2026-11-18T10:45:00Z') });
assert.equal(out[0].digest, 2, 'then the digest (channel + private copy), in a run of its own');
assert.ok(calls.some(c => /channels\/DML1\/messages$/.test(c.url)));
out = await snapshotAll(env, { now: Date.parse('2026-11-18T22:30:00Z') });
assert.ok(!('digest' in out[0]) && !calls.slice(1).some(c => /channels\/W\/messages$/.test(c.url) && c.method === 'POST'), 'each once a week');
console.log('Extras checks passed');
