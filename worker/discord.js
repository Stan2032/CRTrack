// Discord bot, run inside the Worker (no separate server):
//   - Slash commands arrive at /api/discord (Discord signs each request; we check the signature).
//   - We call Discord's REST API with the bot token to post messages, ping people, and set roles/nicknames.
// Secrets: DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, DISCORD_APP_ID; optional DISCORD_GUILD_ID (commands appear instantly there).
import { readMember, writeNotes, cr } from './history.js';
import { reliability } from './stats.gen.js';
import { sanitizeRules, DEFAULT_RULES, RANK_POINTS, cleanName } from './logic.gen.js';
const FINISH_POINTS = 10000;   // a normal week's race can't pass this; a colosseum's medal totals can
import { meCard, statsBoard } from './cards.js';
import { seasonRecap, scoutRivals, leaderDigest, backupFile } from './extras.js';
import { PUSH_SCHEMA } from './push.js';

const API = 'https://discord.com/api/v10';
export const DISCORD_SCHEMA = `CREATE TABLE IF NOT EXISTS discord_links (guild TEXT, user_id TEXT, clan TEXT, tag TEXT, at TEXT, by TEXT, PRIMARY KEY (guild, user_id));
CREATE TABLE IF NOT EXISTS discord_reminders (guild TEXT, user_id TEXT, hours INTEGER, dm TEXT, PRIMARY KEY (guild, user_id));
CREATE TABLE IF NOT EXISTS discord_digest (guild TEXT, user_id TEXT, dm TEXT, PRIMARY KEY (guild, user_id));
CREATE TABLE IF NOT EXISTS discord_warreport (guild TEXT, user_id TEXT, dm TEXT, PRIMARY KEY (guild, user_id));
CREATE TABLE IF NOT EXISTS discord_guests (guild TEXT, user_id TEXT, since TEXT, warned INTEGER DEFAULT 0, PRIMARY KEY (guild, user_id));`;
const TAG = /^[0289PYLQGRJCUV]{3,12}$/;
const EPHEMERAL = 64;                              // only the person who ran the command sees the reply
const MANAGE_ROLES = 1n << 28n, ADMIN = 1n << 3n;  // who counts as a leader in Discord

const cleanTag = t => String(t || '').trim().toUpperCase().replace(/^#/, '').replace(/O/g, '0');

// ---- Commands (registered with /api/discord/register) ----
const sub = (name, description, options = []) => ({ type: 1, name, description, options });
const bool = (name, description, required = false) => ({ type: 5, name, description, required });
const tagOpt = (description, required = true) => ({ type: 3, name: 'tag', description, required });
export const COMMANDS = [
  // Everyone
  { name: 'link', description: 'Connect your Discord to your Clash Royale account', options: [tagOpt('Your player tag, e.g. #ABC123')] },
  { name: 'unlink', description: 'Disconnect your Discord from your Clash Royale account' },
  { name: 'mystats', description: 'Your war report: this war, past wars, reliability, how you play', options: [bool('share', 'Show it to everyone (default: only you)')] },
  { name: 'remind', description: 'Get a DM before reset if you still have decks to play', options: [
    { type: 4, name: 'hours', description: 'Hours before reset (0 = stop)', required: true, min_value: 0, max_value: 12 }] },
  { name: 'apply', description: 'Apply to join the clan: the leaders get your war record and decide', options: [tagOpt('Your player tag, e.g. #ABC123')] },
  { name: 'privacy', description: 'What War Audit keeps about you, and how to delete it', options: [bool('delete', 'Delete your Discord link and settings now')] },
  { name: 'warreport', description: 'Get your war result by DM after each war', options: [bool('on', 'On or off', true)] },
  { name: 'away', description: 'Tell the leaders you\'re away (no automatic kick)', options: [
    { type: 4, name: 'days', description: 'Days away (0 = I\'m back)', required: true, min_value: 0, max_value: 21 },
    { type: 3, name: 'reason', description: 'Optional, e.g. holiday', max_length: 100 },
    { type: 6, name: 'user', description: 'Leaders: someone else' }] },
  { name: 'clan', description: 'Clan stats, season recaps and this war\'s rivals', options: [
    sub('stats', 'Recent wars, most reliable, streaks, battle types', [bool('share', 'Show it to everyone (default: only you)')]),
    sub('season', 'Season recap: placings, top 5, most improved', [{ type: 4, name: 'number', description: 'Season number (default: latest)' }, bool('share', 'Show it to everyone (default: only you)')]),
    sub('scout', 'The clans we\'re racing and how they usually do')] },
  // Leaders
  { name: 'leader', description: 'Leader tools', default_member_permissions: '1', options: [
    sub('player', 'A member\'s record', [tagOpt('Player tag, e.g. #ABC123', false), { type: 6, name: 'user', description: 'Or a linked Discord member' }]),
    sub('check', 'Check someone who wants to join', [tagOpt('Their player tag, e.g. #ABC123')]),
    sub('links', 'Who is linked, and who isn\'t yet'),
    sub('link', 'Link someone else', [{ type: 6, name: 'user', description: 'Discord member', required: true }, tagOpt('Their player tag')]),
    sub('digest', 'Also get the weekly digest by DM', [bool('on', 'On or off', true)]),
    sub('backup', 'Post a backup file of the full history now'),
    sub('forget', 'Delete someone\'s data on request', [{ type: 6, name: 'user', description: 'Their Discord account' }, tagOpt('Or their player tag', false),
      bool('history', 'Also delete their stored war history (kept otherwise as the clan\'s records)')])] },
  { name: 'setup', description: 'Leaders: server setup', default_member_permissions: '1', options: [
    sub('auto', 'Set up the whole server (roles, channels, permissions, posts)', [bool('apply', 'False: show the plan. True: do it.'), bool('fresh', 'Build everything new and delete the old channels')]),
    sub('show', 'What the bot posts where, and its roles'),
    sub('channel', 'Choose what the bot posts in THIS channel', [{ type: 3, name: 'what', description: 'What this channel is for', required: true, choices: [
      { name: 'War board + reminders', value: 'war' }, { name: 'Summaries + results', value: 'results' }, { name: 'Rival scouting', value: 'scout' },
      { name: 'Welcomes + shout-outs', value: 'joins' }, { name: 'Leaders: absences, digest, backups', value: 'leaders' }, { name: 'Not in clan (waiting room)', value: 'guests' },
      { name: 'Clan stats board', value: 'stats' }, { name: 'Rules', value: 'rules' }, { name: 'How to link', value: 'welcome' }, { name: 'Nothing', value: 'none' }] }]),
    sub('sync', 'Update everyone\'s roles and nicknames from the game'),
    sub('refresh', 'Re-post and pin the rules, stats and other kept messages', [bool('clean', 'First delete the bot\'s old messages')]),
    sub('check', 'Check the live server: what each role can see and post in'),
    sub('pings', 'When battle-day pings go out', [{ type: 4, name: 'hour', description: 'Evening ping hour, UK time (0-23)', min_value: 0, max_value: 23 },
      bool('auto', 'Evening ping at the start of the clan\'s busiest hours'), { type: 4, name: 'last_call', description: 'Last call this many hours before reset (0 = off)', min_value: 0, max_value: 6 }]),
    sub('tidy', 'Remove people from the Not in clan waiting room after some days', [{ type: 4, name: 'days', description: 'Days in the waiting room before removal (0 = never)', required: true, min_value: 0, max_value: 60 }]),
    sub('remove', 'Leader only: delete everything War Audit made in this server (asks first)', [bool('links', 'Also delete everyone\'s linked accounts and settings')])] },
];
// Grouped commands → the handlers' own names (older single commands still work while Discord updates).
const ALIAS = { 'clan stats': 'stats', 'clan season': 'season', 'clan scout': 'scout', 'leader player': 'player', 'leader check': 'check',
  'leader links': 'links', 'leader link': 'linkuser', 'leader digest': 'digest', 'leader backup': 'backup', 'leader forget': 'forget', 'setup auto': 'autosetup', 'setup show': 'setup',
  'setup channel': 'post-here', 'setup sync': 'sync', 'setup refresh': 'refresh', 'setup check': 'whosees', 'setup remove': 'remove', 'setup tidy': 'tidy', 'setup pings': 'pings', me: 'mystats', whosees: 'whosees' };

export const discordReady = env => !!(env.DISCORD_PUBLIC_KEY && env.DISCORD_BOT_TOKEN && env.DISCORD_APP_ID && env.DB);

// ---- Signature check (Ed25519) ----
const hex = h => new Uint8Array(String(h).match(/../g)?.map(b => parseInt(b, 16)) || []);
export async function verifyDiscord(request, body, publicKey) {
  const sig = request.headers.get('X-Signature-Ed25519'), ts = request.headers.get('X-Signature-Timestamp');
  if (!sig || !ts || !publicKey) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, hex(sig), new TextEncoder().encode(ts + body));
  } catch (e) { return false; }
}

// ---- Discord REST ----
async function dapi(env, method, path, body) {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok && r.status !== 204) throw new Error(`Discord ${method} ${path.split('/').slice(0, 3).join('/')}: ${r.status}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

export async function registerCommands(env) {
  const path = env.DISCORD_GUILD_ID ? `/applications/${env.DISCORD_APP_ID}/guilds/${env.DISCORD_GUILD_ID}/commands` : `/applications/${env.DISCORD_APP_ID}/commands`;
  const r = await dapi(env, 'PUT', path, COMMANDS);
  // Registering for one server: clear any older all-servers copy, or Discord lists every command twice.
  if (env.DISCORD_GUILD_ID) await dapi(env, 'PUT', `/applications/${env.DISCORD_APP_ID}/commands`, []).catch(() => {});
  return { registered: (r || []).length, where: env.DISCORD_GUILD_ID ? 'your server (instant)' : 'all servers (can take up to an hour)' };
}

// ---- Config and links ----
async function setupDB(env) { await env.DB.exec(DISCORD_SCHEMA + '\n' + PUSH_SCHEMA); }
async function getConfig(env, guild) {
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('discord:' + guild).first();
  return r ? JSON.parse(r.v) : null;
}
async function setConfig(env, guild, cfg) { await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('discord:' + guild, JSON.stringify(cfg)).run(); }
async function allConfigs(env) {
  return (await env.DB.prepare("SELECT k, v FROM kv WHERE k LIKE 'discord:%'").all()).results
    .filter(r => /^discord:[^:]+$/.test(r.k)).map(r => ({ guild: r.k.slice(8), ...JSON.parse(r.v) }));
}
// Which channel gets which kind of post: war (board + reminders), results (summaries + war results), joins.
export const JOBS = { bot: 'Bot commands (note only)', guests: 'Not in clan (waiting room)', war: 'War board + battle-day reminders', results: 'Battle day summaries + war results', joins: 'Welcomes + shout-outs', scout: 'Rival scouting',
  leaders: 'Leaders only: absences, digest, backups' };
const LEGACY_JOBS = ['war', 'results', 'joins'];   // the only jobs an older single-channel setup had
const chan = (cfg, job) => cfg?.channels ? cfg.channels[job] : LEGACY_JOBS.includes(job) ? cfg?.channel : undefined;
const channelsOf = cfg => ({ ...(cfg?.channels || (cfg?.channel ? Object.fromEntries(LEGACY_JOBS.map(j => [j, cfg.channel])) : {})) });

async function findRoles(env, guild, opt, cfg) {
  const byName = {};
  if (!opt.member_role || !opt.elder_role || !opt.coleader_role || !opt.leader_role) {
    const list = await dapi(env, 'GET', `/guilds/${guild}/roles`).catch(() => []);
    for (const r of Array.isArray(list) ? list : []) { const k = String(r.name).toLowerCase().replace(/[^a-z]/g, ''); if (['member', 'elder', 'coleader', 'leader'].includes(k) && !byName[k]) byName[k] = r.id; }
  }
  return { member: opt.member_role || cfg?.roles?.member || byName.member, elder: opt.elder_role || cfg?.roles?.elder || byName.elder,
    coLeader: opt.coleader_role || cfg?.roles?.coLeader || byName.coleader, leader: opt.leader_role || cfg?.roles?.leader || byName.leader,
    ...(cfg?.roles?.guest ? { guest: cfg.roles.guest } : {}) };
}

async function overview(env, guild, cfg) {
  const at = ch => ch ? `<#${ch}>` : '_not set_';
  const saved = async k => { const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? JSON.parse(r.v).channel : null; };
  const r = cfg?.roles || {};
  return [`**What the bot posts where**`,
    ...Object.entries(JOBS).map(([k, label]) => `• ${label} → ${at(chan(cfg, k))}`),
    `• Rules → ${at(await saved('discord:rules:' + guild))}`,
    `• How to link → ${at(await saved('discord:welcome:' + guild))}`,
    `• Clan stats board → ${at(await saved('discord:stats:' + guild))}`,
    ``, `**Roles that follow the game:** ${[['Member', r.member], ['Elder', r.elder], ['Co-leader', r.coLeader], ['Leader', r.leader]].map(([k, id]) => `${k} → ${id ? `<@&${id}>` : 'none'}`).join(', ')}`,
    `Waiting room: removed after **${(cfg?.tidyDays ?? 7) || 'never'}${(cfg?.tidyDays ?? 7) ? ' days' : ''}** (change: \`/setup tidy\`)`,
    ``, `To change a channel: go to it and run \`/setup channel\`.`].join('\n');
}

const reply = (content, ephemeral = true) => ({ type: 4, data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });
const isLeader = (member, cfg) => {
  const p = BigInt(member?.permissions || '0');
  if ((p & ADMIN) === ADMIN || (p & MANAGE_ROLES) === MANAGE_ROLES) return true;
  const lead = [cfg?.roles?.leader, cfg?.roles?.coLeader].filter(Boolean);
  return (member?.roles || []).some(r => lead.includes(r));
};

// The clan Leader only (not Co-Leaders): the server owner/admins, or whoever has the Leader role.
const isTopLeader = (member, cfg) => (BigInt(member?.permissions || '0') & ADMIN) === ADMIN || (!!cfg?.roles?.leader && (member?.roles || []).includes(cfg.roles.leader));

// Desired clan role and nickname for a linked user, from their game role.
async function syncOne(env, guild, cfg, userId, m) {
  if (!cfg?.roles) return;
  const clanRoles = Object.values(cfg.roles).filter(Boolean);   // ranks and "Not in clan"
  const want = m && m.in_clan ? (cfg.roles[m.role] || cfg.roles.member) : m && cfg.roles.guest ? cfg.roles.guest : null;
  if (cfg.roles.guest) await guestSince(env, guild, userId, want === cfg.roles.guest).catch(() => {});
  const cur = await dapi(env, 'GET', `/guilds/${guild}/members/${userId}`).catch(() => null);
  if (!cur) return;
  const has = Array.isArray(cur.roles) ? cur.roles : [];
  const roles = has.filter(r => !clanRoles.includes(r)).concat(want ? [want] : []);
  const patch = {};
  if (roles.slice().sort().join() !== has.slice().sort().join()) patch.roles = roles;
  const nick = m && m.in_clan ? cleanName(m.name).slice(0, 32) : null;
  if (nick && cur.nick !== nick) patch.nick = nick;
  if (Object.keys(patch).length) await dapi(env, 'PATCH', `/guilds/${guild}/members/${userId}`, patch).catch(() => {});   // can't rename the server owner; ignore
}

// ---- Privacy ----
export const PRIVACY = `🔒 **Privacy: what War Audit keeps**

**From Clash Royale's public data** (anyone can see it in game or on RoyaleAPI): your name, tag, clan role, last online, donations, war medals, decks and war battles. Kept as the clan's war history, so leaders can run the clan fairly.
**From Discord, only if you use the bot:** your Discord account linked to your tag, and what you turn on (\`/remind\`, \`/warreport\`, \`/away\`, \`/apply\`, the digest).
**Leaders' notes:** war decisions (e.g. warnings, check-ins) and who changed what.

It's stored with Cloudflare (Western Europe), used only to run the clan, and never sold or shared.
**Delete it:** \`/privacy delete:True\` removes your Discord link and settings straight away (\`/unlink\` just disconnects). Want your war history removed too? Ask a leader (\`/leader forget\`).
_Unofficial: not endorsed by Supercell._`;

async function forgetDiscord(env, guild, user) {
  let n2 = 0;
  const link = await env.DB.prepare('SELECT clan, tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, user).first();
  if (link) n2 += (await env.DB.prepare("DELETE FROM notes WHERE clan = ? AND tag = ? AND kind = 'away'").bind(link.clan, link.tag).run())?.meta?.changes || 0;
  for (const t of ['discord_links', 'discord_reminders', 'discord_digest', 'discord_warreport', 'discord_guests'])
    n2 += (await env.DB.prepare(`DELETE FROM ${t} WHERE guild = ? AND user_id = ?`).bind(guild, user).run())?.meta?.changes || 0;
  n2 += (await env.DB.prepare('DELETE FROM kv WHERE k = ? OR k = ? OR k LIKE ? OR k LIKE ?').bind(`verify:${guild}:${user}`, `apply:${guild}:${user}`, `dm:%:${user}`, `wr:%:${guild}:${user}`).run())?.meta?.changes || 0;
  return n2;
}

export async function forgetHistory(env, clan, tag) {
  const sql = ['members', 'member_events', 'war_players', 'race_days', 'race_events', 'war_battles', 'member_stats', 'notes', 'note_log']
    .map(t => env.DB.prepare(`DELETE FROM ${t} WHERE clan = ? AND tag = ?`).bind(clan, tag));
  await env.DB.batch(sql);
}

// ---- Applications: a card in the leaders' channel with the applicant's record and Accept / Decline buttons ----
async function postApplication(env, guild, cfg, clan, user, tag) {
  const [card, info] = await Promise.all([recruitCard(env, clan, tag), cr(env, `/clans/${encodeURIComponent('#' + clan)}`).catch(() => null)]);
  const pl = await cr(env, `/players/${encodeURIComponent('#' + tag)}`).catch(() => null);
  const req = info?.requiredTrophies, meets = pl && req ? pl.trophies >= req : null;
  const content = [`📝 **Application** from <@${user}>`, card, req ? `🏆 Clan requirement ${n(req)} trophies: ${meets ? '✅ meets it' : '❌ below it'}` : ''].filter(Boolean).join('\n').slice(0, 1900);
  const buttons = [{ type: 1, components: [
    { type: 2, style: 3, label: 'Accept', custom_id: `apply|yes|${user}|${tag}` },
    { type: 2, style: 4, label: 'Decline', custom_id: `apply|no|${user}|${tag}` }] }];
  await dapi(env, 'POST', `/channels/${chan(cfg, 'leaders')}/messages`, { content, components: buttons, allowed_mentions: { parse: [] } });
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`apply:${guild}:${user}`, JSON.stringify({ tag, at: Date.now(), done: false })).run();
  return `Sent to the leaders ✅ You'll hear back by DM${chan(cfg, 'guests') ? ` (or in <#${chan(cfg, 'guests')}> if your DMs are off)` : ''}.`;
}

async function decideApplication(i, env, how, applicant, tag) {
  const cfg = await getConfig(env, i.guild_id), clan = cfg?.clan || (env.ALLOWED_CLANS || '').split(',')[0]?.trim().toUpperCase().replace(/^#/, '');
  if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
  const who = cleanName(i.member?.nick || i.member?.user?.global_name || i.member?.user?.username || 'a leader');
  const yes = how === 'yes';
  const text = yes
    ? `✅ **You've been accepted into the clan!** In Clash Royale, search for the clan tag **#${clan}** and request to join (a leader will let you in). Once you're in, use \`/link #${tag}\` in the Discord.`
    : `Thanks for applying to the clan (#${clan}). The leaders have decided not to take you on right now. You're welcome to apply again another time.`;
  const dm = (await dapi(env, 'POST', '/users/@me/channels', { recipient_id: applicant }).catch(() => null))?.id;
  const told = dm && await dapi(env, 'POST', `/channels/${dm}/messages`, { content: text }).then(() => true, () => false);
  if (!told && chan(cfg, 'guests')) await dapi(env, 'POST', `/channels/${chan(cfg, 'guests')}/messages`, { content: `<@${applicant}> ${text}`, allowed_mentions: { parse: [], users: [applicant] } }).catch(() => null);
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`apply:${i.guild_id}:${applicant}`, JSON.stringify({ tag, at: Date.now(), done: true, accepted: yes })).run();
  const original = String(i.message?.content || '');
  return Response.json({ type: 7, data: { content: `${original}\n\n${yes ? '✅ **Accepted**' : '❌ **Declined**'} by ${who}${told ? ' (told by DM)' : chan(cfg, 'guests') ? ' (told in the waiting room: DMs closed)' : ' (couldn\'t tell them: DMs closed)'}`.slice(0, 1990), components: [], allowed_mentions: { parse: [] } } });
}

// ---- Waiting room: who has had the Not in clan role, since when; tidied after cfg.tidyDays (default 7, 0 = off) ----
async function guestSince(env, guild, user, on) {
  if (on) await env.DB.prepare('INSERT OR IGNORE INTO discord_guests (guild, user_id, since, warned) VALUES (?, ?, ?, 0)').bind(guild, user, new Date().toISOString()).run();
  else await env.DB.prepare('DELETE FROM discord_guests WHERE guild = ? AND user_id = ?').bind(guild, user).run();
}

// Once a day: a heads-up in the waiting room the day before, then removal from the server. Leaders are never removed.
export async function tidyGuests(env, clan, now = Date.now()) {
  if (!discordReady(env)) return { warned: 0, removed: 0 };
  await setupDB(env);
  const day = new Date(now).toISOString().slice(0, 10), out = { warned: 0, removed: 0 };
  if (await env.DB.prepare('SELECT 1 FROM kv WHERE k = ?').bind(`tidy:${clan}:${day}`).first()) return out;
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`tidy:${clan}:${day}`, '1').run();
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan && c.roles?.guest)) {
    const days = cfg.tidyDays ?? 7;
    if (!days) continue;
    const rows = (await env.DB.prepare('SELECT user_id, since, warned FROM discord_guests WHERE guild = ?').bind(cfg.guild).all()).results;
    const lead = [cfg.roles.leader, cfg.roles.coLeader].filter(Boolean);
    let budget = 15;
    for (const r of rows) {
      if (budget <= 0) break;
      const age = (now - Date.parse(r.since)) / 864e5;
      if (age < days - 1) continue;
      budget--;
      const cur = await dapi(env, 'GET', `/guilds/${cfg.guild}/members/${r.user_id}`).catch(() => null);
      if (!cur || !(cur.roles || []).includes(cfg.roles.guest) || (cur.roles || []).some(x => lead.includes(x))) { await guestSince(env, cfg.guild, r.user_id, false); continue; }   // left, linked, or a leader
      if (!r.warned) {
        const ch = chan(cfg, 'guests');
        if (ch) await dapi(env, 'POST', `/channels/${ch}/messages`, { content: `<@${r.user_id}> you've been here ${Math.floor(age)} days without joining the clan. If you haven't joined in game and \`/link\`ed by tomorrow, you'll be removed from the server (you can come back any time with a new invite). Questions? Ask a leader here.`, allowed_mentions: { parse: [], users: [r.user_id] } }).catch(() => null);
        await env.DB.prepare('UPDATE discord_guests SET warned = 1 WHERE guild = ? AND user_id = ?').bind(cfg.guild, r.user_id).run();
        out.warned++;
      } else if (age >= days) {
        const ok = await fetch(`${API}/guilds/${cfg.guild}/members/${r.user_id}`, { method: 'DELETE', headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'X-Audit-Log-Reason': `Not in the clan for ${days}+ days` } }).then(x => x.ok || x.status === 404, () => false);
        if (ok) { await guestSince(env, cfg.guild, r.user_id, false); out.removed++; }
      }
    }
  }
  return out;
}

// ---- Tag proof: the player plays one battle with 2 of their own cards in their deck; the bot finds it in their battle log.
// Only the account owner can play their battles. (The API's "currentDeck" isn't reliable: on 18 Nov it showed a deck
// iccyman2511 hadn't played, while his battle log already had the battle with both cards. The profile's favourite card
// can't be set: the game picks it.) ----
const saveLink = (env, guild, target, clan, tag, by) => env.DB.prepare('INSERT OR REPLACE INTO discord_links (guild, user_id, clan, tag, at, by) VALUES (?, ?, ?, ?, ?, ?)').bind(guild, target, clan, tag, new Date().toISOString(), by).run();
const proofKey = (guild, user) => `verify:${guild}:${user}`;
const PROOF_MS = 60 * 60e3;   // an hour to play the battle
const battleMs = t => { const x = String(t || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/); return x ? Date.UTC(+x[1], x[2] - 1, +x[3], +x[4], +x[5], +x[6]) : 0; };
// A battle since the proof started where this player's deck had both cards (team[] holds both players in 2v2).
export function provenBy(log, tag, cards, since) {
  return (Array.isArray(log) ? log : []).some(b => battleMs(b.battleTime) >= since - 2 * 60e3 && (b.team || []).some(t =>
    String(t.tag || '').replace('#', '').toUpperCase() === tag && cards.every(c => (t.cards || []).some(x => x.name === c))));
}
const proofButtons = [{ type: 1, components: [{ type: 2, style: 3, label: '✅ Done: check it', custom_id: 'verify|check' }] }];
const proofText = (tag, name, cards, extra = '') => `To prove **${name}** (#${tag}) is your account:\n**1.** In Clash Royale, put **${cards[0]}** and **${cards[1]}** in your deck.\n**2.** Play **one battle** with that deck (any mode: a friendly battle counts).\n**3.** Tap **Done: check it** below.\n\nSwap the cards back afterwards. A battle can take a minute or two to show up.${extra}`;

async function startProof(env, guild, user, tag, m) {
  const pl = await cr(env, `/players/${encodeURIComponent('#' + tag)}`).catch(() => null);
  if (!pl) return reply('Couldn\'t reach the game\'s data just now. Try `/link` again in a minute.');
  // Same tag asked again within the time limit: keep the same two cards (don't move the goalposts mid-way).
  const prev = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(proofKey(guild, user)).first().then(r => r && JSON.parse(r.v));
  if (prev && prev.tag === tag && Date.now() - prev.at < PROOF_MS && prev.cards?.length === 2)
    return { type: 4, data: { content: proofText(tag, cleanName(m.name), prev.cards), components: proofButtons, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
  const inDeck = new Set((pl.currentDeck || []).map(c => c.name)), pool = (pl.cards || []).map(c => c.name).filter(n => n && !inDeck.has(n));
  if (pool.length < 2) return reply('Couldn\'t read that account\'s cards. Ask a leader to link you with `/leader link`.');
  const a = Math.floor(Math.random() * pool.length); let b = Math.floor(Math.random() * (pool.length - 1)); if (b >= a) b++;
  const cards = [pool[a], pool[b]];
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(proofKey(guild, user), JSON.stringify({ tag, cards, at: Date.now() })).run();
  return { type: 4, data: { content: proofText(tag, cleanName(m.name), cards), components: proofButtons, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}

// The Check button: both cards in their deck → linked, roles and nickname set.
async function checkProof(i, env, ctx) {
  const guild = i.guild_id, user = i.member?.user?.id;
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(proofKey(guild, user)).first();
  const update = (content, components = []) => Response.json({ type: 7, data: { content, components, allowed_mentions: { parse: [] } } });
  if (!row) return update('Nothing to check. Start with `/link #YOURTAG`.');
  const v = JSON.parse(row.v);
  if (Date.now() - v.at > PROOF_MS) { await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind(proofKey(guild, user)).run(); return update('That took over an hour. Run `/link` again for two new cards.'); }
  const cfg = await getConfig(env, guild), clan = cfg?.clan || (env.ALLOWED_CLANS || '').split(',')[0]?.trim().toUpperCase().replace(/^#/, '');
  const m = await env.DB.prepare('SELECT tag, name, role, in_clan FROM members WHERE clan = ? AND tag = ?').bind(clan, v.tag).first();
  const log = await cr(env, `/players/${encodeURIComponent('#' + v.tag)}/battlelog`).catch(() => null);
  if (!log || !provenBy(log, v.tag, v.cards, v.at))
    return update(proofText(v.tag, cleanName(m?.name || v.tag), v.cards, `\n\n⏳ **Not yet:** ${log ? `no battle since you started with both **${v.cards[0]}** and **${v.cards[1]}** in your deck` : 'couldn\'t reach the game\'s data'}. Play one (or wait a minute if you just did), then tap again.`), proofButtons);
  const taken = await env.DB.prepare('SELECT user_id FROM discord_links WHERE guild = ? AND tag = ? AND user_id != ?').bind(guild, v.tag, user).first();
  if (taken) await env.DB.prepare('DELETE FROM discord_links WHERE guild = ? AND tag = ?').bind(guild, v.tag).run();   // proven owner wins
  await saveLink(env, guild, user, clan, v.tag, user);
  await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind(proofKey(guild, user)).run();
  const work = syncOne(env, guild, cfg, user, m).catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
  return update(`✅ **Proven and linked** to **${cleanName(m?.name || v.tag)}** (#${v.tag}). Your role and nickname are being set. You can swap the cards back now.`);
}

// ---- Slash command handling ----
export async function handleDiscord(request, env, ctx) {
  const body = await request.text();
  if (!(await verifyDiscord(request, body, env.DISCORD_PUBLIC_KEY))) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return Response.json({ type: 1 });                       // Discord's endpoint check
  if (i.type === 3) return handleButton(i, env, ctx);
  if (i.type !== 2) return Response.json(reply('Not supported'));
  await setupDB(env);
  const subc = (i.data.options || []).find(o => o.type === 1);
  if (subc) { i.data.name = ALIAS[`${i.data.name} ${subc.name}`] || subc.name; i.data.options = subc.options || []; }
  else if (ALIAS[i.data.name] && i.data.name !== 'whosees') i.data.name = ALIAS[i.data.name];
  const guild = i.guild_id, user = i.member?.user?.id || i.user?.id, opt = Object.fromEntries((i.data.options || []).map(o => [o.name, o.value]));
  const cfg = guild ? await getConfig(env, guild) : null;
  const clan = cfg?.clan || (env.ALLOWED_CLANS || '').split(',')[0]?.trim().toUpperCase().replace(/^#/, '');
  if (!guild) return Response.json(reply('Use this in your clan\'s Discord server.'));
  const member = tag => env.DB.prepare('SELECT tag, name, role, in_clan FROM members WHERE clan = ? AND tag = ?').bind(clan, tag).first();
  const later = p => ctx?.waitUntil ? ctx.waitUntil(p.catch(() => {})) : p.catch(() => {});

  switch (i.data.name) {
    case 'link': case 'linkuser': {
      if (i.data.name === 'linkuser' && !isLeader(i.member, cfg)) return Response.json(reply('Only leaders (Manage Roles) can link other people.'));
      const target = i.data.name === 'linkuser' ? opt.user : user, tag = cleanTag(opt.tag);
      if (!TAG.test(tag)) return Response.json(reply('That doesn\'t look like a player tag. It\'s under your name on your profile, e.g. #ABC123.'));
      const m = await member(tag);
      if (!m || !m.in_clan) {
        const g = cfg?.roles?.guest, room = chan(cfg, 'guests');
        if (g && i.data.name === 'link') later(dapi(env, 'PUT', `/guilds/${guild}/members/${target}/roles/${g}`).then(() => guestSince(env, guild, target, true)));
        return Response.json(reply(`#${tag} isn't in the clan right now.` + (g && i.data.name === 'link'
          ? ` You can now see${room ? ` <#${room}>` : ' the Not in clan channel'}: ask a leader there, or join the clan in game and \`/link\` again. You're free to leave the server any time.`
          : ' Join in game first, then link.')));
      }
      const taken = await env.DB.prepare('SELECT user_id FROM discord_links WHERE guild = ? AND tag = ? AND user_id != ?').bind(guild, tag, target).first();
      // Already linked to someone else: proving it (cards in their deck) takes it over; otherwise ask a leader.
      // Members prove the tag is theirs (2 cards into their deck in game); leaders linking someone else vouch for them.
      if (i.data.name === 'link') {
        const already = await env.DB.prepare('SELECT 1 FROM discord_links WHERE guild = ? AND user_id = ? AND tag = ?').bind(guild, target, tag).first();
        if (!already) return Response.json(await startProof(env, guild, target, tag, m));
      }
      if (taken) await env.DB.prepare('DELETE FROM discord_links WHERE guild = ? AND tag = ?').bind(guild, tag).run();
      await saveLink(env, guild, target, clan, tag, user);
      later(syncOne(env, guild, cfg, target, m));
      return Response.json(reply(`Linked <@${target}> to **${cleanName(m.name)}** (#${tag}).${cfg?.roles ? ' Roles and nickname will update shortly.' : ''}`));
    }
    case 'unlink': {
      await env.DB.prepare('DELETE FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, user).run();
      later(syncOne(env, guild, cfg, user, null));
      return Response.json(reply('Unlinked.'));
    }
    case 'mystats': case 'me': {
      const link = await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, user).first();
      if (!link) return Response.json(reply('Link your account first: `/link #YOURTAG`'));
      const card = await meCard(env, clan, link.tag);
      if (!card) return Response.json(reply('Couldn\'t find you in the clan.'));
      return Response.json({ type: 4, data: { ...card, flags: opt.share ? 0 : EPHEMERAL, allowed_mentions: { parse: [] } } });
    }
    case 'stats': {
      return Response.json(reply(await statsBoard(env, clan), !opt.share));
    }
    case 'remind': {
      const link = await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, user).first();
      if (!link) return Response.json(reply('Link your account first: `/link #YOURTAG`'));
      const hours = Math.max(0, Math.min(12, Number(opt.hours) || 0));
      if (!hours) {
        await env.DB.prepare('DELETE FROM discord_reminders WHERE guild = ? AND user_id = ?').bind(guild, user).run();
        return Response.json(reply('Reminders off.'));
      }
      // Check now that a private message gets through (it doesn't if they block DMs from server members).
      const dm = (await dapi(env, 'POST', '/users/@me/channels', { recipient_id: user }).catch(() => null))?.id;
      const ok = dm && await dapi(env, 'POST', `/channels/${dm}/messages`, { content: `✅ Reminders on: I'll message you here when a battle day has ${hours} hour${hours === 1 ? '' : 's'} left and you still have decks to play. Stop with \`/remind 0\`.` }).then(() => true, () => false);
      if (!ok) return Response.json(reply('I can\'t send you private messages. Long-press the server icon → **Privacy settings** → turn on **Direct Messages**, then run `/remind` again.'));
      await env.DB.prepare('INSERT OR REPLACE INTO discord_reminders (guild, user_id, hours, dm) VALUES (?, ?, ?, ?)').bind(guild, user, hours, dm).run();
      return Response.json(reply(`Done: you'll get a private message when a battle day has **${hours} hour${hours === 1 ? '' : 's'}** left and you still have decks to play. I've sent one now so you can see it.`));
    }
    case 'apply': {
      const tag = cleanTag(opt.tag);
      if (!TAG.test(tag)) return Response.json(reply('That doesn\'t look like a player tag. It\'s under your name on your profile, e.g. #ABC123.'));
      const inClan = await member(tag);
      if (inClan?.in_clan) return Response.json(reply('You\'re already in the clan: use `/link` to connect your account.'));
      if (!chan(cfg, 'leaders')) return Response.json(reply('Applications aren\'t set up here yet. Ask a leader.'));
      const prev = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(`apply:${guild}:${user}`).first().then(r => r && JSON.parse(r.v));
      if (prev && !prev.done) return Response.json(reply('Your application is with the leaders. You\'ll hear back soon.'));
      if (prev && Date.now() - prev.at < 864e5) return Response.json(reply('You can apply again tomorrow.'));
      later((async () => {
        const msg = await postApplication(env, guild, cfg, clan, user, tag).catch(e => /404/.test(String(e.message)) ? `#${tag}: player not found. Check the tag.` : 'Couldn\'t reach the game\'s data. Try again in a minute.');
        await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { content: msg, allowed_mentions: { parse: [] } });
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'privacy': {
      if (!opt.delete) return Response.json(reply(PRIVACY));
      const n2 = await forgetDiscord(env, guild, user);
      later(syncOne(env, guild, cfg, user, null));
      return Response.json(reply(n2 ? '✅ Deleted: your Discord link and all your War Audit settings (reminders, war reports, digest, away, applications). Your clan role is removed; `/link` again any time.' : 'Nothing stored for your Discord account.'));
    }
    case 'forget': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      let tag = cleanTag(opt.tag), target = opt.user || null;
      if (target && !tag) tag = (await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, target).first())?.tag || '';
      if (!target && !tag) return Response.json(reply('Give a Discord member or a player tag.'));
      // Every Discord account linked to that tag in this server (normally one), plus the member named.
      const users = new Set([target, ...(tag ? (await env.DB.prepare('SELECT user_id FROM discord_links WHERE guild = ? AND tag = ?').bind(guild, tag).all()).results.map(r => r.user_id) : [])].filter(Boolean));
      const done = [];
      let gone = 0;
      for (const u of users) { gone += await forgetDiscord(env, guild, u); later(syncOne(env, guild, cfg, u, null)); }
      if (gone) done.push('Discord link and settings');
      if (opt.history && tag && TAG.test(tag)) { await forgetHistory(env, clan, tag); done.push(`stored war history for #${tag}`); }
      await env.DB.prepare('INSERT INTO note_log (clan,week,tag,kind,value,by,at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(clan, '*', tag || '*', 'forget', done.join(', ') || 'nothing found', 'Discord: ' + cleanName(i.member?.nick || i.member?.user?.username || 'leader'), new Date().toISOString()).run().catch(() => {});
      return Response.json(reply(done.length ? `✅ Deleted: ${done.join(' and ')}.${opt.history && tag ? ' If they\'re still in the clan, the game\'s current data (members list, this war) comes back at the next pull: that part is public game data.' : ''}` : 'Nothing stored for them.'));
    }
    case 'warreport': {
      const link = await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, user).first();
      if (!link) return Response.json(reply('Link your account first: `/link #YOURTAG`'));
      if (!opt.on) { await env.DB.prepare('DELETE FROM discord_warreport WHERE guild = ? AND user_id = ?').bind(guild, user).run(); return Response.json(reply('War reports off.')); }
      const dm = (await dapi(env, 'POST', '/users/@me/channels', { recipient_id: user }).catch(() => null))?.id;
      const ok = dm && await dapi(env, 'POST', `/channels/${dm}/messages`, { content: '📬 War reports on: after each war you\'ll get your result here (medals, place in the clan, streak, reliability). Stop with `/warreport on:False`.' }).then(() => true, () => false);
      if (!ok) return Response.json(reply('I can\'t send you private messages. Long-press the server icon → **Privacy settings** → turn on **Direct Messages**, then try again.'));
      await env.DB.prepare('INSERT OR REPLACE INTO discord_warreport (guild, user_id, dm) VALUES (?, ?, ?)').bind(guild, user, dm).run();
      return Response.json(reply('Done: you\'ll get your result by DM after each war. I\'ve sent a test message.'));
    }
    case 'away': {
      const other = opt.user && opt.user !== user;
      if (other && !isLeader(i.member, cfg)) return Response.json(reply('Only leaders can set someone else as away.'));
      const who = other ? opt.user : user;
      const link = await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, who).first();
      if (!link) return Response.json(reply(other ? `<@${who}> isn't linked yet: \`/leader link\` first.` : 'Link your account first: `/link #YOURTAG`'));
      const m = await member(link.tag), name = cleanName(m?.name || link.tag), days = Math.max(0, Math.min(21, Number(opt.days) || 0));
      const by = 'Discord: ' + cleanName(i.member?.nick || i.member?.user?.global_name || i.member?.user?.username || 'member');
      const now = Date.now(), value = days ? JSON.stringify({ from: new Date(now).toISOString(), until: new Date(now + days * 864e5).toISOString(), reason: String(opt.reason || '').slice(0, 100) }) : null;
      await writeNotes(env, clan, [{ week: '*', tag: link.tag, kind: 'away', value }], new Date(now).toISOString(), by);
      const until = ukDate(now + days * 864e5);
      later(postJob(env, guild, cfg, 'leaders', days ? `🏖️ **${name}** is away until **${until}**${opt.reason ? `: ${String(opt.reason).slice(0, 100)}` : ''}${other ? ` (set by ${by.slice(9)})` : ''}` : `👋 **${name}** is back.`));
      return Response.json(reply(days ? `Got it: ${other ? `**${name}** is` : 'you\'re'} away until **${until}**. The leaders can see it. Missing medals while away won't mean an automatic kick; the leaders decide.` : `Welcome back${other ? `, ${name}` : ''}! Away cleared.`));
    }
    case 'links': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      const ms = (await env.DB.prepare('SELECT tag, name FROM members WHERE clan = ? AND in_clan = 1').bind(clan).all()).results;
      const linked = new Map((await env.DB.prepare('SELECT tag, user_id FROM discord_links WHERE guild = ?').bind(guild).all()).results.map(r => [r.tag, r.user_id]));
      const yes = ms.filter(m => linked.has(m.tag)), no = ms.filter(m => !linked.has(m.tag));
      const text = `**Linked: ${yes.length} of ${ms.length}**\n${yes.map(m => `${cleanName(m.name)} → <@${linked.get(m.tag)}>`).join('\n') || '–'}\n\n**Not linked yet:** ${no.map(m => cleanName(m.name)).join(', ') || 'nobody'}`;
      return Response.json(reply(text.slice(0, 1990)));
    }
    case 'setup': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      const next = { clan, channels: channelsOf(cfg), roles: await findRoles(env, guild, opt, cfg) };
      await setConfig(env, guild, next);
      return Response.json(reply((await overview(env, guild, next)) + (Object.values(next.roles).some(Boolean) ? '\n\nRun `/setup sync` once to update everyone\'s roles now.' : '\n\nNo roles found: name them Member, Elder, Co-Leader, Leader, or pick them in `/setup show`.')));
    }
    case 'post-here': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      const ch = i.channel_id || i.channel?.id, what = opt.what;
      const next = { clan, channels: channelsOf(cfg), roles: cfg?.roles || await findRoles(env, guild, {}, cfg) };
      if (what === 'rules' || what === 'welcome' || what === 'stats') {
        const text = what === 'rules' ? rulesText(await clanRules(env, clan)) : what === 'stats' ? await statsBoard(env, clan) : WELCOME;
        const err = await upsert(env, `discord:${what}:${guild}`, ch, text).then(() => '', e => e.message);
        if (err) return Response.json(reply(cantPost(ch, err)));
        return Response.json(reply(`Posted. Long-press it → **Pin**. I'll keep it up to date${what === 'rules' ? ' when the rules change on the site' : what === 'stats' ? ' after every war' : ''}.`));
      }
      if (what === 'none') {
        for (const k of Object.keys(next.channels)) if (next.channels[k] === ch) delete next.channels[k];
        await setConfig(env, guild, next);
        return Response.json(reply('I won\'t post war messages here any more.\n\n' + await overview(env, guild, next)));
      }
      if (!JOBS[what]) return Response.json(reply('Unknown choice'));
      // Test post (proves the bot may post here), then removed so the channel stays tidy.
      const err = await dapi(env, 'POST', `/channels/${ch}/messages`, { content: `War Audit will post **${JOBS[what].toLowerCase()}** here.`, allowed_mentions: { parse: [] } })
        .then(m => { if (m?.id) later(dapi(env, 'DELETE', `/channels/${ch}/messages/${m.id}`)); return ''; }, e => e.message);
      if (err) return Response.json(reply(cantPost(ch, err) + ' Nothing was changed.'));
      next.channels[what] = ch;
      await setConfig(env, guild, next);
      return Response.json(reply('Done.\n\n' + await overview(env, guild, next)));
    }
    case 'player': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      let tag = cleanTag(opt.tag);
      if (!tag && opt.user) tag = (await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, opt.user).first())?.tag;
      if (!tag || !TAG.test(tag)) return Response.json(reply('Give a player tag (e.g. #ABC123) or a linked member.'));
      return Response.json(reply(await playerCard(env, clan, tag)));
    }
    case 'check': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      const tag = cleanTag(opt.tag);
      if (!TAG.test(tag)) return Response.json(reply('That doesn\'t look like a player tag, e.g. #ABC123.'));
      later((async () => {
        const msg = await recruitCard(env, clan, tag).catch(e => /404/.test(String(e.message)) ? `#${tag}: player not found.` : `Couldn't check #${tag} right now.`);
        await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { content: msg, allowed_mentions: { parse: [] } });
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'season': {
      let sid = Number(opt.number) || 0;
      if (!sid) { const w = await env.DB.prepare('SELECT week FROM wars WHERE clan = ? ORDER BY ended_at DESC LIMIT 1').bind(clan).first(); sid = w ? Number(String(w.week).split('-')[0]) : 0; }
      const text = sid && await seasonRecap(env, clan, sid);
      return Response.json(reply(text || `No wars saved for season ${sid || '?'}.`, !(text && opt.share)));
    }
    case 'scout': {
      later((async () => {
        const t = encodeURIComponent('#' + clan);
        const race = await cr(env, `/clans/${t}/currentriverrace`).catch(() => null);
        const rivals = (race?.clans || []).map(c => ({ tag: String(c.tag).replace('#', ''), name: c.name, score: c.clanScore || 0 }));
        const week = (await env.DB.prepare('SELECT week FROM periods WHERE clan = ? ORDER BY first_seen DESC LIMIT 1').bind(clan).first())?.week || '';
        const msg = await scoutRivals(env, clan, week, rivals).catch(() => null);
        await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { content: msg || 'No race found right now.', allowed_mentions: { parse: [] } });
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'digest': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      if (!opt.on) { await env.DB.prepare('DELETE FROM discord_digest WHERE guild = ? AND user_id = ?').bind(guild, user).run(); return Response.json(reply('Private copy off. The digest still posts in the leaders\' channel.')); }
      const dm = (await dapi(env, 'POST', '/users/@me/channels', { recipient_id: user }).catch(() => null))?.id;
      const ok = dm && await dapi(env, 'POST', `/channels/${dm}/messages`, { content: '🗞️ Private copy of the weekly digest on: you\'ll also get it here on the last training day, before battle days. Stop with `/leader digest on:False`.' }).then(() => true, () => false);
      if (!ok) return Response.json(reply('I can\'t send you private messages. Long-press the server icon → **Privacy settings** → turn on **Direct Messages**, then try again.'));
      await env.DB.prepare('INSERT OR REPLACE INTO discord_digest (guild, user_id, dm) VALUES (?, ?, ?)').bind(guild, user, dm).run();
      return Response.json(reply('Done: the digest still posts in the leaders\' channel, and you\'ll also get a private copy. I\'ve sent a test message.'));
    }
    case 'backup': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      if (!chan(cfg, 'leaders')) return Response.json(reply('Choose the leaders\' channel first: go to it and run `/setup channel` → **Leaders only**.'));
      later((async () => {
        const n2 = await postBackup(env, clan, guild).catch(e => `error: ${String(e.message || e).slice(0, 80)}`);
        await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { content: n2 === 1 ? `Backup posted in <#${chan(cfg, 'leaders')}>.` : `Couldn't post the backup (${n2}).` });
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'autosetup': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      later((async () => {
        const msg = await autoSetup(env, guild, cfg, clan, !!opt.apply, !!opt.fresh).catch(e => ({ content: `Something went wrong: ${String(e.message || e).slice(0, 150)}` }));
        await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { ...msg, content: msg.content.slice(0, 1990), allowed_mentions: { parse: [] } });
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'whosees': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      later((async () => {
        const msg = await whoSees(env, guild, cfg).catch(e => `Couldn't read the server: ${String(e.message || e).slice(0, 120)}`);
        await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { content: msg.slice(0, 1990), allowed_mentions: { parse: [] } });
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'refresh': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      later((async () => {
        const msg = await refreshAll(env, guild, cfg, clan, !!opt.clean).catch(e => ({ content: `Something went wrong: ${String(e.message || e).slice(0, 100)}`, components: [] }));
        await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { ...msg, content: msg.content.slice(0, 1990), allowed_mentions: { parse: [] } });
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'remove': {
      if (!isTopLeader(i.member, cfg)) return Response.json(reply('Only the clan Leader (or a server admin) can do this.'));
      const links = !!opt.links;
      return Response.json({ type: 4, data: { flags: EPHEMERAL, allowed_mentions: { parse: [] }, content: [
        '⚠️ **This deletes everything War Audit made in this server:**',
        `• its channels and categories (${SPECS.map(x => x.name).join(', ')}), with everything posted in them`,
        `• its roles (${ROLE_SPEC.map(r => r[1]).join(', ')})`,
        '• its saved server settings, so it stops posting here',
        links ? '• **everyone\'s linked accounts, reminders and DM settings**' : '• Linked accounts are **kept** (add `links:True` to delete them too).',
        '', 'The clan\'s war history and the website are not touched. You can build it all again with `/setup auto apply:True`.'].join('\n'),
        components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Delete everything', custom_id: 'remove|go|' + (links ? 1 : 0) }] }] } });
    }
    case 'pings': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      const next = { ...(cfg || { clan, channels: {}, roles: {} }) };
      if (opt.auto) delete next.pingHour; else if (opt.hour != null) next.pingHour = Math.max(0, Math.min(23, Number(opt.hour)));
      if (opt.last_call != null) next.lastCall = Math.max(0, Math.min(6, Number(opt.last_call)));
      await setConfig(env, guild, next);
      return Response.json(reply(await pingSummary(env, next, clan)));
    }
    case 'tidy': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      const days = Math.max(0, Math.min(60, Number(opt.days) || 0));
      await setConfig(env, guild, { ...(cfg || { clan, channels: {}, roles: {} }), tidyDays: days });
      const waiting = (await env.DB.prepare('SELECT count(*) AS n FROM discord_guests WHERE guild = ?').bind(guild).first())?.n || 0;
      return Response.json(reply(days ? `Done: people in the Not in clan waiting room get a heads-up after ${days - 1} day${days - 1 === 1 ? '' : 's'} and are removed after ${days} (they can rejoin with a new invite). Leaders are never removed. ${waiting} waiting now.` : 'Done: nobody is removed from the waiting room.'));
    }
    case 'sync': {
      if (!isLeader(i.member, cfg)) return Response.json(reply('Leaders only.'));
      later(syncGuild(env, guild, cfg, clan, 25));
      return Response.json(reply('Updating roles and nicknames for linked members (up to 25 at a time; run again for more).'));
    }
  }
  return Response.json(reply('Unknown command'));
}

const wkNum = k => { const [a, b] = String(k).split('-').map(Number); return a * 1000 + (b || 0); };
const ROLE_NAME = { member: 'Member', elder: 'Elder', coLeader: 'Co-leader', leader: 'Leader' };

// /player: what a leader needs at a glance about one member.
export async function playerCard(env, clan, tag) {
  const m = await readMember(env, clan, tag);
  if (!m) return `#${tag} has never been in the clan while it was tracked.`;
  const target = Number(m.rules?.target) || DEFAULT_RULES.target, lookback = Number(m.rules?.lookback) || 10;
  const weeks = m.weeks.slice().sort((a, b) => wkNum(b.week) - wkNum(a.week));
  const rel = reliability({ weeks }, target, lookback);
  const word = s => s >= 85 ? 'very reliable' : s >= 70 ? 'reliable' : s >= 55 ? 'hit and miss' : 'unreliable';
  const lines = [`**${cleanName(m.name)}** · ${ROLE_NAME[m.role] || 'Member'} · ${m.inClan ? 'in the clan' : 'not in the clan now'}`];
  if (rel) lines.push(`Reliability **${rel.score}/100** (${word(rel.score)}): ${Math.round(rel.hit * rel.wars)}/${rel.wars} wars at ${n(target)}+, ${Math.round(rel.deck * 100)}% of decks used, average ${n(rel.avg)}`);
  if (weeks.length) lines.push(`Recent wars (newest first): ${weeks.slice(0, 8).map(w => `${w.fame >= target ? '✅' : '❌'}${n(w.fame)}`).join(' ')}`);
  if (m.war?.day) { const d = m.war.days[m.war.days.length - 1]; if (d) lines.push(`This war, day ${m.war.day}: ${n(d.fame)} medals, ${Math.max(0, 4 - (d.day === m.war.day ? d.today : 0))} decks left today`); }
  const notes = (await env.DB.prepare("SELECT week, kind, value FROM notes WHERE clan = ? AND tag = ? AND kind IN ('away', 'result', 'done')").bind(clan, tag).all()).results;
  const away = notes.find(x => x.kind === 'away');
  if (away) { try { const a = JSON.parse(away.value); if (Date.parse(a.until) > Date.now() - 7 * 864e5) lines.push(`🏖️ Away ${ukDate(a.from)} to ${ukDate(a.until)}${a.reason ? `: ${a.reason}` : ''}`); } catch (e) {} }
  const warned = notes.filter(x => x.kind === 'result' && x.value === 'Warn' && notes.some(d => d.kind === 'done' && d.week === x.week && d.value === '1')).map(x => x.week).sort((a, b) => wkNum(b) - wkNum(a))[0];
  if (warned) lines.push(`⚠️ First & only warning posted in war ${warned}`);
  if (m.lastSeen) { const days = Math.floor((Date.now() - Date.parse(String(m.lastSeen).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/, '$1-$2-$3T$4:$5:$6Z'))) / 864e5); if (days >= 0) lines.push(`Last online: ${days < 1 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`); }
  return lines.join('\n').slice(0, 1990);
}

// War readiness: war uses 4 decks with no card repeated, so what matters is the best 32 cards. Levels shown as in game
// (the API's level is per rarity: game level = level + 16 - maxLevel, e.g. epic 11/11 = 16).
export function warReadiness(cards) {
  const lv = (cards || []).map(c => c.level + (16 - (c.maxLevel || 16))).sort((a, b) => b - a);
  if (lv.length < 32) return { text: `only ${lv.length} cards: can't make 4 war decks yet`, ok: false, avg: null };
  const top = lv.slice(0, 32), avg = top.reduce((t, x) => t + x, 0) / 32, at14 = top.filter(x => x >= 14).length;
  const word = avg >= 15 ? 'war-ready' : avg >= 14 ? 'decent' : avg >= 13 ? 'a bit low' : 'under-levelled';
  return { avg, at14, ok: avg >= 14, text: `best 32 cards average **level ${avg.toFixed(1)}** (${word}) · ${at14}/32 at level 14+` };
}

// /check: someone who wants to join. Public player data, their recent war battles, and any time they spent here.
export async function recruitCard(env, clan, tag) {
  const t = encodeURIComponent('#' + tag);
  const [pl, log] = await Promise.all([cr(env, `/players/${t}`), cr(env, `/players/${t}/battlelog`).catch(() => [])]);
  const wars = (Array.isArray(log) ? log : []).filter(b => /^riverRace|^boatBattle/.test(b.type || ''));
  let won = 0, lost = 0, boats = 0;
  for (const b of wars) {
    if (b.type === 'boatBattle') { boats++; continue; }
    const me = b.team?.[0] || {}, op = b.opponent?.[0] || {};
    if (me.rounds && op.rounds) me.rounds.forEach((x, k) => x.crowns > (op.rounds[k]?.crowns ?? 0) ? won++ : lost++);
    else me.crowns > op.crowns ? won++ : lost++;
  }
  const lastT = log?.[0]?.battleTime ? Date.parse(String(log[0].battleTime).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*/, '$1-$2-$3T$4:$5:$6Z')) : null;
  const ours = await env.DB.prepare('SELECT in_clan, first_seen FROM members WHERE clan = ? AND tag = ?').bind(clan, tag).first();
  const ourWars = (await env.DB.prepare('SELECT fame FROM war_players WHERE clan = ? AND tag = ?').bind(clan, tag).all()).results;
  const lines = [`🔎 **${cleanName(pl.name)}** (#${tag}) · level ${pl.expLevel}`,
    `Clan: ${pl.clan ? `${cleanName(pl.clan.name)} (${ROLE_NAME[pl.role] || 'Member'})` : 'none'}`,
    `Trophies: ${n(pl.trophies)} (best ${n(pl.bestTrophies)})`,
    `War day wins, all time: ${pl.warDayWins ?? '–'} · clan cards collected: ${n(pl.clanCardsCollected ?? 0)}`,
    `Donations, all time: ${n(pl.totalDonations ?? 0)}`,
    `⚔️ War readiness: ${warReadiness(pl.cards).text}`,
    `Recent war battles: ${wars.length ? `${won}W–${lost}L${boats ? `, ${boats} boat attack${boats === 1 ? '' : 's'}` : ''} (last 25 battles)` : 'none in the last 25 battles'}`,
    `Last battle: ${lastT ? ukDate(lastT) : '–'}`];
  if (ours) lines.push(`📒 **Been in this clan before**${ours.in_clan ? ' (in it now)' : ''}: ${ourWars.length} tracked war${ourWars.length === 1 ? '' : 's'}${ourWars.length ? `, average ${n(Math.round(ourWars.reduce((s2, w) => s2 + w.fame, 0) / ourWars.length))}` : ''}`);
  return lines.join('\n');
}

async function handleButton(i, env, ctx) {
  await setupDB(env);
  const [kind, week, status, how] = String(i.data?.custom_id || '').split('|');
  if (kind === 'verify') return checkProof(i, env, ctx);
  if (kind === 'apply') { const [, how, applicant, tag] = String(i.data?.custom_id).split('|'); return decideApplication(i, env, how, applicant, tag); }
  if (kind === 'refresh') {
    const cfg0 = await getConfig(env, i.guild_id);
    if (!isLeader(i.member, cfg0)) return Response.json(reply('Leaders only.'));
    const clan0 = cfg0?.clan || (env.ALLOWED_CLANS || '').split(',')[0]?.trim().toUpperCase().replace(/^#/, '');
    const work = (async () => {
      const msg = await refreshNext(env, i.guild_id, clan0).catch(e => ({ content: `Something went wrong: ${String(e.message || e).slice(0, 150)}`, components: [] }));
      await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { ...msg, content: msg.content.slice(0, 1990), allowed_mentions: { parse: [] } }).catch(() => null);
    })();
    if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
    return Response.json({ type: 6 });
  }
  if (kind === 'remove') {
    const cfg0 = await getConfig(env, i.guild_id);
    if (!isTopLeader(i.member, cfg0)) return Response.json(reply('Only the clan Leader (or a server admin) can do this.'));
    const work = (async () => {
      const msg = await removeAll(env, i.guild_id, cfg0, status === '1').catch(e => `Something went wrong: ${String(e.message || e).slice(0, 150)}. Run it again to finish.`);
      await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { content: msg.slice(0, 1990), components: [], allowed_mentions: { parse: [] } }).catch(() => null);
    })();
    if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
    return Response.json({ type: 6 });
  }
  if (kind === 'autosetup') {
    const cfg0 = await getConfig(env, i.guild_id);
    if (!isLeader(i.member, cfg0)) return Response.json(reply('Leaders only.'));
    const clan0 = cfg0?.clan || (env.ALLOWED_CLANS || '').split(',')[0]?.trim().toUpperCase().replace(/^#/, '');
    const work = (async () => {
      const msg = await autoSetupNext(env, i.guild_id, clan0).catch(e => ({ content: `Something went wrong: ${String(e.message || e).slice(0, 150)}`, components: [] }));
      await dapi(env, 'PATCH', `/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, { ...msg, content: msg.content.slice(0, 1990), allowed_mentions: { parse: [] } }).catch(() => null);
    })();
    if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
    return Response.json({ type: 6 });   // "working on it": the message is updated when the step finishes
  }
  return Response.json(reply('That button is no longer used. The after-war to-do list is on the website.'));
}

// Update roles/nicknames for linked users. `limit` keeps it within the Worker's per-run request budget.
export async function syncGuild(env, guild, cfg, clan, limit = 10, onlyTags = null) {
  if (!cfg?.roles) return 0;
  const links = (await env.DB.prepare('SELECT user_id, tag FROM discord_links WHERE guild = ?').bind(guild).all()).results.filter(l => !onlyTags || onlyTags.includes(l.tag));
  let n = 0;
  for (const l of links.slice(0, limit)) {
    const m = await env.DB.prepare('SELECT tag, name, role, in_clan FROM members WHERE clan = ? AND tag = ?').bind(clan, l.tag).first();
    await syncOne(env, guild, cfg, l.user_id, m); n++;
  }
  return n;
}

// Post to every configured server for this clan. `pings`: [{ tag, text }] mention linked users, plain names otherwise.
export async function discordPost(env, clan, title, body, pings = [], job = 'war') {
  if (!discordReady(env)) return 0;
  await setupDB(env);
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan && chan(c, job))) if (await postPings(env, cfg, title, body, pings, job)) sent++;
  return sent;
}

// One server: title, body, and a list where linked members are mentioned (people with /remind on get their DM instead).
async function pingContent(env, cfg, title, body, pings = []) {
  const links = new Map((await env.DB.prepare('SELECT tag, user_id FROM discord_links WHERE guild = ?').bind(cfg.guild).all()).results.map(r => [r.tag, r.user_id]));
  const dmed = pings.length ? new Set((await env.DB.prepare('SELECT user_id FROM discord_reminders WHERE guild = ? AND hours > 0').bind(cfg.guild).all()).results.map(r => r.user_id)) : new Set();
  const users = [], parts = pings.map(p => {
    const u = links.get(p.tag);
    if (u && !dmed.has(u)) { users.push(u); return `<@${u}> ${p.text}`; }
    return `${cleanName(p.name)} ${p.text}${u && dmed.has(u) ? ' 📩' : ''}`;
  });
  if (parts.some(x => x.endsWith('📩'))) parts.push('📩 = reminded by DM');
  const content = [`**${title}**`, body, parts.length ? parts.map(x => '• ' + x).join('\n') : ''].filter(Boolean).join('\n').slice(0, 1990);
  return { content, allowed_mentions: { parse: [], users: users.slice(0, 100) } };
}
async function postPings(env, cfg, title, body, pings = [], job = 'war') {
  return dapi(env, 'POST', `/channels/${chan(cfg, job)}/messages`, await pingContent(env, cfg, title, body, pings)).then(m => m?.id || true, () => false);
}

// ---- Battle-day pings at times people can act on ----
// Evening nudge: cfg.pingHour (UK), or the start of the clan's busiest 3 hours (from when decks were played), else 19:00.
// Last call: cfg.lastCall hours before the reset (default 2; 0 = off). Each once per battle day per server.
const ukHourOf = t => +new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }) % 24;
export function nextUkHour(from, hour) {   // first whole UK hour == `hour` at or after `from`
  let t = Math.ceil(from / 3600e3) * 3600e3;
  for (let k = 0; k < 26; k++, t += 3600e3) if (ukHourOf(t) === hour) return t;
  return null;
}
export async function busiestHour(env, clan) {
  const rows = (await env.DB.prepare("SELECT CAST(strftime('%H', at) AS INTEGER) AS h, count(*) AS c FROM race_events WHERE clan = ? AND at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-35 days') GROUP BY h").bind(clan).all().catch(() => ({ results: [] }))).results;
  const total = rows.reduce((t, x) => t + x.c, 0);
  if (total < 30) return null;
  const off = (ukHourOf(Date.now()) - new Date().getUTCHours() + 24) % 24, hc = Array(24).fill(0);
  for (const x of rows) hc[(x.h + off) % 24] += x.c;
  let best = 19, top = -1;
  for (let h = 12; h <= 21; h++) { const c = hc[h] + hc[h + 1] + hc[h + 2]; if (c > top) { top = c; best = h; } }   // afternoons and evenings only
  return best;
}
export function pingPlan(cfg, auto) {
  return { hour: cfg?.pingHour ?? auto ?? 19, lastCall: cfg?.lastCall ?? 2, autoHour: cfg?.pingHour == null };
}
export async function battleDayPings(env, r, now, msLeft) {
  const dayStart = now - (864e5 - msLeft), dayEnd = dayStart + 864e5, out = { evening: false, lastCall: false, sent: 0 };
  const auto = env.DB ? await busiestHour(env, r.clan) : null;
  const due = plan => {
    const eveAt = nextUkHour(dayStart, plan.hour), lastAt = plan.lastCall ? dayEnd - plan.lastCall * 3600e3 : null;
    return { evening: eveAt != null && now >= eveAt && (!lastAt || eveAt < lastAt), lastCall: !!lastAt && now >= lastAt };
  };
  Object.assign(out, due(pingPlan(null, auto)));   // for the leaders' phone alerts
  if (!discordReady(env) || !r.leftToday) return out;
  await setupDB(env);
  const list = r.leftToday.map(p => ({ tag: p.tag, name: p.name, text: `(${p.left} left)` }));
  // One decks-left message per server, kept current: a ping posts it new (that's what notifies people; the last call
  // deletes the evening one and posts again), and every run in between edits the list as people play (edits don't
  // notify). The next day's first ping replaces the day before's.
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === r.clan && chan(c, 'war'))) {
    const d = due(pingPlan(cfg, auto)), mk = `pingmsg:${cfg.guild}`;
    const saved = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(mk).first().then(x => x && JSON.parse(x.v)).catch(() => null);
    const stake = raceStake(r.board, r.clan), body = `${stake ? stake + '\n' : ''}${r.decksLeft} decks left:`;
    let posted = false;
    for (const [kind, on] of [['eve', d.evening], ['last', d.lastCall]]) {
      if (!on || !list.length) continue;
      const key = `ping:${cfg.guild}:${r.week}:${r.day}:${kind}`;
      if (await env.DB.prepare('SELECT 1 FROM kv WHERE k = ?').bind(key).first()) continue;
      await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(key, String(now)).run();
      const h = Math.max(1, Math.round(msLeft / 3600e3));
      const title = kind === 'eve' ? `⚔️ Battle day ${r.day}: decks still to play${r.board?.reset ? ` (resets ${r.board.reset} UK)` : ''}` : `⏰ Last call: battle day ${r.day} ends in about ${h} hour${h === 1 ? '' : 's'}`;
      if (saved?.id) await dapi(env, 'DELETE', `/channels/${saved.channel}/messages/${saved.id}`).catch(() => {});
      const id = await postPings(env, cfg, title, body, list);
      if (id) { out.sent++; posted = true; await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(mk, JSON.stringify({ channel: chan(cfg, 'war'), id: id === true ? null : id, week: r.week, day: r.day, title })).run(); }
      break;   // one post per run
    }
    if (posted || !saved?.id) continue;
    if (saved.week !== r.week || saved.day !== r.day) {   // a new battle day: yesterday's list is out of date (the summary is in results)
      await dapi(env, 'DELETE', `/channels/${saved.channel}/messages/${saved.id}`).catch(() => {});
      await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind(mk).run();
      continue;
    }
    const msg = list.length ? await pingContent(env, cfg, saved.title, body, list) : { content: `**${saved.title}**\n✅ Everyone has played all 4 decks today.`, allowed_mentions: { parse: [] } };
    await dapi(env, 'PATCH', `/channels/${saved.channel}/messages/${saved.id}`, msg).catch(() => {});
  }
  return out;
}

async function pingSummary(env, cfg, clan) {
  const auto = await busiestHour(env, clan), plan = pingPlan(cfg, auto);
  const resetRow = await env.DB.prepare('SELECT ended_at FROM wars WHERE clan = ? AND ended_at != \'\' ORDER BY ended_at DESC LIMIT 1').bind(clan).first();
  const m = String(resetRow?.ended_at || '').match(/T(\d\d):?(\d\d)/), now = new Date();
  const reset = m ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +m[1], +m[2]) : null;
  const uk = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  return [`**Battle-day pings** (people with decks left, in the war channel; people with \`/remind\` get their DM instead)`,
    `• Evening: **${String(plan.hour).padStart(2, '0')}:00 UK**${plan.autoHour ? (auto != null ? ' (auto: start of the clan\'s busiest hours)' : ' (auto: 19:00 until there\'s enough battle-day data)') : ''}`,
    `• Last call: ${plan.lastCall ? `**${plan.lastCall} hour${plan.lastCall === 1 ? '' : 's'} before reset**${reset ? ` (${uk(reset - plan.lastCall * 3600e3)} UK)` : ''}` : 'off'}`,
    `Change: \`/setup pings hour:20\` · \`/setup pings auto:True\` · \`/setup pings last_call:0\``].join('\n');
}

// Private reminders for members who asked (/remind): once per battle day, when the time left drops under
// their chosen hours and they still have decks to play. At most 8 per run (Worker request limit); the rest go 15 minutes later.
export async function dmReminders(env, clan, week, day, msLeft, leftToday, resetLabel = '') {
  if (!discordReady(env) || !leftToday?.length) return 0;
  await setupDB(env);
  const left = new Map(leftToday.map(p => [p.tag, p.left]));
  const rows = (await env.DB.prepare('SELECT r.guild, r.user_id, r.hours, r.dm, l.tag FROM discord_reminders r JOIN discord_links l ON l.guild = r.guild AND l.user_id = r.user_id WHERE l.clan = ? AND r.hours > 0').bind(clan).all()).results;
  const due = rows.filter(x => left.has(x.tag) && msLeft <= x.hours * 3600e3);
  if (!due.length) return 0;
  const done = new Set((await env.DB.prepare('SELECT k FROM kv WHERE k LIKE ?').bind(`dm:${clan}:${week}:${day}:%`).all()).results.map(x => x.k));
  const h = msLeft / 3600e3, when = h < 1 ? 'in under an hour' : `in about ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  let sent = 0, tried = 0;
  for (const x of due) {
    const key = `dm:${clan}:${week}:${day}:${x.user_id}`;
    if (done.has(key)) continue;
    if (tried++ >= 8) break;   // attempts, not successes: failed DMs still use the run's request budget
    await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(key, '1').run();   // once, even if it fails
    const n2 = left.get(x.tag);
    const content = `⏰ Battle day ${day} ends ${when}${resetLabel ? ` (${resetLabel} UK)` : ''}. You still have **${n2} deck${n2 === 1 ? '' : 's'}** to play: each one is worth at least 100 medals, win or lose.\n_Stop these with \`/remind 0\`._`;
    if (await dapi(env, 'POST', `/channels/${x.dm}/messages`, { content }).then(() => true, () => false)) sent++;
  }
  return sent;
}

// After a pull: keep roles/nicknames in step for anyone whose role changed or who joined/left.
export async function discordAfterSnapshot(env, clan, changedTags) {
  if (!discordReady(env) || !changedTags.length) return;
  await setupDB(env);
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan)) await syncGuild(env, cfg.guild, cfg, clan, 10, changedTags);
}

// ---------------------------------------------------------------------------
// Messages the bot keeps up to date by editing them: the live war board, battle-day summaries, and the rules.

const n = x => Number(x).toLocaleString('en-GB');
const ukClock = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
const ukDate = t => new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
// Post to one server's channel for a job (if it has one). Mentions nobody.
async function postJob(env, guild, cfg, job, content, extra = {}) {
  const ch = chan(cfg, job);
  if (!ch) return null;
  return dapi(env, 'POST', `/channels/${ch}/messages`, { content: content.slice(0, 1990), allowed_mentions: { parse: [] }, ...extra });
}
// Text bar, e.g. ███████░░░ for 0.7 (reads well on phones, no images needed).
export const bar = (f, w = 10) => { const k = Math.max(0, Math.min(w, Math.round(f * w))); return '█'.repeat(k) + '░'.repeat(w - k); };
const place = i => ['1st', '2nd', '3rd', '4th', '5th'][i] || `${i + 1}th`;

async function clanRules(env, clan) {
  const row = await env.DB.prepare("SELECT value FROM notes WHERE clan = ? AND kind = 'rules' AND week = '*' AND tag = '*'").bind(clan).first();
  let saved = {}; try { saved = JSON.parse(row?.value || '{}'); } catch (e) {}
  return sanitizeRules(saved).rules;   // same checks and defaults as the site and the bot's decisions
}

export function rulesText(r) {
  return [
    `📜 **Clan war rules**`,
    `🎯 **${n(r.target)}+ medals every war.** 4 battle days × 4 decks. Every battle earns medals, win or lose: lose all 16 and you still get 1,600, so 2 wins is enough if you play every deck.`,
    `📅 **Joined mid-war?** ${n(r.perDay)} per battle day left after the day you joined (day 1 = ${n(r.perDay * 3)}, day 2 = ${n(r.perDay * 2)}, day 3 = ${n(r.perDay)}). Joined on day 4: excused.${r.effortNet ? ' Played every deck you could? You pass either way.' : ''}`,
    `⚠️ **Miss once:** a first & only warning. It stays until you reach ${n(r.target)}+ ${r.warnClear} wars in a row. **Miss again before then:** kicked${r.demoteElders ? ' (Elders demoted)' : ''}. Two misses in a row is also a kick.`,
    `⚔️ **Duels pay most** (250 a game won), then 1v1 (200), boats least (125).${r.spareBoats ? ` Mostly on boats and under? Warning plus a tip${r.boatRepeatKick ? '; still under on boats next war: kick' : ''}.` : ''}`,
    `💬 **Going away?** Use \`/away\` (or tell a leader). Regulars (${r.holdWeeks}+ wars in a row at target) who go quiet ${r.holdOffline}+ days get a check-in, not a kick.`,
    `⭐ **Elder:** ${r.promoWeeks}+ wars in the clan, at most ${r.promoMisses} miss, average ${n(r.promoAvg)}+.`,
    `_Kept up to date automatically when the rules change. War Audit is unofficial and not endorsed by Supercell (Fan Content Policy: supercell.com/en/fan-content-policy)._`,
  ].join('\n\n');
}

// Edit a remembered message, or post a new one if it's gone. Remembers the message id under `key`.
export const WELCOME = `**👋 Welcome! Link your Clash Royale account to see the rest of the server.**

**1.** Type \`/link\` and tap the one from **War Audit**.
**2.** Enter your player tag: in Clash Royale, tap your name; it's the code starting with **#** (e.g. \`#ABC123\`).
**3.** It asks you to play one battle with 2 of your cards in your deck (proof it's your account; a friendly battle counts). Then tap **Done: check it**, and your clan role and nickname are set.

Not in the clan yet? Use \`/apply #YOURTAG\`, or join in game first, then link. Stuck? Ask a leader.
_What we keep and how to delete it: \`/privacy\`_`;

// Plain-language reason when Discord refuses a post.
function cantPost(channel, err) {
  const code = (String(err).match(/: (\d{3})$/) || [])[1];
  if (code === '403') return `I can't post in <#${channel}>: I'm missing permission there. Open that channel's settings → Permissions → add the **War Audit** role (or member) and allow **View Channel**, **Send Messages**, **Embed Links** and **Read Message History**.`;
  if (code === '404') return `I can't see <#${channel}>. Add the **War Audit** role to that channel's permissions with **View Channel** allowed.`;
  return `Discord refused the post in <#${channel}> (${code || 'error'}). Try again in a minute.`;
}

async function upsert(env, key, channel, content) {
  const saved = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  const body = typeof content === 'string' ? { content: content.slice(0, 1990), allowed_mentions: { parse: [] } } : content;
  const old = saved ? JSON.parse(saved.v) : null;
  if (old && old.channel !== channel && old.id) await dapi(env, 'DELETE', `/channels/${old.channel}/messages/${old.id}`).catch(() => null);   // moved: remove the old copy
  if (old && old.channel === channel && old.id) {   // same channel: edit; a new channel (or no message yet) gets a new message
    const { channel: ch, id } = JSON.parse(saved.v);
    const ok = await dapi(env, 'PATCH', `/channels/${ch}/messages/${id}`, body).then(() => true).catch(() => false);
    if (ok) return id;
  }
  const m = await dapi(env, 'POST', `/channels/${channel}/messages`, body);
  if (m?.id) await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(key, JSON.stringify({ channel, id: m.id })).run();
  return m?.id;
}

// The race part of the board (see raceOutlook in logic.js): race points if today ended now, today's medal place and
// what passing the next clan is worth, the projection on recent form, and a table.
export function raceLines(b, clan) {
  const st = b.standings || [], i = st.findIndex(c => c.tag === clan), me = st[i];
  if (!me || st.length < 2) return [];
  const name = c => cleanName(c.name).slice(0, 16), out = [];
  if (b.colosseum) {
    out.push(`🏛️ Colosseum: total medals decide it · **${place(i)}** of ${st.length}, ${n(me.medals)}${i > 0 ? ` · ${n(st[i - 1].medals - me.medals)} behind ${name(st[i - 1])}` : ` · ${n(me.medals - st[1].medals)} ahead`}`);
  } else {
    out.push(`🏁 Race: **${place(i)}** of ${st.length} · ${n(me.ifNow)} race points${b.started ? ' if today ended now' : ''}${i > 0 ? ` · ${n(st[i - 1].ifNow - me.ifNow)} behind ${name(st[i - 1])}` : ` · ${n(me.ifNow - st[1].ifNow)} ahead`}`);
    if (b.started) {
      const k = me.place, up = st.find(c => c.tag === me.next), down = st.filter(c => c.today < me.today).sort((a, c) => c.today - a.today)[0];
      out.push(`📅 Today: **${place(k)}** on medals (${n(me.today)}) = +${n(RANK_POINTS[k])}`
        + (up ? ` · ${n(up.today - me.today + 1)} more medals to pass ${name(up)} = **+${n(RANK_POINTS[up.place] - RANK_POINTS[k])}**` : '')
        + (down ? ` · ${name(down)} ${n(me.today - down.today)} behind` : ''));
    }
  }
  const pr = st.slice().sort((a, c) => c.projected - a.projected), k = pr.indexOf(me);
  if (st.some(c => c.avgMedals != null)) out.push(`📈 On recent form: **${place(k)}** (~${n(me.projected)})${k > 0 ? ` · ${name(pr[0])} ~${n(pr[0].projected)}` : ` · next ${name(pr[1])} ~${n(pr[1].projected)}`}`);
  const top = Math.max(1, ...st.map(c => b.colosseum ? c.medals : c.ifNow));
  out.push('```\n' + (b.colosseum ? '' : '    race pts  medals today\n') + st.map((c, j) => `${j + 1}. ${bar((b.colosseum ? c.medals : c.ifNow) / top, 6)} ${n(b.colosseum ? c.medals : c.ifNow).padStart(6)}${b.colosseum ? '' : n(c.today).padStart(8)}  ${name(c)}${c.tag === clan ? ' ◀' : ''}`).join('\n') + '\n```');
  return out;
}

// One line for pings: where today's medals put us and what the next place is worth (normal weeks only).
export function raceStake(b, clan) {
  const st = b?.standings || [], me = st.find(c => c.tag === clan);
  if (!me || b.colosseum || !b.started || me.place == null) return '';
  const up = st.find(c => c.tag === me.next);
  return `📅 We're **${place(me.place)}** on medals today (+${n(RANK_POINTS[me.place])} race points).`
    + (up ? ` **${n(up.today - me.today + 1)}** more passes ${cleanName(up.name)}: **+${n(RANK_POINTS[up.place] - RANK_POINTS[me.place])}**.` : ' Keep it!');
}

// The live war board: one message per war, edited after every pull on battle days.
export async function warBoard(env, r, now) {
  if (!discordReady(env) || !r.day || !r.week || !r.board) return 0;
  await setupDB(env);
  const b = r.board, pct = b.decksTotal ? Math.round(100 * b.decksUsed / b.decksTotal) : 0;
  const content = [`⚔️ **War ${r.week} · battle day ${r.day} of 4**`, ...raceLines(b, r.clan),
    `🎯 ${bar(b.members ? b.reached / b.members : 0)} ${b.reached} of ${b.members} have reached ${n(r.target)}`,
    `🃏 ${bar(pct / 100)} Decks today: ${b.decksUsed}/${b.decksTotal} (${pct}%)${b.reset ? ` · resets ${b.reset} UK` : ''}`,
    b.warDecksSoFar && r.day > 1 ? `🗓️ This war: ${b.warDecks}/${b.warDecksSoFar} decks so far (${b.warDecksSoFar - b.warDecks} unused)` : '',
    b.notPlayed.length ? `⏳ Not played today: ${b.notPlayed.slice(0, 20).map(cleanName).join(', ')}${b.notPlayed.length > 20 ? ` +${b.notPlayed.length - 20} more` : ''}` : '✅ Everyone has played today',
    `_Updated ${ukClock(now)} UK_`,
  ].filter(Boolean).join('\n');
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === r.clan && chan(c, 'war'))) {
    if (await upsert(env, `discord:board:${cfg.guild}:${r.week}`, chan(cfg, 'war'), content).catch(() => null)) sent++;
  }
  return sent;
}

// Summary of a finished battle day (posted once): medals gained and the change vs the day before,
// decks used, place, and the day's top scorers. day = the battle day that just ended (1–4).
export async function daySummary(env, clan, week, day) {
  if (!discordReady(env) || day < 1 || day > 4) return 0;
  await setupDB(env);
  const once = `dsum:${clan}:${week}:${day}`;
  if (await env.DB.prepare('SELECT 1 FROM kv WHERE k = ?').bind(once).first()) return 0;
  const rows = d => env.DB.prepare('SELECT tag, name, fame, today FROM race_days WHERE clan = ? AND week = ? AND day = ?').bind(clan, week, d).all().then(x => x.results);
  const stand = d => env.DB.prepare('SELECT rival, name, fame, medals FROM race_standings WHERE clan = ? AND week = ? AND day = ?').bind(clan, week, d).all().then(x => x.results);
  const [all, before, st, stBefore] = await Promise.all([rows(day), rows(day - 1), stand(day), stand(day - 1)]);
  if (!all.length) return 0;
  // Joined after this battle day started (seen joining after the day's period was first seen): not counted as missed.
  const dayStart = (await env.DB.prepare("SELECT first_seen FROM periods WHERE clan = ? AND week = ? AND type != 'training' ORDER BY period LIMIT 1 OFFSET ?").bind(clan, week, day - 1).first())?.first_seen;
  const lateJoin = new Set(dayStart ? (await env.DB.prepare("SELECT tag FROM member_events WHERE clan = ? AND kind = 'join' AND at > ?").bind(clan, dayStart).all()).results.map(x => x.tag) : []);
  const today = all.filter(p => !lateJoin.has(p.tag));
  const prevFame = Object.fromEntries(before.map(p => [p.tag, p.fame]));
  const gains = today.map(p => ({ name: p.name, gain: p.fame - (prevFame[p.tag] || 0) })).sort((a, b) => b.gain - a.gain);
  const used = today.reduce((t, p) => t + Math.min(4, p.today), 0), total = today.length * 4;
  // Standings rows: fame = race points at the end of the day (colosseum: medals), medals = that day's medals.
  const ours = rs => rs.find(x => x.rival === clan), me = ours(st);
  const gain = me?.medals ?? gains.reduce((t, x) => t + x.gain, 0), prevGain = day > 1 ? ours(stBefore)?.medals : null;
  const change = prevGain ? Math.round(100 * (gain - prevGain) / prevGain) : null;
  const colosseum = st.length > 0 && st.every(x => x.medals != null && x.fame >= x.medals) && st.some(x => x.fame > FINISH_POINTS);   // colosseum: points are medals
  const dayRank = st.slice().sort((a, b) => (b.medals || 0) - (a.medals || 0)).findIndex(x => x.rival === clan);
  const earned = me && !colosseum ? me.fame - (ours(stBefore)?.fame ?? 0) : null;
  const sorted = st.slice().sort((a, b) => b.fame - a.fame), i = sorted.findIndex(x => x.rival === clan);
  const content = [
    `📊 **Battle day ${day} summary · war ${week}**`,
    `Medals: **+${n(gain)}**${change != null ? ` (${change >= 0 ? '+' : ''}${change}% vs day ${day - 1})` : ''}${dayRank >= 0 && me?.medals != null ? ` · **${place(dayRank)}** of ${st.length} clans today` : ''}`,
    earned != null && earned > 0 ? `Race points: **+${n(earned)}** for the day` : '',
    `${bar(used / total)} Decks used: ${used}/${total} (${Math.round(100 * used / total)}%)`,
    i >= 0 ? `Race: **${place(i)}** of ${sorted.length}, ${n(sorted[i].fame)} ${colosseum ? 'medals' : 'race points'}${i > 0 ? `, ${n(sorted[i - 1].fame - sorted[i].fame)} behind ${cleanName(sorted[i - 1].name)}` : sorted[1] ? `, ${n(sorted[0].fame - sorted[1].fame)} ahead` : ''}` : '',
    `Top today: ${gains.slice(0, 3).map(x => `${cleanName(x.name)} +${n(x.gain)}`).join(', ')}`,
    (() => { const m = today.filter(p => p.today < 4).sort((a, b) => a.today - b.today || cleanName(a.name).localeCompare(cleanName(b.name)));
      return m.length ? `Missed decks: **${m.reduce((t, p) => t + 4 - p.today, 0)} unused** · ${m.slice(0, 25).map(p => `${cleanName(p.name)} ${4 - p.today}`).join(', ')}${m.length > 25 ? ` +${m.length - 25} more` : ''}` : '✅ No decks missed'; })(),
  ].filter(Boolean).join('\n');
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(once, '1').run();
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan && chan(c, 'results'))) {
    await dapi(env, 'POST', `/channels/${chan(cfg, 'results')}/messages`, { content, allowed_mentions: { parse: [] } }).then(() => sent++).catch(() => {});
  }
  return sent;
}

// After a war: the top 3, and streak milestones (every 5 wars in a row at the target) for current members.
export async function shoutOuts(env, clan, week, target) {
  if (!discordReady(env)) return 0;
  const rows = (await env.DB.prepare('SELECT w.week, w.tag, w.name, w.fame FROM war_players w JOIN members m ON m.clan = w.clan AND m.tag = w.tag AND m.in_clan = 1 WHERE w.clan = ?').bind(clan).all()).results;
  const num = k => { const [a, b] = String(k).split('-').map(Number); return a * 1000 + (b || 0); };
  const now = rows.filter(x => x.week === week && x.fame > 0).sort((a, b) => b.fame - a.fame);
  if (!now.length) return 0;
  const byTag = {};
  for (const x of rows) (byTag[x.tag] ||= []).push(x);
  const streaks = [];
  for (const p of now.filter(x => x.fame >= target)) {
    const ws = byTag[p.tag].filter(x => num(x.week) <= num(week)).sort((a, b) => num(b.week) - num(a.week));
    let n2 = 0; for (const x of ws) { if (x.fame >= target) n2++; else break; }
    if (n2 >= 5 && n2 % 5 === 0) streaks.push(`${cleanName(p.name)}: **${n2} wars in a row** at ${n(target)}+`);
  }
  const medal = ['🥇', '🥈', '🥉'];
  const body = [`${now.slice(0, 3).map((x, i) => `${medal[i]} ${cleanName(x.name)} ${n(x.fame)}`).join(' · ')}`,
    streaks.length ? `🔥 ${streaks.join('\n🔥 ')}` : ''].filter(Boolean).join('\n');
  return discordPost(env, clan, `🏆 War ${week} shout-outs`, body, [], 'joins');
}

// Post a message to one job's channel in every server set up for this clan.
export async function postToJob(env, clan, job, content, fallback = null) {
  if (!discordReady(env) || !content) return 0;
  await setupDB(env);
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan)) {
    const j = chan(cfg, job) ? job : fallback && chan(cfg, fallback) ? fallback : null;
    if (j && await postJob(env, cfg.guild, cfg, j, content).catch(() => null)) sent++;
  }
  return sent;
}

// The weekly digest: always in the leaders' channel, plus a private copy to leaders who asked (/leader digest).
export async function sendDigest(env, clan) {
  if (!discordReady(env)) return 0;
  await setupDB(env);
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan)) {
    const to = (await env.DB.prepare('SELECT dm FROM discord_digest WHERE guild = ?').bind(cfg.guild).all()).results;
    if (!to.length && !chan(cfg, 'leaders')) continue;
    const text = await leaderDigest(env, clan, cfg.guild);
    if (chan(cfg, 'leaders') && await postJob(env, cfg.guild, cfg, 'leaders', text).catch(() => null)) sent++;
    for (const x of to.slice(0, 10)) if (await dapi(env, 'POST', `/channels/${x.dm}/messages`, { content: text, allowed_mentions: { parse: [] } }).then(() => true, () => false)) sent++;
  }
  return sent;
}

// After a war: each member who asked (/warreport) gets their own result by DM. At most `max` per run; returns how many are left.
export async function sendWarReports(env, clan, max = 20) {
  if (!discordReady(env)) return 0;
  await setupDB(env);
  const war = await env.DB.prepare('SELECT week FROM wars WHERE clan = ? ORDER BY ended_at DESC LIMIT 1').bind(clan).first();
  if (!war) return 0;
  const subs = (await env.DB.prepare('SELECT r.guild, r.user_id, r.dm, l.tag FROM discord_warreport r JOIN discord_links l ON l.guild = r.guild AND l.user_id = r.user_id WHERE l.clan = ?').bind(clan).all()).results;
  const sent = new Set((await env.DB.prepare('SELECT k FROM kv WHERE k LIKE ?').bind(`wr:${clan}:${war.week}:%`).all()).results.map(x => x.k));
  const todo = subs.filter(x => !sent.has(`wr:${clan}:${war.week}:${x.guild}:${x.user_id}`));
  if (!todo.length) return 0;
  const r = await clanRules(env, clan), T = r.target;
  const all = (await env.DB.prepare('SELECT week, tag, fame, decks FROM war_players WHERE clan = ?').bind(clan).all()).results;
  const thisWar = all.filter(x => x.week === war.week && (x.decks > 0 || x.fame > 0)).sort((a, b) => b.fame - a.fame);
  for (const x of todo.slice(0, max)) {
    await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`wr:${clan}:${war.week}:${x.guild}:${x.user_id}`, '1').run();   // once, even if it fails
    await dapi(env, 'POST', `/channels/${x.dm}/messages`, { content: warReportText(x.tag, war.week, all, thisWar, T, r.lookback), allowed_mentions: { parse: [] } }).catch(() => null);
  }
  return Math.max(0, todo.length - max);
}

export function warReportText(tag, week, all, thisWar, T, lookback = 10) {
  const weeks = all.filter(x => x.tag === tag).map(x => ({ key: x.week, fame: x.fame, decks: x.decks })).sort((a, b) => wkNum(b.key) - wkNum(a.key));
  const me = weeks.find(w => w.key === week);
  const lines = [];
  if (!me || (!me.decks && !me.fame)) lines.push(`📬 **War ${week}:** you didn't play this one.`);
  else {
    const rank = thisWar.findIndex(x => x.tag === tag) + 1;
    lines.push(`📬 **Your war ${week}: ${n(me.fame)}** medals, ${me.decks}/16 battles ${me.fame >= T ? `✅ (target ${n(T)})` : `❌ (target ${n(T)}: ${n(T - me.fame)} short)`}`);
    if (rank) lines.push(`🏅 ${rank}${['st', 'nd', 'rd'][rank - 1] || 'th'} of ${thisWar.length} in the clan`);
  }
  let streak = 0; for (const w of weeks) { if (w.fame >= T) streak++; else break; }
  if (streak >= 2) lines.push(`🔥 ${streak} wars in a row at ${n(T)}+`);
  const before = weeks.filter(w => wkNum(w.key) < wkNum(week)), now = reliability({ weeks }, T, lookback), was = reliability({ weeks: before }, T, lookback);
  if (now) lines.push(`📈 Reliability ${was ? `${was.score} → ` : ''}**${now.score}**/100`);
  lines.push('_Stop these: `/warreport on:False`_');
  return lines.join('\n');
}

// Monthly backup: the full history as a file in each leaders' channel (Discord keeps it).
export async function postBackup(env, clan, onlyGuild = null, now = Date.now()) {
  if (!discordReady(env)) return 0;
  await setupDB(env);
  const cfgs = (await allConfigs(env)).filter(c => c.clan === clan && chan(c, 'leaders') && (!onlyGuild || c.guild === onlyGuild));
  if (!cfgs.length) return 0;
  const f = await backupFile(env, clan, now);
  if (f.size > 9.5 * 1024 * 1024) return 'too big for Discord (use the site\'s Download full history)';
  let sent = 0;
  for (const cfg of cfgs) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: `🗄️ **Backup** of the full history: ${f.summary}. Keep it safe (it's also on the site: Rules → Download full history).`, allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: f.name }] }));
    form.append('files[0]', new Blob([f.data], { type: 'application/gzip' }), f.name);
    const r = await fetch(`${API}/channels/${chan(cfg, 'leaders')}/messages`, { method: 'POST', headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN }, body: form });
    if (r.ok) sent++;
  }
  return sent;
}

// ---- /autosetup: the whole server, in steps (each step is one Worker run, within its 50-request limit) ----
//   Step 1: roles, categories, channels with permissions (reusing matching ones unless fresh)
//   Step 2: jobs, rules / how to link / stats (posted, pinned), server icon
//   Step 3: a pinned note in each channel, rival scouting
//   Step 4 (fresh only): delete the old channels
const P = { VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n, REACT: 1n << 6n, APPS: 1n << 31n,
  INVITE: 1n << 0n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, MANAGE_CHANNELS: 1n << 4n, MANAGE_GUILD: 1n << 5n, MANAGE_ROLES: 1n << 28n, MANAGE_NICK: 1n << 27n, ADMIN: 1n << 3n };
const bits = (...k) => String(k.reduce((t, x) => t | P[x], 0n));
const CHAT = bits('VIEW', 'SEND', 'HISTORY', 'REACT', 'EMBED', 'ATTACH', 'APPS'), READ = bits('VIEW', 'HISTORY', 'REACT', 'APPS');
const BOT = bits('VIEW', 'SEND', 'HISTORY', 'EMBED', 'ATTACH');
const ROLE_SPEC = [['leader', 'Leader', 0xe65157], ['coLeader', 'Co-Leader', 0xe2af4b], ['elder', 'Elder', 0x3b7dd8], ['member', 'Member', 0x95a5a6], ['guest', 'Not in clan', 0x5c5f66]];
// The layout. access: newcomers | public-read | members-read | members | leaders. jobs: what the bot posts there.
export const LAYOUT = [
  { cat: '👋 Start here', access: 'public', channels: [
    { key: 'link', name: '🔗-link-tag', access: 'newcomers', jobs: ['welcome'], match: /link/, topic: 'New here? Link your Clash Royale account to see the rest of the server.' },
    { key: 'guests', name: '🚪-not-in-clan', access: 'guests', jobs: ['guests'], match: /notinclan|guest|waiting/, topic: 'Not in the clan? /apply #YOURTAG to join, or /link again once you have. Ask the leaders here.' },
    { key: 'rules', name: '📜-rules', access: 'members-read', jobs: ['rules'], match: /rules/, topic: 'Clan rules, kept up to date by War Audit.' }] },
  { cat: '📊 Clan info', access: 'public', channels: [
    { key: 'stats', name: '📊-clan-stats', access: 'members-read', jobs: ['stats'], match: /stats/, topic: 'Clan stats, updated after every war.' },
    { key: 'results', name: '🏆-results', access: 'members-read', jobs: ['results'], match: /result/, topic: 'Battle day summaries, war results and season recaps.' },
    { key: 'scout', name: '🔭-rival-scouting', access: 'members-read', jobs: ['scout'], match: /scout|rival/, topic: 'Who we are racing each war, and how they usually do.' }] },
  { cat: '⚔️ Clan', access: 'members', channels: [
    { key: 'war', name: '⚔️-war', access: 'members', jobs: ['war'], match: /^war$|warboard|clanwar/, topic: 'War board, reminders and war chat.' },
    { key: 'general', name: '💬-general', access: 'members', jobs: ['joins'], match: /^(?!.*(leader|staff|mod|admin)).*(general|chat)/, topic: 'Clan chat. Welcomes and shout-outs from War Audit.' },
    { key: 'bot', name: '🤖-bot-commands', access: 'members', jobs: ['bot'], match: /bot|command/, topic: 'Use War Audit here: /mystats, /stats, /remind, /away, /season, /scout.' },
    { key: 'voice', name: '🔊 Clan voice', type: 2, access: 'members', jobs: [], match: /voice/ }] },
  { cat: '🛡️ Leaders', access: 'leaders', channels: [
    { key: 'leaders', name: '🛡️-leaders', access: 'leaders', jobs: ['leaders'], match: /leader|staff|mods?$/, topic: 'Leaders only: absences, digest, backups.' },
    { key: 'leaderchat', name: '💭-leader-chat', access: 'leaders', jobs: [], match: /leaderchat|staffchat/, topic: 'Leaders only.' }] },
];
const SPECS = LAYOUT.flatMap(c => c.channels);
const plain = n => String(n || '').toLowerCase().replace(/[^a-z]/g, '');

function overwritesFor(access, guild, roles, botId, voice = false) {
  const ow = (id, allow, deny = '0', type = 0) => id && { id, type, allow, deny };
  const all = ['leader', 'coLeader', 'elder', 'member'].map(k => roles[k]), lead = [roles.leader, roles.coLeader], rest = [roles.elder, roles.member];
  // The bot always keeps View on its channels (without it a hidden channel is invisible to the bot: it can't reuse, fix or delete it).
  const bot = ow(botId, voice ? bits('VIEW') : BOT, '0', 1), hide = ow(guild, '0', bits('VIEW'));
  const room = voice ? bits('VIEW') : CHAT;   // voice: connect and speak come from the server's defaults
  if (access === 'public') return [];
  if (access === 'newcomers') return [ow(guild, bits('VIEW', 'HISTORY', 'APPS'), bits('SEND')), ...[...rest, roles.guest].map(r => ow(r, '0', bits('VIEW'))), bot].filter(Boolean);
  if (access === 'guests') return [hide, ...[roles.guest, ...lead].map(r => ow(r, CHAT)), bot].filter(Boolean);
  if (access === 'public-read') return [ow(guild, READ, bits('SEND')), bot].filter(Boolean);
  if (access === 'members-read') return [hide, ...all.map(r => ow(r, READ, bits('SEND'))), bot].filter(Boolean);
  if (access === 'leaders') return [hide, ...lead.map(r => ow(r, room)), bot].filter(Boolean);
  return [hide, ...all.map(r => ow(r, room)), bot].filter(Boolean);
}

const INTROS = {
  war: `⚔️ **This channel:** the **war board** on battle days (updated every 15 minutes) and **pings** for anyone with decks left in a battle day's last 4 hours. Chat about the war here too.`,
  joins: `💬 **Clan chat.** War Audit posts a welcome when someone joins the clan in game, congrats on promotions, and shout-outs after each war.`,
  results: `🏆 **This channel:** a **battle day summary** after each daily reset, the **war result** when a war ends, and a **season recap** at the end of each season.`,
  scout: `🔭 **This channel:** when a new war starts, **who we're racing** and how they've done in their last 5 wars, against our own form.`,
  leaders: `🛡️ **Leaders only. War Audit posts here:** **absences** from \`/away\`, the **weekly digest** before battle days (a private copy too: \`/leader digest on:True\`) and a **monthly backup** of the full history.`,
  guests: `🚪 **Not in the clan right now.** The tag you linked isn't in the clan's member list. Want to join? Use \`/apply #YOURTAG\` and the leaders will look at your war record. Already joined in game? Use \`/link\` again. Questions? Ask a leader below. You're free to leave the server any time.`,
  bot: `🤖 **Use War Audit here:**\n\`/mystats\` your full war report · \`/clan stats\` clan stats · \`/remind 3\` a private reminder 3 hours before reset · \`/warreport on:True\` your result by DM after each war · \`/away 3 holiday\` tell the leaders you're away · \`/clan season\` season recap · \`/clan scout\` this war's rivals`,
};
const LABEL = { bot: 'note with the commands', guests: 'waiting room for tags not in the clan', welcome: 'how to link', rules: 'rules', stats: 'clan stats', results: 'summaries, results, season recaps', scout: 'rival scouting',
  war: 'war board + reminders', joins: 'welcomes + shout-outs', leaders: 'absences, digest, backups' };
const STEPS = fresh => fresh ? 4 : 3;
const nextButton = (step, of) => [{ type: 1, components: [{ type: 2, style: 1, label: `Continue ▶ (step ${step} of ${of})`, custom_id: 'autosetup|next' }] }];

async function serverState(env, guild) {
  const botId = env.DISCORD_APP_ID;
  const [roles, channels, me, info] = await Promise.all([dapi(env, 'GET', `/guilds/${guild}/roles`), dapi(env, 'GET', `/guilds/${guild}/channels`),
    dapi(env, 'GET', `/guilds/${guild}/members/${botId}`).catch(() => null), dapi(env, 'GET', `/guilds/${guild}`).catch(() => null)]);
  const mine = roles.filter(r => (me?.roles || []).includes(r.id) || r.id === guild);
  const perms = mine.reduce((t, r) => t | BigInt(r.permissions || '0'), 0n);
  const has = k => (perms & P.ADMIN) === P.ADMIN || (perms & P[k]) === P[k];
  const top = Math.max(0, ...roles.filter(r => (me?.roles || []).includes(r.id)).map(r => r.position));
  return { roles, channels, info, has, top, botId };
}

// Which existing channels are reused (not when fresh): ones already given a job, then by name.
async function reuse(env, guild, cfg, channels) {
  const found = {}, text = channels.filter(c => c.type === 0), voice = channels.filter(c => c.type === 2);
  const savedCh = async k => (await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first().then(r => r && JSON.parse(r.v).channel)) || null;
  const chosen = { leaders: chan(cfg, 'leaders'), link: await savedCh('discord:welcome:' + guild), rules: await savedCh('discord:rules:' + guild), stats: await savedCh('discord:stats:' + guild),
    results: cfg?.channels?.results !== cfg?.channels?.war ? chan(cfg, 'results') : null, scout: chan(cfg, 'scout'), war: chan(cfg, 'war'), general: chan(cfg, 'joins') };
  for (const [k, id] of Object.entries(chosen)) if (id && text.some(c => c.id === id) && !Object.values(found).includes(id)) found[k] = id;
  for (const k of SPECS.map(x => x.key).sort((a, b) => (a === 'leaderchat' ? -1 : b === 'leaderchat' ? 1 : a === 'leaders' ? -1 : b === 'leaders' ? 1 : 0))) {   // every layout channel; private ones first
    if (found[k]) continue;
    const spec = SPECS.find(x => x.key === k), pool = spec.type === 2 ? voice : text;
    const c = pool.find(x => spec.match.test(plain(x.name)) && !Object.values(found).includes(x.id));
    if (c) found[k] = c.id;
  }
  return found;
}

export async function autoSetup(env, guild, cfg, clan, apply, fresh = false) {
  await setupDB(env);
  const st = await serverState(env, guild), problems = [];
  if (!st.has('MANAGE_ROLES')) problems.push('Give **War Audit** the **Manage Roles** permission (Server Settings → Roles → War Audit).');
  if (!st.has('MANAGE_CHANNELS')) problems.push('Give **War Audit** the **Manage Channels** permission (Server Settings → Roles → War Audit).');
  const found = fresh ? {} : await reuse(env, guild, cfg, st.channels);
  const roleIds = {};
  for (const [k, name] of ROLE_SPEC) { const r = st.roles.find(x => plain(x.name) === plain(name)); if (r) roleIds[k] = r.id; }
  const above = ROLE_SPEC.filter(([k]) => roleIds[k] && st.roles.find(r => r.id === roleIds[k]).position >= st.top).map(r => r[1]);
  if (above.length) problems.push(`Drag **War Audit** above ${above.join(', ')} (Server Settings → Roles), so it can give ${above.length === 1 ? 'that role' : 'those roles'} and set nicknames. Discord doesn't let a bot move itself.`);
  const old = fresh ? st.channels.filter(c => !Object.values(found).includes(c.id)) : [];

  if (!apply) {
    const lines = [`**/setup auto${fresh ? ' fresh' : ''} would do this:**`];
    const missing = ROLE_SPEC.filter(([k]) => !roleIds[k]).map(r => r[1]);
    if (missing.length) lines.push(`➕ Roles: ${missing.join(', ')}`);
    for (const c of LAYOUT) lines.push(`**${c.cat}**`, ...c.channels.map(x => `${found[x.key] ? `🔧 <#${found[x.key]}>` : `➕ ${x.type === 2 ? '' : '#'}${x.name}`}${x.jobs.length ? ': ' + x.jobs.map(j => LABEL[j]).join(', ') : ''}`));
    lines.push('🎟️ Only Leader and Co-Leader can create invites.');
    lines.push('🚪 A tag that isn\'t in the clan (or a member who leaves in game) gets the **Not in clan** role: they see only #not-in-clan, where leaders can talk to them.');
    lines.push('🔒 Newcomers see **only** the link channel. Once linked, Members and Elders see rules, stats, results and scouting (read-only) and chat in war, general, bot-commands and voice; the link channel disappears for them. Leader and Co-Leader also see the Leaders category.');
    if (old.length) lines.push(`🗑️ **Deletes ${old.length} existing channel${old.length === 1 ? '' : 's'}** (last step): ${old.filter(c => c.type !== 4).slice(0, 15).map(c => c.name).join(', ')}${old.length > 15 ? '…' : ''}`);
    if (problems.length) lines.push(`\n**Fix first:**\n${problems.map(x => '• ' + x).join('\n')}`);
    lines.push(`\nRun \`/setup auto apply:True${fresh ? ' fresh:True' : ''}\` to do it, in ${STEPS(fresh)} steps (tap Continue between them).`);
    return { content: lines.join('\n') };
  }
  const blocking = problems.filter(x => /Manage (Roles|Channels)/.test(x));
  if (blocking.length) return { content: `**Can't start yet:**\n${blocking.map(x => '• ' + x).join('\n')}` };

  // Step 1: roles, categories, channels.
  const done = [];
  for (const [k, name, color] of ROLE_SPEC) if (!roleIds[k]) {
    const r = await dapi(env, 'POST', `/guilds/${guild}/roles`, { name, color, hoist: true, mentionable: false, permissions: '0' }).catch(() => null);
    if (r?.id) { roleIds[k] = r.id; done.push(`✅ Role ${name}`); } else done.push(`⚠️ Couldn't create role ${name}`);
  }
  for (const [k, , color] of ROLE_SPEC.filter(r => r[0] !== 'guest')) {   // ranks coloured, listed separately (only roles below the bot)
    const r = st.roles.find(x => x.id === roleIds[k]);
    if (r && r.position < st.top && (!r.hoist || !r.color)) await dapi(env, 'PATCH', `/guilds/${guild}/roles/${r.id}`, { color: r.color || color, hoist: true }).catch(() => null);
  }
  // Invites: only Leader and Co-Leader (taken off @everyone, given to those two roles).
  const everyone = st.roles.find(r => r.id === guild), inv = P.INVITE;
  let invitesOk = true;
  for (const k of ['leader', 'coLeader']) {   // first: the bot still has invite rights through @everyone
    const r = st.roles.find(x => x.id === roleIds[k]) || { id: roleIds[k], permissions: '0', position: 0 };
    if (r.id && !(BigInt(r.permissions || '0') & inv)) {
      const ok = r.position < st.top && await dapi(env, 'PATCH', `/guilds/${guild}/roles/${r.id}`, { permissions: String(BigInt(r.permissions || '0') | inv) }).then(() => true, () => false);
      if (!ok) { invitesOk = false; problems.push(`Let ${k === 'leader' ? 'Leader' : 'Co-Leader'} invite: Server Settings → Roles → ${k === 'leader' ? 'Leader' : 'Co-Leader'} → turn on **Create Invite** (War Audit can't give a permission it doesn't have).`); }
    }
  }
  if (everyone && (BigInt(everyone.permissions) & inv)) await dapi(env, 'PATCH', `/guilds/${guild}/roles/${guild}`, { permissions: String(BigInt(everyone.permissions) & ~inv) }).then(() => done.push(`✅ Invites: only Leader and Co-Leader${invitesOk ? '' : ' (see below)'}`), () => done.push('⚠️ Couldn\'t limit invites'));
  const ids = {};
  let pos = 0;
  const catIds = [];
  for (const cat of LAYOUT) {
    const existing = !fresh && st.channels.find(c => c.type === 4 && plain(c.name) === plain(cat.cat));
    const catRes = existing || await dapi(env, 'POST', `/guilds/${guild}/channels`, { name: cat.cat, type: 4, position: pos++, permission_overwrites: overwritesFor(cat.access, guild, roleIds, st.botId) }).catch(() => null);
    if (catRes?.id) catIds.push(catRes.id);
    for (const [n2, spec] of cat.channels.entries()) {
      const permission_overwrites = overwritesFor(spec.access, guild, roleIds, st.botId, spec.type === 2);
      const body = { permission_overwrites, parent_id: catRes?.id || null, position: n2, ...(spec.type === 2 ? {} : { topic: spec.topic }) };
      const res = found[spec.key]
        ? await dapi(env, 'PATCH', `/channels/${found[spec.key]}`, body).catch(e => ({ error: e.message }))
        : await dapi(env, 'POST', `/guilds/${guild}/channels`, { name: spec.name, type: spec.type || 0, ...body }).catch(e => ({ error: e.message }));
      if (res?.id) ids[spec.key] = res.id;
      else if (found[spec.key]) { ids[spec.key] = found[spec.key]; done.push(`⚠️ <#${found[spec.key]}>: couldn't change it (War Audit isn't in this private channel: Edit Channel → Permissions → add War Audit → View Channel). Its job is kept.`); }
      else done.push(`⚠️ ${spec.name}: ${String(res?.error || 'failed').replace(/^Discord /, '')}`);
    }
  }
  const kept = new Set(Object.values(ids)), names = new Set(SPECS.map(x => x.name));
  let dupes = 0;
  for (const c of st.channels) if (names.has(c.name) && !kept.has(c.id) && !old.some(o => o.id === c.id))
    if (await dapi(env, 'DELETE', `/channels/${c.id}`).then(() => true, () => false)) dupes++;
  if (dupes) done.push(`🧹 Removed ${dupes} duplicate channel${dupes === 1 ? '' : 's'} from earlier runs`);
  done.unshift(`✅ ${Object.keys(ids).length} channels in ${LAYOUT.length} categories, with permissions`);
  const next = { clan, channels: {}, roles: roleIds, layout: { ...ids, cats: catIds } };   // layout: what /setup remove deletes
  for (const spec of SPECS) for (const j of spec.jobs) if (ids[spec.key] && JOBS[j]) next.channels[j] = ids[spec.key];
  await setConfig(env, guild, next);
  for (const [job, key] of [['rules', 'rules'], ['stats', 'stats'], ['welcome', 'link']]) if (ids[key]) {
    const prev = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(`discord:${job}:${guild}`).first();
    const p2 = prev ? JSON.parse(prev.v) : null;
    if (!p2 || p2.channel !== ids[key]) await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`discord:${job}:${guild}`, JSON.stringify({ channel: ids[key], id: null })).run();
  }
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('autosetup:' + guild, JSON.stringify({ step: 2, fresh, old: old.map(c => c.id), oldNames: Object.fromEntries(old.map(c => [c.id, c.name])), ids, problems: problems.filter(x => !/Manage (Roles|Channels)/.test(x)) })).run();
  return { content: [`**Step 1 of ${STEPS(fresh)} done: roles and channels**`, ...done].join('\n').slice(0, 1900), components: nextButton(2, STEPS(fresh)) };
}

// /setup remove: delete the channels, categories and roles War Audit's layout uses (matched by their exact names,
// or the ids it saved), and everything it saved about this server. War history is never touched.
// About 25 requests (12 channels, 4 categories, 5 roles, 2 reads): one go fits the Worker's limit.
export async function removeAll(env, guild, cfg, links = false) {
  const [channels, roles] = await Promise.all([dapi(env, 'GET', `/guilds/${guild}/channels`), dapi(env, 'GET', `/guilds/${guild}/roles`)]);
  // Ours: the ids setup saved (it keeps a reused channel's own name, e.g. "Clan-voice"), and the layout's names
  // ignoring emoji, spaces and dashes ("🔊 Clan voice" = "clan-voice"). Other channels are left alone.
  const names = new Set([...SPECS.map(x => plain(x.name)), ...LAYOUT.map(c => plain(c.cat))]);
  const lay = cfg?.layout || {}, saved = new Set([...Object.entries(lay).filter(([k]) => k !== 'cats').map(([, v]) => v), ...(lay.cats || [])]);
  const ours = channels.filter(c => saved.has(c.id) || names.has(plain(c.name)));
  let ch = 0, rl = 0, failed = [];
  for (const c of [...ours.filter(c => c.type !== 4), ...ours.filter(c => c.type === 4)])   // channels first, then their categories
    if (await dapi(env, 'DELETE', `/channels/${c.id}`).then(() => true, () => false)) ch++; else failed.push(c.name);
  const roleNames = new Set(ROLE_SPEC.map(r => plain(r[1]))), roleIds = new Set(Object.values(cfg?.roles || {}));
  for (const r of roles.filter(r => r.id !== guild && !r.managed && (roleIds.has(r.id) || roleNames.has(plain(r.name)))))
    if (await dapi(env, 'DELETE', `/guilds/${guild}/roles/${r.id}`).then(() => true, () => false)) rl++; else failed.push('@' + r.name);
  await env.DB.prepare('DELETE FROM kv WHERE k = ? OR k LIKE ? OR k LIKE ? OR k = ? OR k = ? OR k LIKE ? OR k LIKE ?')
    .bind('discord:' + guild, `discord:%:${guild}`, `discord:%:${guild}:%`, 'autosetup:' + guild, 'refresh:' + guild, `apply:${guild}:%`, `verify:${guild}:%`).run();
  await env.DB.prepare('DELETE FROM discord_guests WHERE guild = ?').bind(guild).run();
  if (links) for (const t of ['discord_links', 'discord_reminders', 'discord_digest', 'discord_warreport']) await env.DB.prepare(`DELETE FROM ${t} WHERE guild = ?`).bind(guild).run();
  return [`🗑️ **Removed:** ${ch} channel${ch === 1 ? '' : 's'}/categor${ch === 1 ? 'y' : 'ies'}, ${rl} role${rl === 1 ? '' : 's'}, and War Audit's saved settings for this server${links ? ', plus everyone\'s linked accounts and settings' : ' (linked accounts kept)'}.`,
    failed.length ? `⚠️ Couldn't delete: ${failed.join(', ')} (War Audit's role must be above these roles, and it needs to see the channel). Delete them by hand or fix and run again.` : '',
    'War Audit has stopped posting here. To build it again: `/setup auto apply:True`.'].filter(Boolean).join('\n');
}

// /whosees: Discord's own permission rules applied to the server's live roles and channels
// (server permissions of @everyone + the role, then the channel's @everyone overwrite, then its role overwrites).
export function effective(channel, roles, guild, roleIds) {
  const byId = Object.fromEntries(roles.map(r => [r.id, BigInt(r.permissions || '0')]));
  let p = byId[guild] || 0n;
  for (const id of roleIds) p |= byId[id] || 0n;
  if ((p & P.ADMIN) === P.ADMIN) return { view: true, send: true, admin: true };
  const ows = channel.permission_overwrites || [], e = ows.find(o => o.id === guild);
  if (e) p = (p & ~BigInt(e.deny)) | BigInt(e.allow);
  let a = 0n, d = 0n;
  for (const o of ows.filter(o => o.type === 0 && roleIds.includes(o.id))) { a |= BigInt(o.allow); d |= BigInt(o.deny); }
  p = (p & ~d) | a;
  return { view: (p & P.VIEW) === P.VIEW, send: (p & P.SEND) === P.SEND, invite: (p & P.INVITE) === P.INVITE };
}

export async function whoSees(env, guild, cfg) {
  const [roles, channels] = await Promise.all([dapi(env, 'GET', `/guilds/${guild}/roles`), dapi(env, 'GET', `/guilds/${guild}/channels`)]);
  const r = cfg?.roles || {};
  const who = [['Newcomer (no role)', []], ['Not in clan', [r.guest]], ['Member', [r.member]], ['Elder', [r.elder]], ['Co-Leader', [r.coLeader]], ['Leader', [r.leader]]].filter(([, ids]) => ids.every(Boolean));
  const list = channels.filter(c => c.type === 0 || c.type === 2).sort((a, b) => {
    const pa = channels.find(x => x.id === a.parent_id)?.position ?? -1, pb = channels.find(x => x.id === b.parent_id)?.position ?? -1;
    return pa - pb || a.position - b.position;
  });
  const out = ['**Who sees what** (read live from Discord just now)'];
  for (const [name, ids] of who) {
    const res = list.map(c => ({ c, e: effective(c, roles, guild, ids) }));
    if (res[0]?.e.admin) { out.push(`**${name}:** everything (Administrator)`); continue; }
    const seen = res.filter(x => x.e.view);
    const inv = effective({ permission_overwrites: [] }, roles, guild, ids).invite;
    out.push(`**${name}:** ${seen.length ? seen.map(x => `<#${x.c.id}>${x.e.send || x.c.type === 2 ? '' : ' (read)'}`).join(' ') : 'nothing'}${inv ? ' · can invite' : ''}`);
  }
  const nobody = list.filter(c => !who.some(([, ids]) => effective(c, roles, guild, ids).view));
  if (nobody.length) out.push(`**Hidden from every role:** ${nobody.map(c => `<#${c.id}>`).join(' ')}`);
  for (const spec of SPECS) if (!list.some(c => spec.match.test(plain(c.name)) && c.type === (spec.type || 0))) out.push(`⚠️ Missing: ${spec.name}. Run \`/setup auto apply:True\` to add it.`);
  if (!r.guest) out.push('_No Not in clan role yet: run `/setup auto apply:True`._');
  out.push('_(read) = can see but not post. Server owner and Administrators always see everything._');
  return out.join('\n');
}

// The next step, from the Continue button.
export async function autoSetupNext(env, guild, clan) {
  await setupDB(env);
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('autosetup:' + guild).first();
  if (!row) return { content: 'Nothing in progress. Start with `/setup auto`.', components: [] };
  const run = JSON.parse(row.v), cfg = await getConfig(env, guild), of = STEPS(run.fresh), done = [];
  const save = s => env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('autosetup:' + guild, JSON.stringify({ ...run, step: s })).run();
  const pin = async (ch, id) => {
    if (!(await dapi(env, 'PUT', `/channels/${ch}/pins/${id}`).then(() => true, () => false))) return false;
    const recent = await dapi(env, 'GET', `/channels/${ch}/messages?limit=5`).catch(() => []);
    const note = (Array.isArray(recent) ? recent : []).find(m => m.type === 6 && m.message_reference?.message_id === id);
    if (note) await dapi(env, 'DELETE', `/channels/${ch}/messages/${note.id}`).catch(() => null);
    return true;
  };
  const post = async (key, ch, text, label) => {
    const id = await upsert(env, key, ch, text).catch(() => null);
    if (!id) return done.push(`⚠️ ${label}: couldn't post in <#${ch}>`);
    await pin(ch, id); done.push(`✅ ${label} → <#${ch}>`);
  };
  if (run.step === 2) {
    const kv = k => env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first().then(r => r ? JSON.parse(r.v) : null);
    const [rules, welcome, stats] = await Promise.all([kv('discord:rules:' + guild), kv('discord:welcome:' + guild), kv('discord:stats:' + guild)]);
    if (rules) { await post('discord:rules:' + guild, rules.channel, rulesText(await clanRules(env, clan)), 'Rules'); await post('discord:privacy:' + guild, rules.channel, PRIVACY, 'Privacy'); }
    if (welcome) await post('discord:welcome:' + guild, welcome.channel, WELCOME, 'How to link');
    if (stats) await post('discord:stats:' + guild, stats.channel, await statsBoard(env, clan), 'Clan stats');
    const info = await dapi(env, 'GET', `/guilds/${guild}`).catch(() => null);
    if (info && !info.icon && env.ASSETS) {
      const png = await env.ASSETS.fetch(new Request('https://assets.local/icons/discord-server-icon.png')).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
      if (png) {
        let bin = ''; const u8 = new Uint8Array(png); for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode(...u8.subarray(k, k + 0x8000));
        if (await dapi(env, 'PATCH', `/guilds/${guild}`, { icon: 'data:image/png;base64,' + btoa(bin) }).then(() => true, () => false)) done.push('✅ Server icon: the clan badge');
      }
    }
    await save(3);
    return { content: [`**Step 2 of ${of} done: rules, how to link, stats**`, ...done].join('\n'), components: nextButton(3, of) };
  }
  if (run.step === 3) {
    const nb = await postNotes(env, guild, cfg, run.note || 0, 5, run.ids?.bot);
    done.push(...nb.done.map(x => x.replace(/^✅ What appears here/, '✅ Note')));
    if (nb.next != null) { await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('autosetup:' + guild, JSON.stringify({ ...run, note: nb.next })).run(); return { content: [`**Step 3 of ${of}: channel notes**`, ...done, '', 'More notes to go.'].join('\n'), components: nextButton(3, of) }; }
    if (chan(cfg, 'scout')) {
      const race = await cr(env, `/clans/${encodeURIComponent('#' + clan)}/currentriverrace`).catch(() => null);
      const week = (await env.DB.prepare('SELECT week FROM periods WHERE clan = ? ORDER BY first_seen DESC LIMIT 1').bind(clan).first())?.week || '';
      const text = race && await scoutRivals(env, clan, week, (race.clans || []).map(c => ({ tag: String(c.tag).replace('#', ''), name: c.name, score: c.clanScore || 0 }))).catch(() => null);
      if (text && await postJob(env, guild, cfg, 'scout', text).catch(() => null)) { done.push(`✅ Rival scouting → <#${chan(cfg, 'scout')}>`); if (week) await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`scout:${clan}:${week}`, String(Date.now())).run(); }
    }
    const shown = done.filter(x => !/^✅ Note/.test(x)), notes = done.length - shown.length;
    if (run.fresh && run.old.length) { await save(4); return { content: [`**Step 3 of ${of} done: notes${notes ? ` (${notes} pinned)` : ''}, scouting**`, ...shown, '', `Last step deletes the **${run.old.length} old channels** (including this one).`].join('\n'), components: nextButton(4, of) }; }
    await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('autosetup:' + guild).run();
    return { content: [`**All done ✅**`, ...shown, notes ? `✅ ${notes} channel notes pinned` : '', run.problems?.length ? `\n**Still to do:**\n${run.problems.map(x => '• ' + x).join('\n')}` : '', '\nNext: `/link #YOURTAG`, then `/setup sync`.'].filter(Boolean).join('\n'), components: [] };
  }
  if (run.step === 4) {
    let removed = 0, tried = 0; const left = [], stuck = [];
    for (const id of run.old) {
      if (tried++ >= 40) { left.push(id); continue; }
      if (await dapi(env, 'DELETE', `/channels/${id}`).then(() => true, () => false)) removed++; else stuck.push(run.oldNames?.[id] || id);
    }
    if (left.length) { run.old = left; await save(4); return { content: `Deleted ${removed} old channels; ${left.length} left.`, components: nextButton(4, of) }; }
    await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('autosetup:' + guild).run();
    const summary = [`**War Audit set up the server ✅**`, `Deleted ${removed} old channel${removed === 1 ? '' : 's'}.`,
      stuck.length ? `⚠️ Couldn't delete: ${stuck.map(x => '#' + x).join(', ')} (War Audit can't see ${stuck.length === 1 ? 'it' : 'them'}, or Discord protects ${stuck.length === 1 ? 'it' : 'them'}). Delete by hand: long-press → Delete Channel.` : '', run.problems?.length ? `**Still to do:**\n${run.problems.map(x => '• ' + x).join('\n')}` : '', 'Next: `/link #YOURTAG`, then `/setup sync`.'].filter(Boolean).join('\n');
    if (chan(cfg, 'leaders')) await postJob(env, guild, cfg, 'leaders', summary).catch(() => null);   // the channel this ran in may be gone
    return { content: summary, components: [] };
  }
  return { content: 'Nothing to do.', components: [] };
}

// /refresh in steps (each one Worker run, under its 50-request limit; Continue between them):
//   clean: delete the bot's old messages (≤30 per step), forget the saved ids;  kept: rules, privacy, how to link, stats;
//   notes: the "what appears here" note in each channel (≤5 per step).
const pinMsg = async (env, ch, id) => {
  if (!(await dapi(env, 'PUT', `/channels/${ch}/pins/${id}`).then(() => true, () => false))) return false;
  const recent = await dapi(env, 'GET', `/channels/${ch}/messages?limit=5`).catch(() => []);
  const note = (Array.isArray(recent) ? recent : []).find(m => m.type === 6 && m.message_reference?.message_id === id);   // "War Audit pinned a message"
  if (note) await dapi(env, 'DELETE', `/channels/${ch}/messages/${note.id}`).catch(() => null);
  return true;
};
async function postKept(env, done, key, ch, text, label) {
  const id = await upsert(env, key, ch, text).catch(() => null);
  if (!id) { done.push(`⚠️ ${label}: couldn't post in <#${ch}>`); return false; }
  const ok = await pinMsg(env, ch, id);
  done.push(`✅ ${label} → <#${ch}>${ok ? ' (pinned)' : ' (couldn\'t pin: long-press → Pin)'}`);
  return true;
}
// The channels with a note: one note per channel (a channel with several jobs gets each one's line).
function noteChannels(cfg, extraBot = null) {
  const introCh = {};
  for (const job of ['war', 'results', 'scout', 'joins', 'leaders', 'guests', 'bot']) {
    const c = chan(cfg, job) || (job === 'bot' ? extraBot : null);
    if (c) (introCh[c] ||= []).push(job);
  }
  return Object.entries(introCh);
}
async function postNotes(env, guild, cfg, from, max = 5, extraBot = null) {
  const list = noteChannels(cfg, extraBot), done = [];
  for (const [c, jobs] of list.slice(from, from + max)) await postKept(env, done, `discord:intro:${guild}:${c}`, c, jobs.map(j => INTROS[j]).join('\n\n'), 'What appears here');
  return { done, next: from + max < list.length ? from + max : null };
}

const refreshButton = label => [{ type: 1, components: [{ type: 2, style: 1, label, custom_id: 'refresh|next' }] }];
export async function refreshAll(env, guild, cfg, clan, clean) {
  await setupDB(env);
  const kv = k => env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first().then(r => r ? JSON.parse(r.v) : null);
  const kept = { rules: await kv('discord:rules:' + guild), welcome: await kv('discord:welcome:' + guild), stats: await kv('discord:stats:' + guild) };
  const channels = [...new Set([...Object.values(cfg?.channels || {}), ...Object.values(kept).filter(Boolean).map(x => x.channel)])];
  if (!channels.length) return { content: 'Nothing set up yet: run `/setup auto`.', components: [] };
  // Remember where each kept message lives (so a clean step can forget the ids and still re-post in the same place).
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('refresh:' + guild, JSON.stringify({ stage: clean ? 'clean' : 'kept', channels, kept, note: 0, cfg })).run();
  return refreshNext(env, guild, clan);
}

export async function refreshNext(env, guild, clan) {
  await setupDB(env);
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('refresh:' + guild).first();
  if (!row) return { content: 'Nothing in progress. Start with `/setup refresh`.', components: [] };
  const run = JSON.parse(row.v), cfg = run.cfg || await getConfig(env, guild), done = [];
  const save = next => env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('refresh:' + guild, JSON.stringify({ ...run, ...next })).run();
  if (run.stage === 'clean') {
    let removed = 0, more = false;
    for (const ch of run.channels) {
      if (more) break;
      const list = await dapi(env, 'GET', `/channels/${ch}/messages?limit=50`).catch(() => []);
      for (const m of (Array.isArray(list) ? list : []).filter(m => m.author?.id === env.DISCORD_APP_ID)) {
        if (removed >= 30) { more = true; break; }
        if (await dapi(env, 'DELETE', `/channels/${ch}/messages/${m.id}`).then(() => true, () => false)) removed++;
      }
    }
    await env.DB.prepare("DELETE FROM kv WHERE k LIKE ? OR k LIKE ? OR k LIKE ? OR k LIKE ? OR k LIKE ? OR k LIKE ? OR k LIKE ? OR k = ?")
      .bind(`discord:rules:${guild}`, `discord:welcome:${guild}`, `discord:stats:${guild}`, `discord:board:${guild}:%`, `discord:todo:${guild}:%`, `discord:todochat:${guild}:%`, `discord:intro:${guild}:%`, `discord:privacy:${guild}`).run();
    run.cleaned = (run.cleaned || 0) + removed;
    if (more) { await save({ cleaned: run.cleaned }); return { content: `🧹 Deleted ${run.cleaned} old messages so far. More to go.`, components: refreshButton('Continue ▶ (clearing)') }; }
    await save({ stage: 'kept', cleaned: run.cleaned });
    return { content: `🧹 Deleted ${run.cleaned} old message${run.cleaned === 1 ? '' : 's'}. Next: re-post the rules, stats and how-to-link.`, components: refreshButton('Continue ▶ (re-post)') };
  }
  if (run.stage === 'kept') {
    const k = run.kept || {};
    if (k.rules) { await postKept(env, done, 'discord:rules:' + guild, k.rules.channel, rulesText(await clanRules(env, clan)), 'Rules'); await postKept(env, done, 'discord:privacy:' + guild, k.rules.channel, PRIVACY, 'Privacy'); }
    if (k.welcome) await postKept(env, done, 'discord:welcome:' + guild, k.welcome.channel, WELCOME, 'How to link');
    if (k.stats) await postKept(env, done, 'discord:stats:' + guild, k.stats.channel, await statsBoard(env, clan), 'Clan stats board');
    await save({ stage: 'notes', note: 0 });
    return { content: [`**Re-posted**`, ...done, '', 'Next: the note in each channel.'].join('\n'), components: refreshButton('Continue ▶ (channel notes)') };
  }
  if (run.stage === 'notes') {
    const r = await postNotes(env, guild, cfg, run.note || 0);
    if (r.next != null) { await save({ note: r.next }); return { content: [...r.done, '', 'More notes to go.'].join('\n'), components: refreshButton('Continue ▶ (more notes)') }; }
    await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('refresh:' + guild).run();
    return { content: ['**Refreshed ✅**', ...r.done, chan(cfg, 'war') ? '➖ War board: posts itself at the next pull on a battle day' : ''].filter(Boolean).join('\n'), components: [] };
  }
  return { content: 'Nothing to do.', components: [] };
}

// Re-write every posted stats board for this clan (after each war).
export async function updateStatsBoards(env, clan) {
  if (!discordReady(env)) return 0;
  await setupDB(env);
  let text = null, sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan)) {
    const saved = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('discord:stats:' + cfg.guild).first();
    if (!saved) continue;
    text ||= await statsBoard(env, clan);
    if (await upsert(env, 'discord:stats:' + cfg.guild, JSON.parse(saved.v).channel, text).catch(() => null)) sent++;
  }
  return sent;
}

// Re-write every posted rules message for this clan (after the rules change on the site).
export async function updateRulesMessages(env, clan) {
  if (!discordReady(env)) return 0;
  await setupDB(env);
  const text = rulesText(await clanRules(env, clan));
  let n2 = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan)) {
    const saved = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('discord:rules:' + cfg.guild).first();
    if (saved && await upsert(env, 'discord:rules:' + cfg.guild, JSON.parse(saved.v).channel, text).catch(() => null)) n2++;
  }
  return n2;
}
