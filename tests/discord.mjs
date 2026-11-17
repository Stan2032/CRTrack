// Checks the Discord bot with signed fake interactions and a fake Discord API. Usage: node tests/discord.mjs
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { handleApi } from '../worker/api.js';
import { discordPost, syncGuild } from '../worker/discord.js';
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
console.log('Discord checks passed');
