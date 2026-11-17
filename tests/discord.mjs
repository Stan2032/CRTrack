// Checks the Discord bot with signed fake interactions and a fake Discord API. Usage: node tests/discord.mjs
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { handleApi } from '../worker/api.js';
import { registerCommands, discordPost, syncGuild, warBoard, daySummary, rulesText, RULE_DEFAULTS, updateRulesMessages } from '../worker/discord.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SCHEMA } from '../worker/history.js';

// A test key pair, signing like Discord does.
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('hex');
async function interaction(body, { forge = false } = {}) {
  const ts = String(Math.floor(Date.now() / 1000)), text = JSON.stringify(body);
  const sig = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(ts + (forge ? 'x' : '') + text))).toString('hex');
  return handleApi(new Request('https://x.dev/api/discord', { method: 'POST', body: text, headers: { 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': ts } }), env, { waitUntil: p => pending.push(p) });
}
const pending = [], calls = [];
let currentRoles = ['OTHER'];
globalThis.fetch = async (url, opt = {}) => {
  calls.push({ url: String(url), method: opt.method, body: opt.body ? JSON.parse(opt.body) : null });
  if (/\/guilds\/G\/members\/U1$/.test(url) && opt.method === 'GET') return Response.json({ roles: currentRoles, nick: null });
  if (/\/guilds\/G2\/roles$/.test(url)) return Response.json([{ id: 'R1', name: 'Member' }, { id: 'R2', name: 'Elder' }, { id: 'R3', name: 'Co-Leader' }, { id: 'R4', name: 'Leader' }, { id: 'R5', name: 'War Audit' }]);
  if (/\/channels\/C\/messages$/.test(url) && opt.method === 'POST') return Response.json({ id: 'M' + calls.length });
  return new Response('{}', { status: 200 });
};

const DB = fakeD1();
const env = { DB, DISCORD_PUBLIC_KEY: pub, DISCORD_BOT_TOKEN: 'T', DISCORD_APP_ID: 'A', ALLOWED_CLANS: 'PPCCR8VU' };
await DB.exec(SCHEMA);
await DB.prepare("INSERT INTO members (clan, tag, name, role, in_clan) VALUES ('PPCCR8VU', '2VJ9V2PV', 'Luke', 'elder', 1), ('PPCCR8VU', 'YVJRGLCC', 'perc', 'member', 1)").run();
const leader = { user: { id: 'L' }, permissions: String(1n << 28n) }, member = id => ({ user: { id }, permissions: '0' });
const cmd = (name, options = [], m = member('U1')) => interaction({ type: 2, guild_id: 'G', member: m, data: { name, options } });
const text = async r => (await r.json()).data.content;

assert.equal((await (await interaction({ type: 1 })).json()).type, 1, 'endpoint check');
assert.equal((await interaction({ type: 1 }, { forge: true })).status, 401, 'forged request refused');

assert.match(await text(await cmd('links')), /Leaders only/);
assert.match(await text(await cmd('setup', [{ name: 'channel', value: 'C' }, { name: 'member_role', value: 'RM' }, { name: 'elder_role', value: 'RE' }], leader)), /<#C>/);

assert.match(await text(await cmd('link', [{ name: 'tag', value: '#2vj9v2pv' }])), /Linked <@U1> to \*\*Luke\*\*/);
await Promise.all(pending);
const patch = calls.find(c => c.method === 'PATCH' && /members\/U1$/.test(c.url));
assert.deepEqual(patch.body, { roles: ['OTHER', 'RE'], nick: 'Luke' }, 'Elder role added, other roles kept, nickname set');

assert.match(await text(await cmd('link', [{ name: 'tag', value: '#QQQQQ' }], member('U2'))), /isn't in the clan/);
assert.match(await text(await cmd('link', [{ name: 'tag', value: '#2VJ9V2PV' }], member('U2'))), /already linked/);
assert.match(await text(await cmd('me')), /Luke/);
assert.match(await text(await cmd('links', [], leader)), /Linked: 1 of 2[\s\S]*Not linked yet:\*\* perc/);

// Battle-day reminder pings linked members by mention, names otherwise, and only those users.
calls.length = 0;
assert.equal(await discordPost(env, 'PPCCR8VU', 'Battle day 2 ends in under 4 hours', '6 decks still to play:', [{ tag: '2VJ9V2PV', name: 'Luke', text: '(4 left)' }, { tag: 'YVJRGLCC', name: 'perc', text: '(2 left)' }]), 1);
const msg = calls.find(c => /channels\/C\/messages/.test(c.url)).body;
assert.match(msg.content, /<@U1> \(4 left\)/); assert.match(msg.content, /perc \(2 left\)/);
assert.deepEqual(msg.allowed_mentions, { parse: [], users: ['U1'] });

// Leaving the clan removes the clan role.
await DB.prepare("UPDATE members SET in_clan = 0 WHERE tag = '2VJ9V2PV'").run();
currentRoles = ['OTHER', 'RE'];
calls.length = 0;
await syncGuild(env, 'G', { roles: { member: 'RM', elder: 'RE' } }, 'PPCCR8VU');
assert.deepEqual(calls.find(c => c.method === 'PATCH').body, { roles: ['OTHER'] });

// Live war board: posted once, then edited in place.
calls.length = 0;
const board = { standings: [{ tag: 'AAA', name: 'Rival', fame: 22500 }, { tag: 'PPCCR8VU', name: '#WINNING', fame: 21000 }], members: 48, reached: 12, decksUsed: 140, decksTotal: 192, notPlayed: ['perc'], reset: '09:43' };
const r = { clan: 'PPCCR8VU', week: '138-3', day: 2, target: 1800, board };
await warBoard(env, r, Date.parse('2026-11-20T14:15:00Z'));
await warBoard(env, r, Date.parse('2026-11-20T14:30:00Z'));
assert.equal(calls.filter(c => c.method === 'POST' && /channels\/C\/messages/.test(c.url)).length, 1, 'posted once');
const edit = calls.find(c => c.method === 'PATCH' && /channels\/C\/messages\/M/.test(c.url));
assert.ok(edit, 'then edited'); assert.match(edit.body.content, /battle day 2 of 4[\s\S]*2nd of 2 · 21,000 medals · 1,500 behind Rival[\s\S]*12 of 48[\s\S]*140\/192 \(73%\)[\s\S]*Not played today: perc/);

// Day summary: medals gained with the change vs the day before, posted once.
await DB.exec(`INSERT INTO race_days (clan,week,day,tag,name,fame,decks,today,boats,at) VALUES
  ('PPCCR8VU','138-3',1,'2VJ9V2PV','Luke',800,4,4,0,'x'),('PPCCR8VU','138-3',2,'2VJ9V2PV','Luke',1700,8,4,0,'x'),
  ('PPCCR8VU','138-3',1,'YVJRGLCC','perc',500,4,4,0,'x'),('PPCCR8VU','138-3',2,'YVJRGLCC','perc',900,6,2,0,'x');
  INSERT INTO race_standings (clan,week,day,rival,name,fame,at) VALUES ('PPCCR8VU','138-3',1,'PPCCR8VU','#WINNING',10000,'x'),('PPCCR8VU','138-3',2,'PPCCR8VU','#WINNING',21000,'x'),('PPCCR8VU','138-3',2,'AAA','Rival',22500,'x');`);
calls.length = 0;
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 1);
const sum = calls.find(c => c.method === 'POST').body.content;
assert.match(sum, /Battle day 2 summary[\s\S]*\+11,000\*\* \(\+10% vs day 1\)[\s\S]*Decks used: 6\/8 \(75%\)[\s\S]*2nd of 2, 1,500 behind Rival[\s\S]*Luke \+900/);
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 0, 'only once');

// Rules: posted with /rules, then edited when the rules change.
calls.length = 0;
assert.match(await text(await interaction({ type: 2, guild_id: 'G', channel_id: 'C', member: leader, data: { name: 'rules', options: [] } })), /Rules posted here/);
assert.match(calls.find(c => c.method === 'POST').body.content, /1,800\+ medals every war/);
await DB.exec(`INSERT OR REPLACE INTO notes (clan,week,tag,kind,value,at) VALUES ('PPCCR8VU','*','*','rules','{"target":2000}','x')`);
calls.length = 0;
assert.equal(await updateRulesMessages(env, 'PPCCR8VU'), 1);
assert.match(calls.find(c => c.method === 'PATCH').body.content, /2,000\+ medals every war/);

// /setup without picking roles finds them by name.
assert.match(await text(await interaction({ type: 2, guild_id: 'G2', member: leader, data: { name: 'setup', options: [{ name: 'channel', value: 'C' }] } })), /Member → <@&R1>, Elder → <@&R2>, Co-leader → <@&R3>, Leader → <@&R4>/);

// Welcome / how-to-link message.
assert.match(await text(await interaction({ type: 2, guild_id: 'G', channel_id: 'C', member: leader, data: { name: 'welcome', options: [] } })), /Posted/);
assert.match(await text(await interaction({ type: 2, guild_id: 'G', channel_id: 'C', member: member('U9'), data: { name: 'welcome', options: [] } })), /Leaders only/);

// A channel the bot can't post in: told why, in plain words, and /setup changes nothing.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => /channels\/LOCKED\//.test(url) ? new Response('{}', { status: 403 }) : realFetch(url, opt);
assert.match(await text(await interaction({ type: 2, guild_id: 'G', channel_id: 'LOCKED', member: leader, data: { name: 'rules', options: [] } })), /missing permission[\s\S]*Send Messages/);
assert.match(await text(await cmd('setup', [{ name: 'channel', value: 'LOCKED' }], leader)), /missing permission[\s\S]*Nothing was changed/);
assert.match(await text(await cmd('me')), /Luke|linked/i);
globalThis.fetch = realFetch;

// Registering for one server also clears the all-servers copy (no duplicate commands).
calls.length = 0;
await registerCommands({ ...env, DISCORD_GUILD_ID: 'G' });
assert.ok(calls.some(c => c.method === 'PUT' && /applications\/A\/guilds\/G\/commands$/.test(c.url)));
assert.deepEqual(calls.find(c => c.method === 'PUT' && /applications\/A\/commands$/.test(c.url)).body, []);

// The bot's default rules match the site's.
const ctx = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../site/logic.js', import.meta.url), 'utf8'), ctx);
for (const [k, v] of Object.entries(RULE_DEFAULTS)) assert.equal(v, ctx.module.exports.DEFAULT_RULES[k], 'default for ' + k);
console.log('Discord checks passed');
