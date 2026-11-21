// Checks the Discord bot with signed fake interactions and a fake Discord API. Usage: node tests/discord.mjs
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { handleApi } from '../worker/api.js';
import { registerCommands, discordPost, syncGuild, warBoard, daySummary, rulesText, updateRulesMessages } from '../worker/discord.js';
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
  if (/\/channels\/CLC$/.test(url) && opt.method === 'PATCH' && globalThis.lockLeaders) return new Response('{}', { status: 403 });
  if (/\/guilds\/G\/members\/U1$/.test(url) && opt.method === 'GET') return Response.json({ roles: currentRoles, nick: null });
  if (/\/guilds\/G3\/roles$/.test(url) && (opt.method || 'GET') === 'GET') return Response.json([{ id: 'G3', name: '@everyone', position: 0, permissions: String((1n << 31n) | (1n << 10n) | 1n) },
    { id: 'BOTROLE', name: 'War Audit', position: 5, permissions: String((1n << 28n) | (1n << 4n) | (1n << 5n)) }, { id: 'RL', name: 'Leader', position: 6, permissions: '0' }, { id: 'RM3', name: 'Member', position: 1, permissions: '0' }]);
  if (/\/guilds\/G3\/roles$/.test(url) && opt.method === 'POST') return Response.json({ id: 'NEW-' + JSON.parse(opt.body).name });
  if (/\/guilds\/G3$/.test(url) && (opt.method || 'GET') === 'GET') return Response.json({ id: 'G3', icon: null });
  if (/\/guilds\/G3\/members\/A$/.test(url)) return Response.json({ roles: ['BOTROLE'] });
  if (/\/guilds\/G3\/channels$/.test(url) && (opt.method || 'GET') === 'GET') return Response.json([{ id: 'CW', type: 0, name: '⚔️-war' }, { id: 'CR', type: 0, name: '📜-rules' }, { id: 'CV', type: 2, name: 'voice' }, { id: 'CLC', type: 0, name: 'leaders-chat' }]);
  if (/\/channels\/CLC$/.test(url) && opt.method === 'PATCH') return Response.json({ id: 'CLC' });
  if (/\/guilds\/G3\/channels$/.test(url) && opt.method === 'POST') return Response.json({ id: 'NEWCH-' + JSON.parse(opt.body).name.replace(/[^a-z]/g, '') });
  if (/\/channels\/(NEWCH-\w*|CW|CR|CLC)\/messages$/.test(url) && opt.method === 'POST') return Response.json({ id: 'M' + calls.length });
  if (/\/channels\/(CW|CR|CV)$/.test(url) && opt.method === 'PATCH') return Response.json({ id: url.split('/').pop() });
  if (/\/guilds\/G2\/roles$/.test(url)) return Response.json([{ id: 'R1', name: 'Member' }, { id: 'R2', name: 'Elder' }, { id: 'R3', name: 'Co-Leader' }, { id: 'R4', name: 'Leader' }, { id: 'R5', name: 'War Audit' }]);
  if (/proxy\.royaleapi\.dev\/v1\/players\/%23PYLQ2$/.test(url)) return Response.json({ name: 'Newbie', expLevel: 40, trophies: 11000, bestTrophies: 11500, warDayWins: 30, clanCardsCollected: 900, totalDonations: 500, cards: Array.from({ length: 40 }, () => ({ level: 13, maxLevel: 16 })) });
  if (/proxy\.royaleapi\.dev\/v1\/players\/%23PYLQ2\/battlelog$/.test(url)) return Response.json([]);
  if (/proxy\.royaleapi\.dev\/v1\/clans\/%23PPCCR8VU$/.test(url)) return Response.json({ name: '#WINNING', requiredTrophies: 12500 });
  if (/proxy\.royaleapi\.dev\/v1\/players\/%232VJ9V2PV\/battlelog$/.test(url)) return Response.json(globalThis.battles || []);
  if (/proxy\.royaleapi\.dev\/v1\/players\/%232VJ9V2PV$/.test(url)) return Response.json({ name: 'Luke', currentDeck: (globalThis.deck || ['Knight', 'Zap']).map(name => ({ name })), cards: ['Knight', 'Zap', 'Archers', 'Giant', 'Arrows'].map(name => ({ name })) });
  if (/proxy\.royaleapi\.dev\/v1\/players\/%23QQQQQQ$/.test(url)) return new Response('{}', { status: 404 });
  if (/proxy\.royaleapi\.dev\/v1\/players\/%23YVJRGLCC$/.test(url)) return Response.json({ name: 'perc', expLevel: 50, trophies: 7000, bestTrophies: 7500, warDayWins: 120, clanCardsCollected: 50000, totalDonations: 9000, clan: { name: 'Other' }, role: 'elder' });
  if (/proxy\.royaleapi\.dev\/v1\/players\/%23YVJRGLCC\/battlelog$/.test(url)) return Response.json([{ type: 'riverRacePvP', battleTime: '20261116T120000.000Z', team: [{ crowns: 2 }], opponent: [{ crowns: 1 }] }, { type: 'boatBattle' }]);
  if (/\/users\/@me\/channels$/.test(url)) return JSON.parse(opt.body).recipient_id === 'BLOCKED' ? new Response('{}', { status: 403 }) : Response.json({ id: 'DM-' + JSON.parse(opt.body).recipient_id });
  if (/\/channels\/\w+\/messages\?limit=5$/.test(url)) return Response.json([{ id: 'NOTE', type: 6, message_reference: { message_id: url.includes('/pins/') ? '' : calls.filter(c => c.method === 'PUT' && /\/pins\//.test(c.url)).pop()?.url.split('/').pop() } }]);
  if (/\/channels\/C\/messages\?limit=50$/.test(url)) return Response.json([{ id: 'OLD1', author: { id: 'A' } }, { id: 'USER1', author: { id: 'U1' } }, { id: 'OLD2', author: { id: 'A' } }]);
  if (/\/channels\/(C|R|LC|J)\/messages$/.test(url) && opt.method === 'POST') return Response.json({ id: 'M' + calls.length });
  return new Response('{}', { status: 200 });
};

const DB = fakeD1();
const env = { DB, DISCORD_PUBLIC_KEY: pub, DISCORD_BOT_TOKEN: 'T', DISCORD_APP_ID: 'A', ALLOWED_CLANS: 'PPCCR8VU' };
await DB.exec(SCHEMA);
await DB.prepare("INSERT INTO members (clan, tag, name, role, in_clan) VALUES ('PPCCR8VU', '2VJ9V2PV', 'Luke', 'elder', 1), ('PPCCR8VU', 'YVJRGLCC', 'perc', 'member', 1)").run();
const leader = { user: { id: 'L' }, permissions: String(1n << 28n) }, member = id => ({ user: { id }, permissions: '0' });
const cmd = (name, options = [], m = member('U1')) => interaction({ type: 2, guild_id: 'G', member: m, data: { name, options } });
const text = async r => (await r.json()).data.content;
const runRefresh = async (guild, cfgx, clean) => {
  const { refreshAll: ra, refreshNext: rn } = await import('../worker/discord.js');
  let r = await ra(env, guild, cfgx, 'PPCCR8VU', clean), all = [r.content], n = 0;
  while (r.components?.length && n++ < 20) { r = await rn(env, guild, 'PPCCR8VU'); all.push(r.content); }
  return all.join('\n');
};

assert.equal((await (await interaction({ type: 1 })).json()).type, 1, 'endpoint check');
assert.equal((await interaction({ type: 1 }, { forge: true })).status, 401, 'forged request refused');

assert.match(await text(await cmd('links')), /Leaders only/);
const here = (what, ch = 'C', g = 'G', m = leader) => interaction({ type: 2, guild_id: g, channel_id: ch, member: m, data: { name: 'post-here', options: [{ name: 'what', value: what }] } });
assert.match(await text(await cmd('setup', [{ name: 'member_role', value: 'RM' }, { name: 'elder_role', value: 'RE' }], leader)), /War board \+ battle-day reminders → _not set_[\s\S]*Member → <@&RM>, Elder → <@&RE>/);
assert.match(await text(await here('war')), /War board \+ battle-day reminders → <#C>[\s\S]*summaries \+ war results → _not set_/);
await Promise.all(pending);
assert.ok(calls.some(c => c.method === 'DELETE' && /channels\/C\/messages\/M\d+$/.test(c.url)), 'test post removed');
assert.match(await text(await here('war', 'C', 'G', member('U5'))), /Leaders only/);

// /link: prove the tag is yours by putting 2 of your own cards into your current deck; Check confirms it from the game's data.
const proof = await (await cmd('link', [{ name: 'tag', value: '#2vj9v2pv' }])).json();
assert.match(proof.data.content, /To prove \*\*Luke\*\* \(#2VJ9V2PV\)[\s\S]*put \*\*(Archers|Giant|Arrows)\*\* and \*\*(Archers|Giant|Arrows)\*\* in your deck[\s\S]*Play \*\*one battle\*\*/, 'cards they own, not already in the deck');
assert.equal(proof.data.components[0].components[0].custom_id, 'verify|check');
const check = m => interaction({ type: 3, guild_id: 'G', member: m, data: { custom_id: 'verify|check' } });
let chk = (await (await check(member('U1'))).json()).data;
assert.match(chk.content, /Not yet:\*\* no battle since you started/); assert.equal(chk.components.length, 1, 'button stays');
assert.equal(await DB.prepare("SELECT 1 FROM discord_links WHERE user_id = 'U1'").first(), null, 'not linked yet');
const want = JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'verify:G:U1'").first()).v).cards;
const bt = (ms, cards, tag = '#2VJ9V2PV') => ({ battleTime: new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000Z'), team: [{ tag, cards: cards.map(name => ({ name })) }] });
globalThis.battles = [bt(Date.now(), ['Knight', want[0]]), bt(Date.now() - 3600e3, ['Knight', ...want]), bt(Date.now(), [...want], '#OTHER')];
assert.match((await (await check(member('U1'))).json()).data.content, /Not yet/, 'one card only, an old battle, or someone else: not proof');
assert.match((await (await cmd('link', [{ name: 'tag', value: '#2VJ9V2PV' }])).json()).data.content, new RegExp(`${want[0]}\\*\\* and \\*\\*${want[1]}`), 'asking again keeps the same two cards');
globalThis.battles = [bt(Date.now(), ['Knight', 'Zap', ...want])];
calls.length = 0;
chk = (await (await check(member('U1'))).json()).data;
assert.match(chk.content, /Proven and linked\*\* to \*\*Luke\*\*/); assert.equal(chk.components.length, 0);
await Promise.all(pending);
assert.match((await (await check(member('U1'))).json()).data.content, /Nothing to check/, 'done once');
globalThis.battles = null;
const patch = calls.find(c => c.method === 'PATCH' && /members\/U1$/.test(c.url));
assert.deepEqual(patch.body, { roles: ['OTHER', 'RE'], nick: 'Luke' }, 'Elder role added, other roles kept, nickname set');

assert.match(await text(await cmd('link', [{ name: 'tag', value: '#QQQQQ' }], member('U2'))), /isn't in the clan/);
// Someone else typing Luke's tag only gets the proof step; the link stays with the proven owner.
assert.match(await text(await cmd('link', [{ name: 'tag', value: '#2VJ9V2PV' }], member('U2'))), /To prove \*\*Luke\*\*/);
assert.equal((await DB.prepare("SELECT user_id FROM discord_links WHERE tag = '2VJ9V2PV'").first()).user_id, 'U1');
assert.match(await text(await cmd('link', [{ name: 'tag', value: '#2VJ9V2PV' }])), /Linked <@U1>/, 'already proven: no second proof');
{ const me = (await (await cmd('me')).json()).data; assert.equal(me.embeds[0].author.name, 'Luke'); assert.equal(me.flags, 64, 'only you'); }
assert.equal((await (await cmd('me', [{ name: 'share', value: true }])).json()).data.flags, 0, 'shared');
assert.match(await text(await cmd('links', [], leader)), /Linked: 1 of 2[\s\S]*Not linked yet:\*\* perc/);

// /away: saved as a shared note the page reads, posted to the leaders' channel.
assert.match(await text(await here('leaders', 'LC')), /Leaders only: absences, digest, backups → <#LC>/);
calls.length = 0;
assert.match(await text(await cmd('away', [{ name: 'days', value: 3 }, { name: 'reason', value: 'holiday' }])), /away until \*\*.+\*\*[\s\S]*leaders decide/);
await Promise.all(pending);
const awayNote = await DB.prepare("SELECT value FROM notes WHERE kind = 'away' AND tag = '2VJ9V2PV'").first();
assert.equal(JSON.parse(awayNote.value).reason, 'holiday');
assert.match(calls.find(c => c.method === 'POST' && /channels\/LC\/messages$/.test(c.url)).body.content, /🏖️ \*\*Luke\*\* is away until .+: holiday/);
assert.match(await text(await cmd('away', [{ name: 'days', value: 1 }, { name: 'user', value: 'U1' }], member('U7'))), /Only leaders/);
assert.match(await text(await cmd('away', [{ name: 'days', value: 0 }])), /Welcome back/);
assert.equal(await DB.prepare("SELECT 1 FROM notes WHERE kind = 'away'").first(), null, 'cleared');

// Old to-do buttons (the list is on the website now) just say so.
assert.match(await text(await interaction({ type: 3, guild_id: 'G', member: leader, data: { custom_id: 'todo|1-1|Warn|do' } })), /on the website/);

// Grouped commands: /leader links, /setup show, /clan stats route to the same handlers; members can't use leader ones.
const grouped = (name, subName, options = [], m = leader) => interaction({ type: 2, guild_id: 'G', member: m, data: { name, options: [{ type: 1, name: subName, options }] } });
assert.match(await text(await grouped('leader', 'links')), /Linked: /);
assert.match(await text(await grouped('leader', 'links', [], member('U5'))), /Leaders only/);
assert.match(await text(await grouped('setup', 'show')), /What the bot posts where/);
assert.match(await text(await grouped('clan', 'stats', [], member('U5'))), /Clan stats/);
{ const { COMMANDS } = await import('../worker/discord.js');
  assert.equal(COMMANDS.length, 11, '11 commands');
  assert.equal(COMMANDS.find(c => c.name === 'leader').default_member_permissions, '1', 'leader commands hidden from members');
  assert.equal(COMMANDS.find(c => c.name === 'setup').default_member_permissions, '1');
  assert.ok(!COMMANDS.find(c => c.name === 'mystats').default_member_permissions, 'member commands visible to all');
  for (const c of COMMANDS) { assert.ok(c.description.length <= 100, c.name); for (const o of c.options || []) assert.ok(o.description.length <= 100, c.name + ' ' + o.name); } }

// Battle-day reminder pings linked members by mention, names otherwise, and only those users.
calls.length = 0;
assert.equal(await discordPost(env, 'PPCCR8VU', 'Battle day 2 ends in under 4 hours', '6 decks still to play:', [{ tag: '2VJ9V2PV', name: 'Luke', text: '(4 left)' }, { tag: 'YVJRGLCC', name: 'perc', text: '(2 left)' }]), 1);
const msg = calls.find(c => /channels\/C\/messages/.test(c.url)).body;
assert.match(msg.content, /<@U1> \(4 left\)/); assert.match(msg.content, /perc \(2 left\)/);
assert.deepEqual(msg.allowed_mentions, { parse: [], users: ['U1'] });
// Someone with /remind on gets the DM, not a second ping in #war.
await DB.exec(`INSERT OR REPLACE INTO discord_reminders (guild, user_id, hours, dm) VALUES ('G', 'U1', 3, 'DM-U1')`);
calls.length = 0;
await discordPost(env, 'PPCCR8VU', 'Battle day 2 ends in under 4 hours', '6 decks still to play:', [{ tag: '2VJ9V2PV', name: 'Luke', text: '(4 left)' }]);
{ const m2 = calls.find(c => /channels\/C\/messages/.test(c.url)).body;
  assert.match(m2.content, /• Luke \(4 left\) 📩[\s\S]*📩 = reminded by DM/); assert.deepEqual(m2.allowed_mentions.users, [], 'not pinged'); }
await DB.exec(`DELETE FROM discord_reminders WHERE user_id = 'U1'`);

// Battle-day pings at sensible times: an evening nudge (19:00 UK by default, or the clan's busiest hours) and a last call
// 2 hours before reset; each once per battle day. (Before: one ping in the last 4 hours, i.e. ~05:45 UK for a 09:43 reset.)
{ const { battleDayPings, nextUkHour, busiestHour } = await import('../worker/discord.js');
  assert.equal(nextUkHour(Date.parse('2026-07-10T09:43:00Z'), 19), Date.parse('2026-07-10T18:00:00Z'), 'summer: 19:00 UK is 18:00 UTC');
  assert.equal(nextUkHour(Date.parse('2026-11-19T09:43:00Z'), 19), Date.parse('2026-11-19T19:00:00Z'));
  const start = Date.parse('2026-11-19T09:43:00Z'), at = iso => { const t = Date.parse(iso); return [t, start + 864e5 - t]; };
  const r = { clan: 'PPCCR8VU', week: '139-1', day: 1, decksLeft: 6, leftToday: [{ tag: 'YVJRGLCC', name: 'perc', left: 2 }], board: { reset: '09:43' } };
  const posts = () => calls.filter(c => c.method === 'POST' && /channels\/C\/messages$/.test(c.url)).map(c => c.body.content);
  calls.length = 0;
  let res = await battleDayPings(env, r, ...at('2026-11-19T15:00:00Z'));
  assert.ok(!res.evening && !res.lastCall && !posts().length, 'afternoon: nothing yet');
  res = await battleDayPings(env, r, ...at('2026-11-19T19:05:00Z'));
  assert.ok(res.evening); assert.match(posts()[0], /Battle day 1: decks still to play \(resets 09:43 UK\)[\s\S]*6 decks left:[\s\S]*perc \(2 left\)/);
  await battleDayPings(env, { ...r, leftToday: [{ tag: 'YVJRGLCC', name: 'perc', left: 1 }] }, ...at('2026-11-19T19:20:00Z'));
  assert.equal(posts().length, 1, 'evening once');
  const ed = calls.filter(c => c.method === 'PATCH' && /channels\/C\/messages\//.test(c.url)).pop();
  assert.ok(ed && /perc \(1 left\)/.test(ed.body.content) && /decks still to play/.test(ed.body.content), 'in between: the same message is edited as people play');
  calls.length = 0;
  res = await battleDayPings(env, r, ...at('2026-11-20T07:50:00Z'));
  assert.ok(res.lastCall); assert.match(posts()[0], /Last call: battle day 1 ends in about 2 hours/);
  assert.ok(calls.some(c => c.method === 'DELETE' && /channels\/C\/messages\//.test(c.url)), 'last call replaces the evening message (a new post notifies)');
  calls.length = 0;
  await battleDayPings(env, { ...r, leftToday: [] }, ...at('2026-11-20T08:05:00Z'));
  assert.match(calls.find(c => c.method === 'PATCH').body.content, /Everyone has played all 4 decks today/);
  calls.length = 0;
  { const t = Date.parse('2026-11-20T10:00:00Z'); await battleDayPings(env, { ...r, day: 2 }, t, Date.parse('2026-11-21T09:43:00Z') - t); }
  assert.ok(calls.some(c => c.method === 'DELETE') && !posts().length, 'next battle day: yesterday\'s list is removed');
  // With the race on the board, pings say what today's medals are worth.
  const { raceStake } = await import('../worker/discord.js');
  assert.equal(raceStake({ standings: [{ tag: 'AAA', name: 'Rival', today: 9000, place: 0, next: null }, { tag: 'PPCCR8VU', name: '#WINNING', today: 8000, place: 1, next: 'AAA' }], started: true }, 'PPCCR8VU'),
    "📅 We're **2nd** on medals today (+1,800 race points). **1,001** more passes Rival: **+1,200**.");
  assert.equal(raceStake({ standings: [], started: true }, 'PPCCR8VU'), '', 'nothing known: no line');
  // Leaders set their own time and turn the last call off.
  assert.match(await text(await interaction({ type: 2, guild_id: 'G', member: leader, data: { name: 'setup', options: [{ type: 1, name: 'pings', options: [{ name: 'hour', value: 21 }, { name: 'last_call', value: 0 }] }] } })),
    /Evening: \*\*21:00 UK\*\*[\s\S]*Last call: off/);
  const r2 = { ...r, day: 2 }, s2 = Date.parse('2026-11-20T09:43:00Z'), at2 = iso => { const t = Date.parse(iso); return [t, s2 + 864e5 - t]; };
  calls.length = 0;
  await battleDayPings(env, r2, ...at2('2026-11-20T20:00:00Z')); assert.equal(posts().length, 0, '21:00 not reached');
  await battleDayPings(env, r2, ...at2('2026-11-20T21:01:00Z')); assert.equal(posts().length, 1);
  await battleDayPings(env, r2, ...at2('2026-11-21T08:30:00Z')); assert.equal(posts().length, 1, 'no last call');
  // Auto: the start of the clan's busiest 3 hours, from when decks were played.
  await DB.exec(`INSERT INTO race_events (clan,week,tag,at,day,fame,decks,today,boats) VALUES ${Array.from({ length: 40 }, (_, k) => `('PPCCR8VU','138-3','T${k}','${new Date(Date.now() - 864e5 - k * 6e4).toISOString().slice(0, 11)}${['20', '21', '22'][k % 3]}:1${k % 10}:00.000Z',1,0,1,1,0)`).join(',')}`);
  await DB.exec(`INSERT INTO race_events (clan,week,tag,at,day,fame,decks,today,boats) VALUES ${Array.from({ length: 60 }, (_, k) => `('PPCCR8VU','138-3','M${k}','${new Date(Date.now() - 864e5 - k * 6e4).toISOString().slice(0, 11)}${['10', '11', '12'][k % 3]}:2${k % 10}:00.000Z',1,0,1,1,0)`).join(',')}`);
  const bh = await busiestHour(env, 'PPCCR8VU');
  assert.ok(bh >= 16 && bh <= 20, 'busier mornings (just after the reset) are ignored: the ping is for later in the day: ' + bh);
  assert.ok(bh >= 19 && bh <= 21, 'busiest evening hours found: ' + bh);
  assert.match(await text(await interaction({ type: 2, guild_id: 'G', member: leader, data: { name: 'setup', options: [{ type: 1, name: 'pings', options: [{ name: 'auto', value: true }, { name: 'last_call', value: 2 }] }] } })), /auto: start of the clan's busiest hours/);
  await DB.exec(`DELETE FROM race_events WHERE week = '138-3'`); }

// /remind: checks a private message gets through, then DMs once per battle day when time is short.
const { dmReminders } = await import('../worker/discord.js');
calls.length = 0;
assert.match(await text(await cmd('remind', [{ name: 'hours', value: 3 }])), /3 hours\*\* left/);
assert.ok(calls.some(c => c.url.endsWith('/channels/DM-U1/messages')), 'test DM sent');
await DB.prepare("INSERT INTO discord_links (guild, user_id, clan, tag) VALUES ('G', 'BLOCKED', 'PPCCR8VU', 'YVJRGLCC')").run();
assert.match(await text(await cmd('remind', [{ name: 'hours', value: 3 }], member('BLOCKED'))), /can't send you private messages/);
const leftNow = [{ tag: '2VJ9V2PV', name: 'Luke', left: 2 }];
calls.length = 0;
assert.equal(await dmReminders(env, 'PPCCR8VU', '138-3', 2, 5 * 3600e3, leftNow), 0, 'not yet: 5 hours left');
assert.equal(await dmReminders(env, 'PPCCR8VU', '138-3', 2, 2.5 * 3600e3, leftNow, '09:43'), 1);
assert.match(calls.find(c => c.url.endsWith('/channels/DM-U1/messages')).body.content, /Battle day 2 ends in about 3 hours \(09:43 UK\)[\s\S]*\*\*2 decks\*\*/);
assert.equal(await dmReminders(env, 'PPCCR8VU', '138-3', 2, 1 * 3600e3, leftNow), 0, 'once per day');
assert.equal(await dmReminders(env, 'PPCCR8VU', '138-3', 3, 1 * 3600e3, []), 0, 'all decks played: nothing');
assert.match(await text(await cmd('remind', [{ name: 'hours', value: 0 }])), /Reminders off/);

// Leaving the clan removes the clan role.
await DB.prepare("UPDATE members SET in_clan = 0 WHERE tag = '2VJ9V2PV'").run();
currentRoles = ['OTHER', 'RE'];
calls.length = 0;
await syncGuild(env, 'G', { roles: { member: 'RM', elder: 'RE' } }, 'PPCCR8VU');
assert.deepEqual(calls.find(c => c.method === 'PATCH' && /members\/U1$/.test(c.url)).body, { roles: ['OTHER'] });

// Live war board: posted once, then edited in place. The race is race points (raceOutlook): if today ended now,
// today's place on medals and what passing the next clan is worth; the projection needs some logged days.
const { raceOutlook } = await import('../worker/logic.gen.js');
const liveRace = logs => ({ periodType: 'warDay', periodIndex: 18, sectionIndex: 2, periodLogs: logs, clans: [
  { tag: '#AAA', name: 'Rival', fame: 3000, periodPoints: 9000, participants: [{ fame: 29000 }] },
  { tag: '#PPCCR8VU', name: '#WINNING', fame: 1800, periodPoints: 8000, participants: [{ fame: 30000 }] }] });
const boardOf = race => { const o = raceOutlook(race); return { standings: o.rows, colosseum: o.colosseum, started: o.started, members: 48, reached: 12, decksUsed: 140, decksTotal: 192, notPlayed: ['perc'], reset: '09:43', doneDecks: 150, doneDecksTotal: 192 }; };
const board = boardOf(liveRace([]));
const r = { clan: 'PPCCR8VU', week: '138-3', day: 2, target: 1800, board };
await warBoard(env, r, Date.parse('2026-11-20T14:15:00Z'));
await warBoard(env, r, Date.parse('2026-11-20T14:30:00Z'));
assert.equal(calls.filter(c => c.method === 'POST' && /channels\/C\/messages/.test(c.url)).length, 1, 'posted once');
const edit = calls.find(c => c.method === 'PATCH' && /channels\/C\/messages\/M/.test(c.url));
assert.ok(edit, 'then edited');
assert.match(edit.body.content, /battle day 2 of 4[\s\S]*Race: \*\*2nd\*\* of 2 · 3,600 race points if today ended now · 2,400 behind Rival[\s\S]*Today: \*\*2nd\*\* on medals \(8,000\) = \+1,800 · 1,001 more medals to pass Rival = \*\*\+1,200\*\*[\s\S]*12 of 48[\s\S]*140\/192 \(73%\)[\s\S]*Not played today: perc/);
assert.doesNotMatch(edit.body.content, /recent form/, 'no logged days: no projection');
assert.match(edit.body.content, /🗓️ Day 1: 150\/192 decks played \(42 missed\)/, 'missed counts finished days only');
calls.length = 0;
await warBoard(env, { ...r, board: boardOf(liveRace([{ periodIndex: 17, items: [{ clan: { tag: '#AAA' }, pointsEarned: 20000, progressEarnedFromDefenses: 0 }, { clan: { tag: '#PPCCR8VU' }, pointsEarned: 22000, progressEarnedFromDefenses: 100 }] }])) }, Date.parse('2026-11-20T14:30:00Z'));
assert.match(calls.find(c => c.method === 'PATCH').body.content, /On recent form: \*\*1st\*\* \(~10,000\) · next Rival ~8,400/, 'usual medals: we win the next days; capped at the 10,000 finish');
// A new war's board replaces the last war's: the old one is deleted (its result is in #results).
{ const oldId = JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k LIKE 'discord:board:%:138-3'").first()).v).id;
  calls.length = 0;
  await warBoard(env, { ...r, week: '139-1', day: 1 }, Date.parse('2026-11-26T10:00:00Z'));
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/messages/' + oldId)), 'last war\'s board removed');
  assert.equal(await DB.prepare("SELECT 1 FROM kv WHERE k LIKE 'discord:board:%:138-3'").first(), null);
  await DB.exec("DELETE FROM kv WHERE k LIKE 'discord:board:%:139-1'"); }

// Day summary: medals gained with the change vs the day before, posted once.
await DB.exec(`INSERT INTO race_days (clan,week,day,tag,name,fame,decks,today,boats,at) VALUES
  ('PPCCR8VU','138-3',1,'2VJ9V2PV','Luke',800,4,4,0,'x'),('PPCCR8VU','138-3',2,'2VJ9V2PV','Luke',1700,8,4,0,'x'),
  ('PPCCR8VU','138-3',1,'YVJRGLCC','perc',500,4,4,0,'x'),('PPCCR8VU','138-3',2,'YVJRGLCC','perc',900,6,2,0,'x');
  INSERT INTO race_standings (clan,week,day,rival,name,fame,medals,at) VALUES ('PPCCR8VU','138-3',1,'PPCCR8VU','#WINNING',1000,20000,'x'),('PPCCR8VU','138-3',2,'PPCCR8VU','#WINNING',2800,22000,'x'),('PPCCR8VU','138-3',2,'AAA','Rival',4000,25000,'x');`);
await DB.exec(`INSERT INTO race_days (clan,week,day,tag,name,fame,decks,today,boats,at) VALUES ('PPCCR8VU','138-3',2,'LATE1','Latecomer',0,0,0,0,'x');
  INSERT INTO periods (clan,week,period,type,first_seen) VALUES ('PPCCR8VU','138-3',17,'warDay','2026-11-19T09:45:00Z'),('PPCCR8VU','138-3',18,'warDay','2026-11-20T09:45:00Z');
  INSERT INTO member_events (clan,tag,at,kind,detail) VALUES ('PPCCR8VU','LATE1','2026-11-20T15:00:00Z','join','');`);
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 0, 'no results channel yet: nothing posted');
await DB.prepare("DELETE FROM kv WHERE k LIKE 'dsum:%'").run();
await here('results', 'R');
calls.length = 0;
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 1);
assert.ok(calls.some(c => c.method === 'POST' && /channels\/R\/messages$/.test(c.url)), 'summary went to the results channel');
const sum = calls.find(c => c.method === 'POST').body.content;
assert.match(sum, /Battle day 2 summary[\s\S]*\+22,000\*\* \(\+10% vs day 1\) · \*\*2nd\*\* of 2 clans today[\s\S]*Race points: \*\*\+1,800\*\*[\s\S]*Decks used: 6\/8 \(75%\)[\s\S]*Race: \*\*2nd\*\* of 2, 2,800 race points, 1,200 behind Rival[\s\S]*Luke \+900[\s\S]*Missed decks: \*\*2 unused\*\* · perc 2/);
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 0, 'only once');
await DB.exec(`DELETE FROM race_days WHERE tag = 'LATE1'; DELETE FROM member_events WHERE tag = 'LATE1'; DELETE FROM periods WHERE week = '138-3' AND period IN (17, 18);`);

// Rules: posted with /rules, then edited when the rules change.
calls.length = 0;
assert.match(await text(await here('rules')), /Posted/);
assert.match(calls.find(c => c.method === 'POST').body.content, /1,800\+ medals every war/);
await DB.exec(`INSERT OR REPLACE INTO notes (clan,week,tag,kind,value,at) VALUES ('PPCCR8VU','*','*','rules','{"target":2000}','x')`);
calls.length = 0;
assert.equal(await updateRulesMessages(env, 'PPCCR8VU'), 1);
assert.match(calls.find(c => c.method === 'PATCH').body.content, /2,000\+ medals every war/);

// /setup without picking roles finds them by name.
assert.match(await text(await interaction({ type: 2, guild_id: 'G2', member: leader, data: { name: 'setup', options: [] } })), /Member → <@&R1>, Elder → <@&R2>, Co-leader → <@&R3>, Leader → <@&R4>/);

// Welcome / how-to-link message.
assert.match(await text(await here('welcome')), /Posted/);
assert.match(await text(await here('welcome', 'C', 'G', member('U9'))), /Leaders only/);

// A channel the bot can't post in: told why, in plain words, and /setup changes nothing.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => /channels\/LOCKED\//.test(url) ? new Response('{}', { status: 403 }) : realFetch(url, opt);
assert.match(await text(await here('rules', 'LOCKED')), /missing permission[\s\S]*Send Messages/);
assert.match(await text(await here('results', 'LOCKED')), /missing permission[\s\S]*Nothing was changed/);
assert.match(await text(await cmd('setup', [], leader)), /summaries \+ war results → <#R>/, 'locked channel not saved');
globalThis.fetch = realFetch;

// Registering for one server also clears the all-servers copy (no duplicate commands).
calls.length = 0;
await registerCommands({ ...env, DISCORD_GUILD_ID: 'G' });
assert.ok(calls.some(c => c.method === 'PUT' && /applications\/A\/guilds\/G\/commands$/.test(c.url)));
assert.deepEqual(calls.find(c => c.method === 'PUT' && /applications\/A\/commands$/.test(c.url)).body, []);

assert.match(await text(await here('none', 'R')), /won't post[\s\S]*summaries \+ war results → _not set_/);

// Shout-outs after a war: top 3 and streak milestones (every 5 in a row), current members only.
const { shoutOuts, playerCard, recruitCard, bar } = await import('../worker/discord.js');
await DB.prepare("UPDATE members SET in_clan = 1").run();
await DB.exec(`INSERT INTO war_players (clan,week,tag,name,fame,decks,boats) VALUES
  ('PPCCR8VU','1-1','2VJ9V2PV','Luke',2000,16,0),('PPCCR8VU','1-2','2VJ9V2PV','Luke',2000,16,0),('PPCCR8VU','1-3','2VJ9V2PV','Luke',2000,16,0),
  ('PPCCR8VU','1-4','2VJ9V2PV','Luke',2000,16,0),('PPCCR8VU','2-1','2VJ9V2PV','Luke',2600,16,0),('PPCCR8VU','2-1','YVJRGLCC','perc',1500,16,8);`);
await here('joins', 'J');
calls.length = 0;
assert.equal(await shoutOuts(env, 'PPCCR8VU', '2-1', 1800), 1);
assert.match(calls.find(c => /channels\/J\/messages$/.test(c.url)).body.content, /War 2-1 shout-outs[\s\S]*🥇 Luke 2,600 · 🥈 perc 1,500[\s\S]*🔥 Luke: \*\*5 wars in a row\*\*/);

// War report by DM after each war (/warreport): the member's own result, once per war.
{ const { sendWarReports, warReportText } = await import('../worker/discord.js');
  await DB.exec(`INSERT OR REPLACE INTO wars (clan,week,ended_at,rank,fame) VALUES ('PPCCR8VU','2-1','2026-10-29T09:43:00Z',1,0)`);
  assert.match(await text(await cmd('warreport', [{ name: 'on', value: true }])), /DM after each war/);
  calls.length = 0;
  assert.equal(await sendWarReports(env, 'PPCCR8VU'), 0);
  const dm = calls.find(c => c.method === 'POST' && c.url.endsWith('/channels/DM-U1/messages')).body.content;
  assert.match(dm, /Your war 2-1: 2,600\*\* medals, 16\/16 battles ✅ \(target 2,000\)[\s\S]*1st of 2 in the clan[\s\S]*5 wars in a row at 2,000\+[\s\S]*Reliability \d+ → \*\*\d+\*\*\/100/);
  calls.length = 0;
  await sendWarReports(env, 'PPCCR8VU');
  assert.ok(!calls.some(c => c.url.endsWith('/channels/DM-U1/messages')), 'once per war');
  assert.match(warReportText('YVJRGLCC', '2-1', [{ week: '2-1', tag: 'YVJRGLCC', fame: 1500, decks: 16 }], [{ tag: 'YVJRGLCC', fame: 1500 }], 1800), /❌ \(target 1,800: 300 short\)/);
  assert.match(warReportText('NOPE', '2-1', [], [], 1800), /didn't play this one/);
  assert.match(await text(await cmd('warreport', [{ name: 'on', value: false }])), /War reports off/);
  await DB.exec(`DELETE FROM wars WHERE clan = 'PPCCR8VU'`); }

// /apply: an application card in #leaders (record, readiness, trophy requirement) with Accept / Decline; the applicant is told.
{ await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:G', '${JSON.stringify({ ...JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G'").first()).v), channels: { war: 'C', leaders: 'LC', guests: 'GU' } })}')`);
  const apply = (tag, m = member('U30')) => interaction({ type: 2, guild_id: 'G', member: m, data: { name: 'apply', options: [{ name: 'tag', value: tag }] } });
  assert.match(await text(await apply('#YVJRGLCC')), /already in the clan/);
  calls.length = 0;
  assert.equal((await (await apply('#pylq2')).json()).type, 5);
  await Promise.all(pending);
  const card = calls.find(c => c.method === 'POST' && /channels\/LC\/messages$/.test(c.url)).body;
  assert.match(card.content, /Application\*\* from <@U30>[\s\S]*Newbie[\s\S]*War readiness: best 32 cards average \*\*level 13\.0\*\* \(a bit low\)[\s\S]*Clan requirement 12,500 trophies: ❌ below it/);
  assert.deepEqual(card.components[0].components.map(b => b.custom_id), ['apply|yes|U30|PYLQ2', 'apply|no|U30|PYLQ2']);
  assert.match(calls.find(c => /webhooks\/A\/.*@original$/.test(c.url)).body.content, /Sent to the leaders/);
  assert.match(await text(await apply('#PYLQ2')), /with the leaders/, 'one at a time');
  // Members can't decide; a leader accepts and the applicant is told by DM.
  const decide = (how, m) => interaction({ type: 3, guild_id: 'G', member: m, message: { content: card.content }, data: { custom_id: `apply|${how}|U30|PYLQ2` } });
  assert.match(await text(await decide('yes', member('U31'))), /Leaders only/);
  calls.length = 0;
  const done = (await (await decide('yes', leader)).json()).data;
  assert.match(done.content, /✅ \*\*Accepted\*\* by .*\(told by DM\)/); assert.equal(done.components.length, 0);
  assert.match(calls.find(c => c.url.endsWith('/channels/DM-U30/messages')).body.content, /accepted into the clan[\s\S]*#PPCCR8VU[\s\S]*\/link #PYLQ2/);
  assert.match(await text(await apply('#PYLQ2')), /apply again tomorrow/);
  // Declined with DMs closed: told in the waiting room instead.
  await DB.exec(`DELETE FROM kv WHERE k = 'apply:G:BLOCKED'`);
  calls.length = 0;
  const d2 = (await (await interaction({ type: 3, guild_id: 'G', member: leader, message: { content: 'x' }, data: { custom_id: 'apply|no|BLOCKED|PYLQ2' } })).json()).data;
  assert.match(d2.content, /Declined\*\* by .*told in the waiting room/);
  assert.match(calls.find(c => /channels\/GU\/messages$/.test(c.url)).body.content, /<@BLOCKED> Thanks for applying/); }

// War readiness: game levels from per-rarity levels (epic 11/11 = 16); the best 32 cards (4 decks, no repeats).
{ const { warReadiness } = await import('../worker/discord.js');
  const card = (level, maxLevel) => ({ level, maxLevel });
  const maxed = [...Array(20).fill(card(16, 16)), ...Array(12).fill(card(11, 11))];
  assert.match(warReadiness(maxed).text, /average \*\*level 16\.0\*\* \(war-ready\) · 32\/32 at level 14\+/);
  const mixed = [...Array(16).fill(card(14, 14)), ...Array(16).fill(card(10, 14)), ...Array(10).fill(card(1, 16))];   // rares 14/14 = 16, 10/14 = 12
  const w = warReadiness(mixed); assert.equal(w.avg, 14); assert.equal(w.at14, 16); assert.match(w.text, /decent/);
  assert.match(warReadiness(Array(20).fill(card(16, 16))).text, /only 20 cards/); }

// /player and /check.
assert.equal(bar(0.7), '███████░░░');
const card = await playerCard(env, 'PPCCR8VU', '2VJ9V2PV');
assert.match(card, /\*\*Luke\*\* · Elder[\s\S]*Reliability \*\*\d+\/100\*\*[\s\S]*5\/5 wars at 2,000\+[\s\S]*Recent wars \(newest first\): ✅2,600 ✅2,000/);
assert.match(await text(await cmd('player', [{ name: 'tag', value: '#2VJ9V2PV' }], member('U4'))), /Leaders only/);
const rc = await recruitCard(env, 'PPCCR8VU', 'YVJRGLCC');
assert.match(rc, /perc[\s\S]*Clan: Other \(Elder\)[\s\S]*Recent war battles: 1W–0L, 1 boat attack \([\s\S]*Been in this clan before\*\* \(in it now\): 1 tracked war, average 1,500/);
await assert.rejects(recruitCard(env, 'PPCCR8VU', 'QQQQQQ'));

// In-depth /me and the clan stats board, with a war in progress and battle history.
const { meCard, statsBoard } = await import('../worker/cards.js');
await DB.exec(`INSERT INTO wars (clan,week,ended_at,rank,fame) VALUES ('PPCCR8VU','1-1','2026-10-01T09:43:00Z',2,0),('PPCCR8VU','1-2','2026-10-08T09:43:00Z',1,0),
  ('PPCCR8VU','1-3','2026-10-15T09:43:00Z',3,0),('PPCCR8VU','1-4','2026-10-22T09:43:00Z',1,0),('PPCCR8VU','2-1','2026-10-29T09:43:00Z',1,0);
  INSERT INTO periods (clan,week,period,type,first_seen) VALUES ('PPCCR8VU','2-2',4,'warDay','2026-11-17T09:43:00Z');
  INSERT INTO race_days (clan,week,day,tag,name,fame,decks,today,boats,at) VALUES ('PPCCR8VU','2-2',1,'2VJ9V2PV','Luke',600,4,4,0,'x'),('PPCCR8VU','2-2',2,'2VJ9V2PV','Luke',900,6,2,0,'x'),('PPCCR8VU','2-2',2,'YVJRGLCC','perc',1100,8,4,0,'x');
  INSERT INTO war_battles (clan,tag,at,type,won,lost) VALUES ('PPCCR8VU','2VJ9V2PV','2026-10-01T10:00:00Z','duel',6,2),('PPCCR8VU','2VJ9V2PV','2026-10-02T10:00:00Z','boat',2,4);
  INSERT INTO member_stats (clan,week,tag,donations) VALUES ('PPCCR8VU','2-2','2VJ9V2PV',320),('PPCCR8VU','2-2','YVJRGLCC',150);`);
const meC = await meCard(env, 'PPCCR8VU', '2VJ9V2PV');
const all = JSON.stringify(meC);
assert.equal(meC.embeds[0].title, '⚔️ This war · battle day 2 of 4');
assert.match(meC.embeds[0].description, /\*\*900\*\* \/ 2,000 medals[\s\S]*1,100\*\* more[\s\S]*2\*\* decks left today[\s\S]*Forecast: \*\*\w[\s\S]*2nd of 2 in the clan[\s\S]*Day 1: 4\/4 decks · Day 2: 2\/4 decks/);
assert.match(meC.embeds[1].description, /```\nWar    Medals \(✓ = 2,000\+\)\n2-1    2,600 ✓ [█░]+[\s\S]*🔥 \*\*5 wars in a row\*\*/);
assert.match(meC.embeds[1].fields[0].name, /Reliability: \d+\/100/); assert.match(meC.embeds[1].fields[0].value, /From your last 5 wars: 2,000\+ in 5, 100% of battles played, average 2,120/);
assert.match(meC.embeds[2].description, /Duels:\*\* 6W–2L \(75% won\)[\s\S]*Boat attacks:\*\* 2W–4L/);
assert.ok(all.length < 6000, 'within Discord\'s embed limit');
const sb = await statsBoard(env, 'PPCCR8VU');
assert.match(sb, /Clan stats\*\* · 2\/50 members[\s\S]*Last 5 wars\*\*\n```\nWar    Place  Got 2,000\+      Clan medals\n2-1    1st      1\/2 [█░]{6}    4,100[\s\S]*Most reliable\*\* \(score out of 100\): Luke[\s\S]*Wars in a row at 2,000\+:\*\* Luke 5[\s\S]*Medals per battle:\*\* Duels 213 \(75% won\) · Boats 92[\s\S]*Top donors this week:\*\* Luke 320 · perc 150/);
assert.ok(sb.length <= 1990);
assert.match(await text(await interaction({ type: 2, guild_id: 'G', member: member('U1'), data: { name: 'stats', options: [] } })), /Clan stats/);

// /refresh clean: deletes only the bot's own old messages, then re-posts and pins what it keeps.
const { refreshAll } = await import('../worker/discord.js');
const cfgG = JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G'").first()).v);
calls.length = 0;
const rf = await runRefresh('G', cfgG, true);
const dels = calls.filter(c => c.method === 'DELETE').map(c => c.url.split('/').pop());
assert.ok(dels.includes('OLD1') && dels.includes('OLD2') && !dels.includes('USER1'), 'only the bot\'s messages');
assert.match(rf, /Deleted \d+ old messages[\s\S]*✅ Rules → <#C>[\s\S]*✅ How to link → <#C>/);
assert.ok(calls.some(c => c.method === 'PUT' && /\/pins\/M\d+$/.test(c.url)), 'pinned');
assert.ok(calls.some(c => c.method === 'DELETE' && /messages\/NOTE$/.test(c.url)), 'the "pinned a message" notice is removed');
assert.match(rf, /What appears here → <#C>/, 'a note in the war channel');
calls.length = 0;
assert.match(await runRefresh('G', cfgG, false), /Refreshed/);
{ const d2 = calls.filter(c => c.method === 'DELETE').map(c => c.url.split('/').pop());
  assert.ok(d2.includes('OLD1'), 'without clean: the bot\'s out-of-date messages in live channels are tidied');
  assert.ok(!d2.includes('USER1'), 'people\'s own messages are never touched');
  assert.ok(!d2.some(id => /^M\d+$/.test(id)), 'what the bot keeps current (rules, notes, boards) stays'); }
assert.match(await runRefresh('NONE', null, true), /Nothing set up yet/);

// /autosetup: preview, then step by step (Continue button): roles, categories, channels, posts; fresh deletes old channels last.
const { autoSetup, autoSetupNext } = await import('../worker/discord.js');
const withIcon = { ...env, ASSETS: { fetch: async () => new Response(new Uint8Array([137, 80, 78, 71])) } };
const pv = (await autoSetup(env, 'G3', null, 'PPCCR8VU', false)).content;
assert.match(pv, /would do this[\s\S]*Roles: Co-Leader, Elder[\s\S]*👋 Start here[\s\S]*➕ #🔗-link-tag: how to link[\s\S]*🔧 <#CR>: rules[\s\S]*➕ #📊-clan-stats: clan stats[\s\S]*➕ #🏆-results[\s\S]*➕ #🔭-rival-scouting: rival scouting[\s\S]*🔧 <#CW>: war board[\s\S]*🔧 <#CV>[\s\S]*🛡️ Leaders[\s\S]*🔧 <#CLC>[\s\S]*Drag \*\*War Audit\*\* above Leader[\s\S]*in 3 steps/);
assert.doesNotMatch(pv, /Deletes/, 'not fresh: nothing deleted');
calls.length = 0;
const s1 = await autoSetup(withIcon, 'G3', null, 'PPCCR8VU', true);
assert.match(s1.content, /Step 1 of 3 done[\s\S]*channels in 4 categories[\s\S]*Role Co-Leader/);
assert.equal(s1.components[0].components[0].custom_id, 'autosetup|next');
const cfg3 = JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G3'").first()).v);
assert.equal(cfg3.channels.war, 'CW'); assert.equal(cfg3.channels.leaders, 'CLC', 'a private leaders-chat is the leaders channel, never general');
assert.ok(cfg3.channels.results && cfg3.channels.results !== 'CW' && cfg3.channels.scout, 'results and scouting get their own channels');
assert.equal(cfg3.roles.leader, 'RL'); assert.equal(cfg3.roles.coLeader, 'NEW-Co-Leader');
const war = calls.find(c => c.method === 'PATCH' && c.url.endsWith('/channels/CW')).body;
assert.ok(war.parent_id, 'moved into a category');
assert.ok(war.permission_overwrites.some(o => o.id === 'G3' && o.deny === String(1n << 10n)), 'war hidden from newcomers');
assert.ok(war.permission_overwrites.some(o => o.id === 'RM3' && BigInt(o.allow) & (1n << 11n)), 'members can chat in war');
const lead = calls.find(c => c.method === 'PATCH' && c.url.endsWith('/channels/CLC')).body.permission_overwrites;
assert.ok(!lead.some(o => o.id === 'RM3'), 'members not in leaders');
const res3 = calls.find(c => c.method === 'POST' && /guilds\/G3\/channels$/.test(c.url) && c.body.name === '🏆-results').body.permission_overwrites;
assert.ok(res3.some(o => o.id === 'RM3' && !(BigInt(o.allow) & (1n << 11n))), 'results read-only for members');
assert.ok(calls.some(c => c.method === 'POST' && c.body?.type === 4 && c.body.name === '🛡️ Leaders'), 'categories made');
assert.ok(calls.some(c => c.method === 'PATCH' && /roles\/RM3$/.test(c.url) && c.body.hoist), 'Member role listed separately');
assert.ok(calls.some(c => c.method === 'PATCH' && /roles\/G3$/.test(c.url) && !(BigInt(c.body.permissions) & 1n)), 'invites taken off @everyone');
assert.ok(calls.some(c => c.method === 'PATCH' && /roles\/NEW-Co-Leader$/.test(c.url) && BigInt(c.body.permissions) & 1n), 'Co-Leader can invite');
{ const k = calls.findIndex(c => c.method === 'PATCH' && /roles\/NEW-Co-Leader$/.test(c.url) && BigInt(c.body.permissions) & 1n), e = calls.findIndex(c => c.method === 'PATCH' && /roles\/G3$/.test(c.url));
  assert.ok(k >= 0 && k < e, 'invites given to leaders before they are taken off @everyone (the bot needs them to give them)'); }
assert.equal(JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G3'").first()).v).roles.guest, 'NEW-Not in clan');
// Who sees what, worked out like Discord does (server @everyone can view; channel overwrites: @everyone, then roles, then the member).
{
  const made = calls.filter(c => /guilds\/G3\/channels$|\/channels\/(CW|CR|CV|CLC)$/.test(c.url) && ['POST', 'PATCH'].includes(c.method) && c.body?.type !== 4);
  const byName = Object.fromEntries(made.map(c => [c.body.name || { CW: '⚔️-war', CR: '📜-rules', CV: '🔊 Clan voice', CLC: '🛡️-leaders' }[c.url.split('/').pop()], c.body.permission_overwrites]));
  const V = 1n << 10n, S = 1n << 11n;
  const can = (ows, roles, bit) => {
    let p = V | S;   // server default for @everyone
    const e = ows.find(o => o.id === 'G3'); if (e) p = (p & ~BigInt(e.deny)) | BigInt(e.allow);
    let a = 0n, d = 0n; for (const o of ows.filter(o => roles.includes(o.id))) { a |= BigInt(o.allow); d |= BigInt(o.deny); }
    p = (p & ~d) | a;
    return (p & bit) === bit;
  };
  const sees = roles => Object.keys(byName).filter(n => can(byName[n], roles, V)).sort();
  const NEWCOMER = [], MEMBER = ['RM3'], ELDER = ['NEW-Elder'], LEADER = ['RL'], CO = ['NEW-Co-Leader'];
  assert.deepEqual(sees(NEWCOMER), ['🔗-link-tag'], 'newcomers see only the link channel');
  const clanView = ['⚔️-war', '💬-general', '📊-clan-stats', '📜-rules', '🔊 Clan voice', '🔭-rival-scouting', '🤖-bot-commands', '🏆-results'].sort();
  assert.deepEqual(sees(MEMBER), clanView, 'members: the clan channels, not link or leaders');
  assert.deepEqual(sees(ELDER), clanView, 'elders: same as members');
  for (const L of [LEADER, CO]) assert.deepEqual(sees(L), [...clanView, '🔗-link-tag', '🛡️-leaders', '💭-leader-chat', '🚪-not-in-clan'].sort(), 'leaders: everything');
  assert.deepEqual(sees(['NEW-Not in clan']), ['🚪-not-in-clan'], 'not in the clan: only the waiting room');
  assert.ok(can(byName['🚪-not-in-clan'], ['NEW-Not in clan'], S), 'and they can talk to leaders there');
  const chats = roles => Object.keys(byName).filter(n => can(byName[n], roles, V) && can(byName[n], roles, S)).sort();
  assert.deepEqual(chats(MEMBER), ['⚔️-war', '💬-general', '🔊 Clan voice', '🤖-bot-commands'].sort(), 'members chat only in war, general, bot-commands, voice');
  assert.ok(!chats(LEADER).includes('📜-rules') && !chats(LEADER).includes('📊-clan-stats'), 'rules and stats read-only even for leaders');
  assert.ok(!can(byName['🔗-link-tag'], NEWCOMER, S) && can(byName['🔗-link-tag'], NEWCOMER, 1n << 31n), 'newcomers can use /link but not chat');
}
// /whosees reads the live server and applies Discord's rules: same answer as above, from what's actually there.
{ const { whoSees } = await import('../worker/discord.js');
  const made = calls.filter(c => c.method === 'POST' && /guilds\/G3\/channels$/.test(c.url) && c.body.type !== 4).map((c, k) => ({ id: 'NEWCH-' + c.body.name.replace(/[^a-z]/g, ''), type: c.body.type || 0, position: k, name: c.body.name, permission_overwrites: c.body.permission_overwrites }));
  const realF = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => /guilds\/G3\/channels$/.test(String(url)) && (opt.method || 'GET') === 'GET' ? Response.json(made) : /guilds\/G3\/roles$/.test(String(url)) && (opt.method || 'GET') === 'GET'
    ? Response.json([{ id: 'G3', permissions: String(1n << 10n | 1n << 11n) }, { id: 'NEW-Not in clan', permissions: '0' }, { id: 'RM3', permissions: '0' }, { id: 'NEW-Elder', permissions: '0' }, { id: 'NEW-Co-Leader', permissions: '1' }, { id: 'RL', permissions: '1' }]) : realF(url, opt);
  const ws = await whoSees(env, 'G3', JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G3'").first()).v));
  globalThis.fetch = realF;
  assert.match(ws, /\*\*Newcomer \(no role\):\*\* <#NEWCH-linktag> \(read\)\n/);
  assert.match(ws, /\*\*Not in clan:\*\* <#NEWCH-notinclan>\n/);
  assert.match(ws, /\*\*Member:\*\* [^\n]*<#NEWCH-clanstats> \(read\)/); assert.doesNotMatch(ws.split('\n').find(l => l.startsWith('**Member')), /linktag|leaders|notinclan|can invite/);
  assert.match(ws, /\*\*Leader:\*\* [^\n]*leaderchat[^\n]*· can invite/); assert.doesNotMatch(ws.split('\n').find(l => l.startsWith('**Member')), /leaderchat/);
}
calls.length = 0;
const untilNot = async (envx, re) => { let r; for (let k = 0; k < 6; k++) { r = await autoSetupNext(envx, 'G3', 'PPCCR8VU'); if (!re.test(r.content)) break; } return r; };
const s2 = await autoSetupNext(withIcon, 'G3', 'PPCCR8VU');
assert.match(s2.content, /Step 2 of 3 done[\s\S]*Rules → <#CR>[\s\S]*Clan stats → <#NEWCH/);
assert.match(s2.content, /Server icon: the clan badge/);
assert.ok(calls.some(c => c.method === 'DELETE' && /messages\/NOTE$/.test(c.url)), 'the "pinned a message" notice is removed');
const s3 = await untilNot(withIcon, /More notes to go/);
assert.match(s3.content, /All done ✅[\s\S]*channel notes pinned[\s\S]*Still to do:[\s\S]*Drag/);
assert.equal(s3.components.length, 0);
assert.match((await autoSetupNext(env, 'G3', 'PPCCR8VU')).content, /Nothing in progress/);
// Continue button: leaders only.
assert.match(await text(await interaction({ type: 3, guild_id: 'G3', member: member('U3'), data: { custom_id: 'autosetup|next' } })), /Leaders only/);
// Fresh: everything new, the old channels deleted in the last step.
const pvF = (await autoSetup(env, 'G3', cfg3, 'PPCCR8VU', false, true)).content;
assert.match(pvF, /Deletes 4 existing channels[\s\S]*in 4 steps/);
await autoSetup(env, 'G3', cfg3, 'PPCCR8VU', true, true);
await autoSetupNext(env, 'G3', 'PPCCR8VU'); const f3 = await untilNot(env, /More notes to go/);
assert.match(f3.content, /Last step deletes the \*\*4 old channels\*\*/);
calls.length = 0;
const f4 = await autoSetupNext(env, 'G3', 'PPCCR8VU');
assert.match(f4.content, /set up the server ✅[\s\S]*Deleted 4 old channels/);
assert.deepEqual(calls.filter(c => c.method === 'DELETE' && /\/channels\/\w+$/.test(c.url)).map(c => c.url.split('/').pop()).sort(), ['CLC', 'CR', 'CV', 'CW']);
// A channel it can't delete is named in the summary.
await autoSetup(env, 'G3', cfg3, 'PPCCR8VU', true, true); await autoSetupNext(env, 'G3', 'PPCCR8VU'); await untilNot(env, /More notes to go/);
{ const realF = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => /\/channels\/CLC$/.test(String(url)) && opt.method === 'DELETE' ? new Response('{}', { status: 403 }) : realF(url, opt);
  assert.match((await autoSetupNext(env, 'G3', 'PPCCR8VU')).content, /Deleted 3 old channels[\s\S]*Couldn't delete: #leaders-chat/);
  globalThis.fetch = realF; }
// A private channel the bot can't change keeps its job, with a clear fix.
await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:G3', '${JSON.stringify(cfg3)}')`);
globalThis.lockLeaders = true;
const ap2 = await autoSetup(env, 'G3', cfg3, 'PPCCR8VU', true);
globalThis.lockLeaders = false;
assert.match(ap2.content, /<#CLC>: couldn't change it[\s\S]*add War Audit/);
assert.equal(JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G3'").first()).v).channels.leaders, 'CLC', 'job kept');
await DB.exec(`DELETE FROM kv WHERE k = 'autosetup:G3'`);

// /link with a tag that isn't in the clan: the Not in clan role, pointed at the waiting room.
calls.length = 0;
assert.match(await text(await interaction({ type: 2, guild_id: 'G3', member: { user: { id: 'U9' }, permissions: '0', roles: [] }, data: { name: 'link', options: [{ name: 'tag', value: '#QQQQQQ' }] } })),
  /isn't in the clan right now\. You can now see <#NEWCH-notinclan>: ask a leader there/);
await Promise.all(pending);
assert.ok(calls.some(c => c.method === 'PUT' && /members\/U9\/roles\/NEW-Not in clan$/.test(c.url)));
// A linked member who leaves the clan in game: rank role off, Not in clan on.
{ const { syncGuild } = await import('../worker/discord.js');
  await DB.exec(`INSERT OR REPLACE INTO discord_links (guild, user_id, clan, tag) VALUES ('G3', 'U1', 'PPCCR8VU', 'YVJRGLCC'); UPDATE members SET in_clan = 0 WHERE tag = 'YVJRGLCC'`);
  const realF = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => /guilds\/G3\/members\/U1$/.test(String(url)) && (opt.method || 'GET') === 'GET' ? Response.json({ roles: ['RM3', 'OTHER'], nick: 'perc' }) : realF(url, opt);
  calls.length = 0;
  await syncGuild(env, 'G3', JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G3'").first()).v), 'PPCCR8VU');
  assert.deepEqual(calls.find(c => c.method === 'PATCH' && /members\/U1$/.test(c.url)).body.roles.sort(), ['NEW-Not in clan', 'OTHER']);
  globalThis.fetch = realF;
  await DB.exec(`UPDATE members SET in_clan = 1 WHERE tag = 'YVJRGLCC'`); }

// Someone with the Leader role (no Discord permissions) counts as a leader.
assert.match(await text(await interaction({ type: 2, guild_id: 'G3', member: { user: { id: 'U8' }, permissions: '0', roles: ['RL'] }, data: { name: 'links', options: [] } })), /Linked:/);
// Without Manage Channels it says so and changes nothing.
const noPerm = await autoSetup({ ...env, DISCORD_APP_ID: 'NOPE' }, 'G3', null, 'PPCCR8VU', true);
assert.match(noPerm.content, /Can't start yet[\s\S]*Manage Channels/);

// /autosetup keeps channels already chosen, whatever they're called (here: leaders = "bot-talk").
await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:G4', '{"clan":"PPCCR8VU","channels":{"leaders":"BT","war":"CW"},"roles":{}}')`);
{ const realF = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => { const u = String(url).replace('/guilds/G4/', '/guilds/G3/');
    if (/\/guilds\/G3\/channels$/.test(u) && (opt.method || 'GET') === 'GET') return Response.json([{ id: 'CW', type: 0, name: '⚔️-war' }, { id: 'BT', type: 0, name: 'bot-talk' }]);
    return realF(u, opt); };
  const pv4 = (await autoSetup(env, 'G4', JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:G4'").first()).v), 'PPCCR8VU', false)).content;
  assert.match(pv4, /<#BT>: absences, digest, backups/); assert.doesNotMatch(pv4, /➕ #🛡️-leaders/);
  globalThis.fetch = realF; }

// Re-running: the waiting room is reused (not made again), exact-name copies from earlier runs are removed; voice is view-only.
await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:G5', '{"clan":"PPCCR8VU","channels":{},"roles":{}}')`);
{ const realF = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => { const u = String(url).replace('/guilds/G5', '/guilds/G3');
    if (/\/guilds\/G3\/channels$/.test(u) && (opt.method || 'GET') === 'GET') return Response.json([{ id: 'NIC1', type: 0, name: '🚪-not-in-clan' }, { id: 'NIC2', type: 0, name: '🚪-not-in-clan' }, { id: 'NIC3', type: 0, name: '🚪-not-in-clan' }]);
    if (/\/channels\/NIC1$/.test(u) && opt.method === 'PATCH') return Response.json({ id: 'NIC1' });
    return realF(u, opt); };
  calls.length = 0;
  const r5 = await autoSetup(env, 'G5', null, 'PPCCR8VU', true);
  globalThis.fetch = realF;
  assert.ok(!calls.some(c => c.method === 'POST' && c.body?.name === '🚪-not-in-clan'), 'not made again');
  assert.deepEqual(calls.filter(c => c.method === 'DELETE' && /channels\/NIC\d$/.test(c.url)).map(c => c.url.split('/').pop()).sort(), ['NIC2', 'NIC3']);
  assert.match(r5.content, /Removed 2 duplicate channels/);
  const voice = calls.find(c => c.method === 'POST' && c.body?.type === 2).body.permission_overwrites;
  assert.ok(voice.filter(o => o.id !== 'G5' && o.id !== 'G3').every(o => o.allow === String(1n << 10n)), 'voice: only View, nothing the bot might not have');
  assert.ok(voice.some(o => o.id === 'A' && o.type === 1 && BigInt(o.allow) & (1n << 10n)), 'the bot can still see its voice channel');
  for (const c of calls.filter(c => c.method === 'POST' && /guilds\/G3\/channels$/.test(c.url) && c.body.type !== 4))
    if (c.body.permission_overwrites.some(o => o.deny !== '0' && BigInt(o.deny) & (1n << 10n))) assert.ok(c.body.permission_overwrites.some(o => o.id === 'A'), 'bot sees hidden ' + c.body.name);
  await DB.exec(`DELETE FROM kv WHERE k = 'autosetup:G5'`); }

// Waiting room tidy-up: heads-up the day before, then removal; people who linked (or leaders) are left alone; once a day.
{ const { tidyGuests } = await import('../worker/discord.js');
  const now = Date.parse('2026-11-25T12:00:00Z'), ago = d => new Date(now - d * 864e5).toISOString();
  await DB.exec(`DELETE FROM discord_guests; INSERT INTO discord_guests (guild, user_id, since, warned) VALUES
    ('G3','U20','${ago(6.5)}',0),('G3','U21','${ago(8)}',1),('G3','U22','${ago(8)}',1),('G3','U23','${ago(2)}',0),('G3','U24','${ago(9)}',1)`);
  const realF = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => { const u = String(url), m = u.match(/guilds\/G3\/members\/(U2\d)$/);
    if (m && (opt.method || 'GET') === 'GET') return Response.json({ roles: { U20: ['NEW-Not in clan'], U21: ['NEW-Not in clan'], U22: ['RM3'], U24: ['NEW-Not in clan', 'RL'] }[m[1]] || [] });
    return realF(url, opt); };
  calls.length = 0;
  const t1 = await tidyGuests(env, 'PPCCR8VU', now);
  assert.deepEqual(t1, { warned: 1, removed: 1 });
  assert.match(calls.find(c => c.method === 'POST' && /channels\/NEWCH-notinclan\/messages$/.test(c.url)).body.content, /<@U20> you've been here 6 days[\s\S]*removed from the server/);
  assert.deepEqual(calls.filter(c => c.method === 'DELETE' && /guilds\/G3\/members\//.test(c.url)).map(c => c.url.split('/').pop()), ['U21'], 'only the warned, still-waiting non-leader');
  const left = (await DB.prepare("SELECT user_id FROM discord_guests WHERE guild = 'G3' ORDER BY user_id").all()).results.map(r => r.user_id);
  assert.deepEqual(left, ['U20', 'U23'], 'linked member and leader dropped from the list; removed one gone');
  assert.deepEqual(await tidyGuests(env, 'PPCCR8VU', now + 3600e3), { warned: 0, removed: 0 }, 'once a day');
  // /setup tidy 0: nobody removed.
  assert.match(await text(await interaction({ type: 2, guild_id: 'G3', member: leader, data: { name: 'setup', options: [{ type: 1, name: 'tidy', options: [{ name: 'days', value: 0 }] }] } })), /nobody is removed/);
  calls.length = 0;
  assert.deepEqual(await tidyGuests(env, 'PPCCR8VU', now + 864e5 * 3), { warned: 0, removed: 0 });
  assert.ok(!calls.some(c => c.method === 'DELETE'));
  globalThis.fetch = realF;
  await interaction({ type: 2, guild_id: 'G3', member: leader, data: { name: 'setup', options: [{ type: 1, name: 'tidy', options: [{ name: 'days', value: 7 }] }] } }); }

// Older single-channel setups: leaders-only posts never go to that public channel; changing settings keeps it.
await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:OLD', '{"clan":"PPCCR8VU","channel":"PUB","roles":{}}')`);
{ const { sendDigest } = await import('../worker/discord.js'); calls.length = 0;
  await DB.exec(`DELETE FROM kv WHERE k LIKE 'discord:%' AND k NOT IN ('discord:OLD')`);
  await sendDigest(env, 'PPCCR8VU').catch(() => 0);
  assert.ok(!calls.some(c => /channels\/PUB\//.test(c.url)), 'no leaders-only digest in the public channel'); }
await interaction({ type: 2, guild_id: 'OLD', member: leader, data: { name: 'setup', options: [] } });
assert.deepEqual(JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:OLD'").first()).v).channels, { war: 'PUB', results: 'PUB', joins: 'PUB' }, 'migrated, not dropped');

// Donors: rows saved with week 'unknown' never count as "this week".
await DB.exec(`INSERT INTO member_stats (clan,week,tag,donations) VALUES ('PPCCR8VU','unknown','YVJRGLCC',9999)`);
assert.match(await statsBoard(env, 'PPCCR8VU'), /Top donors this week:\*\* Luke 320/);

// /mystats: the reset time from the game's compact timestamp.
await DB.exec(`UPDATE wars SET ended_at = '20261029T094312.000Z' WHERE week = '2-1'`);
assert.match(JSON.stringify(await meCard(env, 'PPCCR8VU', '2VJ9V2PV')), /resets \d\d:\d\d UK/);

// Privacy: /privacy explains; delete:True removes your Discord link, settings and away note; leaders can forget someone,
// optionally with their stored war history; the notice is pinned next to the rules.
{ assert.match(await text(await cmd('privacy')), /Privacy: what War Audit keeps[\s\S]*public data[\s\S]*\/privacy delete:True[\s\S]*\/leader forget/);
  await DB.exec(`INSERT OR REPLACE INTO discord_links (guild, user_id, clan, tag) VALUES ('G', 'U40', 'PPCCR8VU', 'YVJRGLCC');
    INSERT OR REPLACE INTO discord_reminders (guild, user_id, hours, dm) VALUES ('G', 'U40', 3, 'D');
    INSERT OR REPLACE INTO discord_warreport (guild, user_id, dm) VALUES ('G', 'U40', 'D');
    INSERT OR REPLACE INTO notes (clan, week, tag, kind, value, at) VALUES ('PPCCR8VU', '*', 'YVJRGLCC', 'away', '{}', 'x');`);
  assert.match(await text(await cmd('privacy', [{ name: 'delete', value: true }], member('U40'))), /Deleted: your Discord link and all your War Audit settings/);
  for (const t of ['discord_links', 'discord_reminders', 'discord_warreport']) assert.equal(await DB.prepare(`SELECT 1 FROM ${t} WHERE user_id = 'U40'`).first(), null, t);
  assert.equal(await DB.prepare("SELECT 1 FROM notes WHERE tag = 'YVJRGLCC' AND kind = 'away'").first(), null, 'away note gone');
  assert.match(await text(await cmd('privacy', [{ name: 'delete', value: true }], member('U40'))), /Nothing stored/);
  // Leader: forget by tag, with history.
  await DB.exec(`INSERT OR REPLACE INTO discord_links (guild, user_id, clan, tag) VALUES ('G', 'U41', 'PPCCR8VU', 'YVJRGLCC')`);
  const forget = (opts, m = leader) => interaction({ type: 2, guild_id: 'G', member: m, data: { name: 'leader', options: [{ type: 1, name: 'forget', options: opts }] } });
  assert.match(await text(await forget([{ name: 'tag', value: '#YVJRGLCC' }], member('U42'))), /Leaders only/);
  assert.ok(await DB.prepare("SELECT 1 FROM war_players WHERE tag = 'YVJRGLCC'").first(), 'has history before');
  assert.match(await text(await forget([{ name: 'tag', value: '#YVJRGLCC' }, { name: 'history', value: true }])), /Deleted: Discord link and settings and stored war history for #YVJRGLCC/);
  for (const t of ['war_players', 'members', 'race_days', 'member_stats']) assert.equal(await DB.prepare(`SELECT 1 FROM ${t} WHERE tag = 'YVJRGLCC'`).first(), null, t);
  assert.equal(await DB.prepare("SELECT 1 FROM discord_links WHERE user_id = 'U41'").first(), null);
  assert.equal((await DB.prepare("SELECT kind FROM note_log WHERE kind = 'forget'").first()).kind, 'forget', 'logged (without the data)');
  // Pinned next to the rules on refresh.
  const { refreshAll } = await import('../worker/discord.js');
  await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:rules:G', '{"channel":"C","id":null}')`);
  calls.length = 0;
  await runRefresh('G', { clan: 'PPCCR8VU', channels: { war: 'C' }, roles: {} }, false);
  assert.ok(calls.some(c => c.method === 'POST' && /channels\/C\/messages$/.test(c.url) && /Privacy: what War Audit keeps/.test(c.body?.content)), 'privacy pinned with the rules'); }

// #bot-commands: cleaned and its note re-posted by /setup refresh (it has no posting job, but it's the bot's channel).
{ const { refreshAll } = await import('../worker/discord.js');
  calls.length = 0;
  const out = await runRefresh('G', { clan: 'PPCCR8VU', channels: { bot: 'C' }, roles: {} }, true);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/channels/C/messages/OLD1')), 'old bot messages deleted there');
  assert.ok(calls.some(c => c.method === 'POST' && /channels\/C\/messages$/.test(c.url) && /Use War Audit here/.test(c.body?.content)), 'note re-posted');
  assert.match(out, /What appears here → <#C>/); }

// Every refresh step stays under the Worker's 50-request limit (the reason it's in steps), even with 8 channels
// full of old bot messages and every kept message already posted.
{ const { refreshAll, refreshNext } = await import('../worker/discord.js');
  const chs = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'];
  const cfgK = { clan: 'PPCCR8VU', channels: { war: 'K1', results: 'K2', scout: 'K3', joins: 'K4', leaders: 'K5', guests: 'K6', bot: 'K7' }, roles: {} };
  await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:rules:GK', '{"channel":"K8","id":"R1"}'), ('discord:welcome:GK', '{"channel":"K8","id":"W1"}'), ('discord:stats:GK', '{"channel":"K8","id":"S1"}')`);
  const realF = globalThis.fetch;
  let n = 0;
  const gone = new Set();   // deleted messages stop coming back, as in Discord
  globalThis.fetch = async (url, opt = {}) => { const u = String(url);
    if (u.includes('discord.com')) n++;
    const del = u.match(/channels\/(K\d)\/messages\/(X\d+)$/); if (del && opt.method === 'DELETE') { gone.add(del[1] + del[2]); return new Response(null, { status: 204 }); }
    const ch = u.match(/channels\/(K\d)\/messages\?limit=50$/);
    if (ch) return Response.json(Array.from({ length: 20 }, (_, k) => ({ id: 'X' + k, author: { id: 'A' } })).filter(m => !gone.has(ch[1] + m.id)));
    if (/channels\/K\d\/messages$/.test(u) && opt.method === 'POST') return Response.json({ id: 'N' + Math.random() });
    return realF(url, opt); };
  const steps = [];
  n = 0; let r = await refreshAll(env, 'GK', cfgK, 'PPCCR8VU', true); steps.push(n);
  while (r.components?.length && steps.length < 30) { n = 0; r = await refreshNext(env, 'GK', 'PPCCR8VU'); steps.push(n); }
  globalThis.fetch = realF;
  assert.match(r.content, /Refreshed ✅/);
  assert.ok(steps.every(x => x <= 45), 'requests per step: ' + steps.join(', '));
  assert.ok(steps.length >= 6, 'it took several steps: ' + steps.length); }

// /setup remove: Leader only (not Co-Leader), asks first, then deletes the layout's channels/categories/roles and the saved settings.
{ const { removeAll, COMMANDS } = await import('../worker/discord.js');
  const rows = new Map([['discord:GR', '{"clan":"PPCCR8VU","channels":{"war":"C2"},"roles":{"leader":"RL","coLeader":"RC"},"layout":{"general":"G1","cats":[]}}'], ['discord:rules:GR', '{}'], ['discord:intro:GR:C2', '{}'], ['discord:rules:GR2', '{}']]);
  const deleted = [], links = [];
  const envR = { DISCORD_APP_ID: 'A', DISCORD_BOT_TOKEN: 't', DB: { prepare: sql => ({ bind: (...a) => ({
    run: async () => { if (/DELETE FROM kv/.test(sql)) for (const k of [...rows.keys()]) if (a.some(p => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(k))) rows.delete(k);
      if (/discord_links/.test(sql)) links.push(a[0]); return {}; },
    first: async () => null, all: async () => ({ results: [] }) }) }) } };
  globalThis.fetch = async (url, opt = {}) => { const u = String(url);
    if (opt.method === 'DELETE') { deleted.push(u.split('/').slice(-2).join('/')); return new Response(null, { status: 204 }); }
    if (u.endsWith('/channels')) return Response.json([{ id: 'C1', name: '📜-rules', type: 0 }, { id: 'C2', name: '⚔️-war', type: 0 }, { id: 'K1', name: '👋 Start here', type: 4 }, { id: 'U1', name: 'my-own-channel', type: 0 }, { id: 'V1', name: 'Clan-voice', type: 2 }, { id: 'G1', name: 'chat', type: 0 }]);
    if (u.endsWith('/roles')) return Response.json([{ id: 'GR', name: '@everyone' }, { id: 'RL', name: 'Leader' }, { id: 'RC', name: 'Co-Leader' }, { id: 'RX', name: 'Friends' }, { id: 'RB', name: 'War Audit', managed: true }]);
    return Response.json({}); };
  const msg = await removeAll(envR, 'GR', JSON.parse(rows.get('discord:GR')));
  assert.deepEqual(deleted, ['channels/C1', 'channels/C2', 'channels/V1', 'channels/G1', 'channels/K1', 'roles/RL', 'roles/RC'], 'channels, then categories, then roles; nothing else: ' + deleted);
  assert.deepEqual([...rows.keys()], ['discord:rules:GR2'], 'only this server\'s settings are forgotten');
  assert.equal(links.length, 0, 'links kept by default'); assert.match(msg, /5 channels|3 channels/); assert.match(msg, /linked accounts kept/);
  await removeAll(envR, 'GR', null, true); assert.equal(links[0], 'GR', 'links:True deletes links too');
  assert.ok(COMMANDS.find(c => c.name === 'setup').options.some(o => o.name === 'remove'), '/setup remove exists'); }

// The how-to-link message follows the extra-chance rule.
{ const { welcomeText } = await import('../worker/discord.js');
  assert.match(welcomeText({ linkBonus: true }), /Why link\?\*\* War reminders that tag you, your own war stats with `\/mystats`, and \*\*one extra chance before a kick\*\*\./);
  assert.match(welcomeText({ linkBonus: false }), /Why link\?\*\* War reminders that tag you and your own war stats with `\/mystats`\./);
  assert.doesNotMatch(welcomeText({ linkBonus: false }), /extra chance/); }

console.log('Discord checks passed');
