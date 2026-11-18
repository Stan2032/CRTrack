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
  if (/\/guilds\/G3\/roles$/.test(url) && (opt.method || 'GET') === 'GET') return Response.json([{ id: 'G3', name: '@everyone', position: 0, permissions: String((1n << 31n) | (1n << 10n)) },
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

assert.equal((await (await interaction({ type: 1 })).json()).type, 1, 'endpoint check');
assert.equal((await interaction({ type: 1 }, { forge: true })).status, 401, 'forged request refused');

assert.match(await text(await cmd('links')), /Leaders only/);
const here = (what, ch = 'C', g = 'G', m = leader) => interaction({ type: 2, guild_id: g, channel_id: ch, member: m, data: { name: 'post-here', options: [{ name: 'what', value: what }] } });
assert.match(await text(await cmd('setup', [{ name: 'member_role', value: 'RM' }, { name: 'elder_role', value: 'RE' }], leader)), /War board \+ battle-day reminders → _not set_[\s\S]*Member → <@&RM>, Elder → <@&RE>/);
assert.match(await text(await here('war')), /War board \+ battle-day reminders → <#C>[\s\S]*summaries \+ war results → _not set_/);
await Promise.all(pending);
assert.ok(calls.some(c => c.method === 'DELETE' && /channels\/C\/messages\/M\d+$/.test(c.url)), 'test post removed');
assert.match(await text(await here('war', 'C', 'G', member('U5'))), /Leaders only/);

assert.match(await text(await cmd('link', [{ name: 'tag', value: '#2vj9v2pv' }])), /Linked <@U1> to \*\*Luke\*\*/);
await Promise.all(pending);
const patch = calls.find(c => c.method === 'PATCH' && /members\/U1$/.test(c.url));
assert.deepEqual(patch.body, { roles: ['OTHER', 'RE'], nick: 'Luke' }, 'Elder role added, other roles kept, nickname set');

assert.match(await text(await cmd('link', [{ name: 'tag', value: '#QQQQQ' }], member('U2'))), /isn't in the clan/);
assert.match(await text(await cmd('link', [{ name: 'tag', value: '#2VJ9V2PV' }], member('U2'))), /already linked/);
{ const me = (await (await cmd('me')).json()).data; assert.equal(me.embeds[0].author.name, 'Luke'); assert.equal(me.flags, 64, 'only you'); }
assert.equal((await (await cmd('me', [{ name: 'share', value: true }])).json()).data.flags, 0, 'shared');
assert.match(await text(await cmd('links', [], leader)), /Linked: 1 of 2[\s\S]*Not linked yet:\*\* perc/);

// /away: saved as a shared note the page reads, posted to the leaders' channel.
assert.match(await text(await here('leaders', 'LC')), /Leaders only: to-do list after each war \+ absences → <#LC>/);
calls.length = 0;
assert.match(await text(await cmd('away', [{ name: 'days', value: 3 }, { name: 'reason', value: 'holiday' }])), /away until \*\*.+\*\*[\s\S]*leaders decide/);
await Promise.all(pending);
const awayNote = await DB.prepare("SELECT value FROM notes WHERE kind = 'away' AND tag = '2VJ9V2PV'").first();
assert.equal(JSON.parse(awayNote.value).reason, 'holiday');
assert.match(calls.find(c => c.method === 'POST' && /channels\/LC\/messages$/.test(c.url)).body.content, /🏖️ \*\*Luke\*\* is away until .+: holiday/);
assert.match(await text(await cmd('away', [{ name: 'days', value: 1 }, { name: 'user', value: 'U1' }], member('U7'))), /Only leaders/);
assert.match(await text(await cmd('away', [{ name: 'days', value: 0 }])), /Welcome back/);
assert.equal(await DB.prepare("SELECT 1 FROM notes WHERE kind = 'away'").first(), null, 'cleared');

// To-do buttons: leaders only; a list that's gone says so.
const btn = (m, id = 'todo|1-1|Warn|do') => interaction({ type: 3, guild_id: 'G', member: m, data: { custom_id: id } });
assert.match(await text(await btn(member('U3'))), /Leaders only/);
assert.match(await text(await btn(leader)), /list has gone/);
const deferred = await (await cmd('todo', [], leader)).json();
assert.equal(deferred.type, 5, '/todo answers "thinking…" first');
await Promise.all(pending);
assert.ok(calls.some(c => c.method === 'PATCH' && /webhooks\/A\/.*\/messages\/@original$/.test(c.url)), 'then edits that reply');

// Battle-day reminder pings linked members by mention, names otherwise, and only those users.
calls.length = 0;
assert.equal(await discordPost(env, 'PPCCR8VU', 'Battle day 2 ends in under 4 hours', '6 decks still to play:', [{ tag: '2VJ9V2PV', name: 'Luke', text: '(4 left)' }, { tag: 'YVJRGLCC', name: 'perc', text: '(2 left)' }]), 1);
const msg = calls.find(c => /channels\/C\/messages/.test(c.url)).body;
assert.match(msg.content, /<@U1> \(4 left\)/); assert.match(msg.content, /perc \(2 left\)/);
assert.deepEqual(msg.allowed_mentions, { parse: [], users: ['U1'] });

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
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 0, 'no results channel yet: nothing posted');
await DB.prepare("DELETE FROM kv WHERE k LIKE 'dsum:%'").run();
await here('results', 'R');
calls.length = 0;
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 1);
assert.ok(calls.some(c => c.method === 'POST' && /channels\/R\/messages$/.test(c.url)), 'summary went to the results channel');
const sum = calls.find(c => c.method === 'POST').body.content;
assert.match(sum, /Battle day 2 summary[\s\S]*\+11,000\*\* \(\+10% vs day 1\)[\s\S]*Decks used: 6\/8 \(75%\)[\s\S]*2nd of 2, 1,500 behind Rival[\s\S]*Luke \+900/);
assert.equal(await daySummary(env, 'PPCCR8VU', '138-3', 2), 0, 'only once');

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
const rf = await refreshAll(env, 'G', cfgG, 'PPCCR8VU', true);
const dels = calls.filter(c => c.method === 'DELETE').map(c => c.url.split('/').pop());
assert.ok(dels.includes('OLD1') && dels.includes('OLD2') && !dels.includes('USER1'), 'only the bot\'s messages');
assert.match(rf, /Deleted \d+ old messages[\s\S]*✅ Rules → <#C>[\s\S]*✅ How to link → <#C>[\s\S]*✅ To-do list → <#LC>/);
assert.ok(calls.some(c => c.method === 'PUT' && /\/pins\/M\d+$/.test(c.url)), 'pinned');
assert.ok(calls.some(c => c.method === 'DELETE' && /messages\/NOTE$/.test(c.url)), 'the "pinned a message" notice is removed');
assert.match(rf, /What appears here → <#C>/, 'a note in the war channel');
calls.length = 0;
assert.match(await refreshAll(env, 'G', cfgG, 'PPCCR8VU', false), /Refreshed/);
assert.ok(!calls.some(c => c.method === 'DELETE' && !/messages\/NOTE$/.test(c.url)), 'without clean: nothing deleted but pin notices');
assert.match(await refreshAll(env, 'NONE', null, 'PPCCR8VU', true), /Nothing set up yet/);

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
  for (const L of [LEADER, CO]) assert.deepEqual(sees(L), [...clanView, '🔗-link-tag', '🛡️-leaders', '💭-leader-chat'].sort(), 'leaders: everything');
  const chats = roles => Object.keys(byName).filter(n => can(byName[n], roles, V) && can(byName[n], roles, S)).sort();
  assert.deepEqual(chats(MEMBER), ['⚔️-war', '💬-general', '🔊 Clan voice', '🤖-bot-commands'].sort(), 'members chat only in war, general, bot-commands, voice');
  assert.ok(!chats(LEADER).includes('📜-rules') && !chats(LEADER).includes('📊-clan-stats'), 'rules and stats read-only even for leaders');
  assert.ok(!can(byName['🔗-link-tag'], NEWCOMER, S) && can(byName['🔗-link-tag'], NEWCOMER, 1n << 31n), 'newcomers can use /link but not chat');
}
calls.length = 0;
const s2 = await autoSetupNext(withIcon, 'G3', 'PPCCR8VU');
assert.match(s2.content, /Step 2 of 3 done[\s\S]*Rules → <#CR>[\s\S]*Clan stats → <#NEWCH/);
assert.match(s2.content, /Server icon: the clan badge/);
assert.ok(calls.some(c => c.method === 'DELETE' && /messages\/NOTE$/.test(c.url)), 'the "pinned a message" notice is removed');
const s3 = await autoSetupNext(withIcon, 'G3', 'PPCCR8VU');
assert.match(s3.content, /All done ✅[\s\S]*channel notes pinned[\s\S]*Still to do:[\s\S]*Drag/);
assert.equal(s3.components.length, 0);
assert.match((await autoSetupNext(env, 'G3', 'PPCCR8VU')).content, /Nothing in progress/);
// Continue button: leaders only.
assert.match(await text(await interaction({ type: 3, guild_id: 'G3', member: member('U3'), data: { custom_id: 'autosetup|next' } })), /Leaders only/);
// Fresh: everything new, the old channels deleted in the last step.
const pvF = (await autoSetup(env, 'G3', cfg3, 'PPCCR8VU', false, true)).content;
assert.match(pvF, /Deletes 4 existing channels[\s\S]*in 4 steps/);
await autoSetup(env, 'G3', cfg3, 'PPCCR8VU', true, true);
await autoSetupNext(env, 'G3', 'PPCCR8VU'); const f3 = await autoSetupNext(env, 'G3', 'PPCCR8VU');
assert.match(f3.content, /Last step deletes the \*\*4 old channels\*\*/);
calls.length = 0;
const f4 = await autoSetupNext(env, 'G3', 'PPCCR8VU');
assert.match(f4.content, /set up the server ✅[\s\S]*Deleted 4 old channels/);
assert.deepEqual(calls.filter(c => c.method === 'DELETE' && /\/channels\/\w+$/.test(c.url)).map(c => c.url.split('/').pop()).sort(), ['CLC', 'CR', 'CV', 'CW']);
// A channel it can't delete is named in the summary.
await autoSetup(env, 'G3', cfg3, 'PPCCR8VU', true, true); await autoSetupNext(env, 'G3', 'PPCCR8VU'); await autoSetupNext(env, 'G3', 'PPCCR8VU');
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
  assert.match(pv4, /<#BT>: to-do list/); assert.doesNotMatch(pv4, /➕ #🛡️-leaders/);
  globalThis.fetch = realF; }

// Older single-channel setups: leaders-only posts never go to that public channel; changing settings keeps it.
await DB.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES ('discord:OLD', '{"clan":"PPCCR8VU","channel":"PUB","roles":{}}')`);
const { postTodo } = await import('../worker/discord.js');
calls.length = 0;
await postTodo(env, 'PPCCR8VU', 'OLD');
assert.ok(!calls.some(c => /channels\/PUB\//.test(c.url)), 'no to-do list in the public channel');
await interaction({ type: 2, guild_id: 'OLD', member: leader, data: { name: 'setup', options: [] } });
assert.deepEqual(JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'discord:OLD'").first()).v).channels, { war: 'PUB', results: 'PUB', joins: 'PUB' }, 'migrated, not dropped');

// Donors: rows saved with week 'unknown' never count as "this week".
await DB.exec(`INSERT INTO member_stats (clan,week,tag,donations) VALUES ('PPCCR8VU','unknown','YVJRGLCC',9999)`);
assert.match(await statsBoard(env, 'PPCCR8VU'), /Top donors this week:\*\* Luke 320/);

// /mystats: the reset time from the game's compact timestamp.
await DB.exec(`UPDATE wars SET ended_at = '20261029T094312.000Z' WHERE week = '2-1'`);
assert.match(JSON.stringify(await meCard(env, 'PPCCR8VU', '2VJ9V2PV')), /resets \d\d:\d\d UK/);

console.log('Discord checks passed');
