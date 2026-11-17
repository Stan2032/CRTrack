// Discord bot, run inside the Worker (no separate server):
//   - Slash commands arrive at /api/discord (Discord signs each request; we check the signature).
//   - We call Discord's REST API with the bot token to post messages, ping people, and set roles/nicknames.
// Secrets: DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, DISCORD_APP_ID; optional DISCORD_GUILD_ID (commands appear instantly there).
import { readMember } from './history.js';
import { PUSH_SCHEMA } from './push.js';

const API = 'https://discord.com/api/v10';
export const DISCORD_SCHEMA = `CREATE TABLE IF NOT EXISTS discord_links (guild TEXT, user_id TEXT, clan TEXT, tag TEXT, at TEXT, by TEXT, PRIMARY KEY (guild, user_id));`;
const TAG = /^[0289PYLQGRJCUV]{3,12}$/;
const EPHEMERAL = 64;                              // only the person who ran the command sees the reply
const MANAGE_ROLES = 1n << 28n, ADMIN = 1n << 3n;  // who counts as a leader in Discord
const cleanName = n => String(n ?? '').replace(/<\/?c\d*>/gi, '');
const cleanTag = t => String(t || '').trim().toUpperCase().replace(/^#/, '').replace(/O/g, '0');

// ---- Commands (registered with /api/discord/register) ----
export const COMMANDS = [
  { name: 'link', description: 'Link your Discord to your Clash Royale account', options: [{ type: 3, name: 'tag', description: 'Your player tag, e.g. #ABC123', required: true }] },
  { name: 'unlink', description: 'Remove the link between your Discord and Clash Royale accounts' },
  { name: 'me', description: 'Your war progress this war (only you see it)' },
  { name: 'linkuser', description: 'Leaders: link someone else', options: [
    { type: 6, name: 'user', description: 'Discord member', required: true },
    { type: 3, name: 'tag', description: 'Their player tag', required: true }] },
  { name: 'links', description: 'Leaders: who is linked, and who isn\'t yet' },
  { name: 'setup', description: 'Leaders: choose the war channel and the clan roles', options: [
    { type: 7, name: 'channel', description: 'Channel for war reminders and results', required: true },
    { type: 8, name: 'member_role', description: 'Role for clan Members' },
    { type: 8, name: 'elder_role', description: 'Role for Elders' },
    { type: 8, name: 'coleader_role', description: 'Role for Co-leaders' },
    { type: 8, name: 'leader_role', description: 'Role for the Leader' }] },
  { name: 'sync', description: 'Leaders: update everyone\'s roles and nicknames from the game now' },
  { name: 'welcome', description: 'Leaders: post how-to-link instructions here (stays, kept up to date)' },
  { name: 'rules', description: 'Leaders: post the clan rules here (kept up to date automatically)' },
];

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
  return (await env.DB.prepare("SELECT k, v FROM kv WHERE k LIKE 'discord:%'").all()).results.map(r => ({ guild: r.k.slice(8), ...JSON.parse(r.v) }));
}

const reply = (content, ephemeral = true) => ({ type: 4, data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });
const isLeader = member => { const p = BigInt(member?.permissions || '0'); return (p & ADMIN) === ADMIN || (p & MANAGE_ROLES) === MANAGE_ROLES; };

// Desired clan role and nickname for a linked user, from their game role.
async function syncOne(env, guild, cfg, userId, m) {
  if (!cfg?.roles) return;
  const clanRoles = Object.values(cfg.roles).filter(Boolean);
  const want = m && m.in_clan ? cfg.roles[m.role] || cfg.roles.member : null;
  const cur = await dapi(env, 'GET', `/guilds/${guild}/members/${userId}`).catch(() => null);
  if (!cur) return;
  const roles = cur.roles.filter(r => !clanRoles.includes(r)).concat(want ? [want] : []);
  const patch = {};
  if (roles.slice().sort().join() !== cur.roles.slice().sort().join()) patch.roles = roles;
  const nick = m && m.in_clan ? cleanName(m.name).slice(0, 32) : null;
  if (nick && cur.nick !== nick) patch.nick = nick;
  if (Object.keys(patch).length) await dapi(env, 'PATCH', `/guilds/${guild}/members/${userId}`, patch).catch(() => {});   // can't rename the server owner; ignore
}

// ---- Slash command handling ----
export async function handleDiscord(request, env, ctx) {
  const body = await request.text();
  if (!(await verifyDiscord(request, body, env.DISCORD_PUBLIC_KEY))) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return Response.json({ type: 1 });                       // Discord's endpoint check
  if (i.type !== 2) return Response.json(reply('Not supported'));
  await setupDB(env);
  const guild = i.guild_id, user = i.member?.user?.id || i.user?.id, opt = Object.fromEntries((i.data.options || []).map(o => [o.name, o.value]));
  const cfg = guild ? await getConfig(env, guild) : null;
  const clan = cfg?.clan || (env.ALLOWED_CLANS || '').split(',')[0]?.trim().toUpperCase().replace(/^#/, '');
  if (!guild) return Response.json(reply('Use this in your clan\'s Discord server.'));
  const member = tag => env.DB.prepare('SELECT tag, name, role, in_clan FROM members WHERE clan = ? AND tag = ?').bind(clan, tag).first();
  const later = p => ctx?.waitUntil ? ctx.waitUntil(p.catch(() => {})) : p.catch(() => {});

  switch (i.data.name) {
    case 'link': case 'linkuser': {
      if (i.data.name === 'linkuser' && !isLeader(i.member)) return Response.json(reply('Only leaders (Manage Roles) can link other people.'));
      const target = i.data.name === 'linkuser' ? opt.user : user, tag = cleanTag(opt.tag);
      if (!TAG.test(tag)) return Response.json(reply('That doesn\'t look like a player tag. It\'s under your name on your profile, e.g. #ABC123.'));
      const m = await member(tag);
      if (!m || !m.in_clan) return Response.json(reply(`#${tag} isn't in the clan right now.`));
      const taken = await env.DB.prepare('SELECT user_id FROM discord_links WHERE guild = ? AND tag = ? AND user_id != ?').bind(guild, tag, target).first();
      if (taken && i.data.name === 'link') return Response.json(reply(`#${tag} is already linked to someone else. Ask a leader if that's wrong.`));
      if (taken) await env.DB.prepare('DELETE FROM discord_links WHERE guild = ? AND tag = ?').bind(guild, tag).run();
      await env.DB.prepare('INSERT OR REPLACE INTO discord_links (guild, user_id, clan, tag, at, by) VALUES (?, ?, ?, ?, ?, ?)').bind(guild, target, clan, tag, new Date().toISOString(), user).run();
      later(syncOne(env, guild, cfg, target, m));
      return Response.json(reply(`Linked <@${target}> to **${cleanName(m.name)}** (#${tag}).${cfg?.roles ? ' Roles and nickname will update shortly.' : ''}`));
    }
    case 'unlink': {
      await env.DB.prepare('DELETE FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, user).run();
      later(syncOne(env, guild, cfg, user, null));
      return Response.json(reply('Unlinked.'));
    }
    case 'me': {
      const link = await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ? AND user_id = ?').bind(guild, user).first();
      if (!link) return Response.json(reply('Link your account first: `/link #YOURTAG`'));
      const m = await readMember(env, clan, link.tag);
      if (!m) return Response.json(reply('Couldn\'t find you in the clan.'));
      const target = Number(m.rules?.target) || 1800, last = m.war?.days?.[m.war.days.length - 1];
      const lines = [`**${cleanName(m.name)}**`];
      if (m.war?.day) {
        const fame = last?.fame ?? 0, used = last && last.day === m.war.day ? last.today : 0;
        lines.push(`Battle day ${m.war.day} of 4: **${fame.toLocaleString()}** medals, ${4 - used} deck${4 - used === 1 ? '' : 's'} left today.`,
          fame >= target ? `✅ You've reached ${target}.` : `${(target - fame).toLocaleString()} more to reach ${target}.`);
      } else lines.push('Training days: battle days start soon.');
      const lw = m.weeks.slice().sort((a, b) => (a.week < b.week ? 1 : -1))[0];
      if (lw) lines.push(`Last war (${lw.week}): ${lw.fame.toLocaleString()} medals ${lw.fame >= target ? '✅' : '❌'}`);
      return Response.json(reply(lines.join('\n')));
    }
    case 'links': {
      if (!isLeader(i.member)) return Response.json(reply('Leaders only.'));
      const ms = (await env.DB.prepare('SELECT tag, name FROM members WHERE clan = ? AND in_clan = 1').bind(clan).all()).results;
      const linked = new Map((await env.DB.prepare('SELECT tag, user_id FROM discord_links WHERE guild = ?').bind(guild).all()).results.map(r => [r.tag, r.user_id]));
      const yes = ms.filter(m => linked.has(m.tag)), no = ms.filter(m => !linked.has(m.tag));
      const text = `**Linked: ${yes.length} of ${ms.length}**\n${yes.map(m => `${cleanName(m.name)} → <@${linked.get(m.tag)}>`).join('\n') || '–'}\n\n**Not linked yet:** ${no.map(m => cleanName(m.name)).join(', ') || 'nobody'}`;
      return Response.json(reply(text.slice(0, 1990)));
    }
    case 'setup': {
      if (!isLeader(i.member)) return Response.json(reply('Leaders only.'));
      // Roles not picked: use server roles named Member / Elder / Co-Leader / Leader.
      const byName = {};
      if (!opt.member_role || !opt.elder_role || !opt.coleader_role || !opt.leader_role) {
        const list = await dapi(env, 'GET', `/guilds/${guild}/roles`).catch(() => []);
        for (const r of Array.isArray(list) ? list : []) { const n = String(r.name).toLowerCase().replace(/[^a-z]/g, ''); if (['member', 'elder', 'coleader', 'leader'].includes(n) && !byName[n]) byName[n] = r.id; }
      }
      const roles = { member: opt.member_role || cfg?.roles?.member || byName.member, elder: opt.elder_role || cfg?.roles?.elder || byName.elder, coLeader: opt.coleader_role || cfg?.roles?.coLeader || byName.coleader, leader: opt.leader_role || cfg?.roles?.leader || byName.leader };
      const test = await dapi(env, 'POST', `/channels/${opt.channel}/messages`, { content: 'War Audit will post war reminders and results here.', allowed_mentions: { parse: [] } }).then(() => '', e => e.message);
      if (test) return Response.json(reply(cantPost(opt.channel, test) + ' Nothing was changed; run /setup again after fixing it.'));
      await setConfig(env, guild, { clan, channel: opt.channel, roles });
      return Response.json(reply(`Set up: war reminders and results go to <#${opt.channel}>.` + (Object.values(roles).some(Boolean) ? ` Roles: ${[['Member', roles.member], ['Elder', roles.elder], ['Co-leader', roles.coLeader], ['Leader', roles.leader]].map(([n, id]) => `${n} → ${id ? `<@&${id}>` : 'none'}`).join(', ')}. These follow the game for linked members (run \`/sync\` once now).` : ' Add roles any time by running /setup again.')));
    }
    case 'rules': {
      if (!isLeader(i.member)) return Response.json(reply('Leaders only.'));
      const text = rulesText(await clanRules(env, clan));
      const ch = i.channel_id || i.channel?.id;
      const err = await upsert(env, 'discord:rules:' + guild, ch, text).then(() => '', e => e.message);
      return Response.json(reply(err ? cantPost(ch, err) : 'Rules posted here. I\'ll edit that message whenever the rules change on the site. Pin it to keep it handy.'));
    }
    case 'welcome': {
      if (!isLeader(i.member)) return Response.json(reply('Leaders only.'));
      const ch = i.channel_id || i.channel?.id;
      const err = await upsert(env, 'discord:welcome:' + guild, ch, WELCOME).then(() => '', e => e.message);
      return Response.json(reply(err ? cantPost(ch, err) : 'Posted. Long-press it → Pin, so it stays at the top.'));
    }
    case 'sync': {
      if (!isLeader(i.member)) return Response.json(reply('Leaders only.'));
      later(syncGuild(env, guild, cfg, clan, 25));
      return Response.json(reply('Updating roles and nicknames for linked members (up to 25 at a time; run again for more).'));
    }
  }
  return Response.json(reply('Unknown command'));
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
export async function discordPost(env, clan, title, body, pings = []) {
  if (!discordReady(env)) return 0;
  await setupDB(env);
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan && c.channel)) {
    const links = new Map((await env.DB.prepare('SELECT tag, user_id FROM discord_links WHERE guild = ?').bind(cfg.guild).all()).results.map(r => [r.tag, r.user_id]));
    const users = [], parts = pings.map(p => { const u = links.get(p.tag); if (u) users.push(u); return u ? `<@${u}> ${p.text}` : `${cleanName(p.name)} ${p.text}`; });
    const content = [`**${title}**`, body, parts.length ? parts.map(x => '• ' + x).join('\n') : ''].filter(Boolean).join('\n').slice(0, 1990);
    await dapi(env, 'POST', `/channels/${cfg.channel}/messages`, { content, allowed_mentions: { parse: [], users: users.slice(0, 100) } }).then(() => sent++).catch(() => {});
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

// Defaults for the rules (same as DEFAULT_RULES in site/logic.js; tests/discord.mjs checks they match).
export const RULE_DEFAULTS = { target: 1800, perDay: 450, effortNet: true, demoteElders: true, elderWarnFirst: true, boatRepeatKick: true,
  warnClear: 3, spareBoats: true, boatShare: 50, holdWeeks: 3, holdOffline: 3, promoWeeks: 6, promoMisses: 1, promoAvg: 2200 };
const n = x => Number(x).toLocaleString('en-GB');
const ukClock = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
const place = i => ['1st', '2nd', '3rd', '4th', '5th'][i] || `${i + 1}th`;

async function clanRules(env, clan) {
  const row = await env.DB.prepare("SELECT value FROM notes WHERE clan = ? AND kind = 'rules' AND week = '*' AND tag = '*'").bind(clan).first();
  let saved = {}; try { saved = JSON.parse(row?.value || '{}'); } catch (e) {}
  return { ...RULE_DEFAULTS, ...saved };
}

export function rulesText(r) {
  return [
    `📜 **Clan war rules**`,
    `🎯 **${n(r.target)}+ medals every war.** 4 battle days × 4 decks. Every battle earns medals, win or lose: lose all 16 and you still get 1,600, so 2 wins is enough if you play every deck.`,
    `📅 **Joined mid-war?** ${n(r.perDay)} per battle day left after the day you joined (day 1 = ${n(r.perDay * 3)}, day 2 = ${n(r.perDay * 2)}, day 3 = ${n(r.perDay)}). Joined on day 4: excused.${r.effortNet ? ' Played every deck you could? You pass either way.' : ''}`,
    `⚠️ **Miss once:** a first & only warning. It stays until you reach ${n(r.target)}+ ${r.warnClear} wars in a row. **Miss again before then:** kicked${r.demoteElders ? ' (Elders demoted)' : ''}. Two misses in a row is also a kick.`,
    `⚔️ **Duels pay most** (250 a game won), then 1v1 (200), boats least (125).${r.spareBoats ? ` Mostly on boats and under? Warning plus a tip${r.boatRepeatKick ? '; still under on boats next war: kick' : ''}.` : ''}`,
    `💬 **Going away?** Tell a leader. Regulars (${r.holdWeeks}+ wars in a row at target) who go quiet ${r.holdOffline}+ days get a check-in, not a kick.`,
    `⭐ **Elder:** ${r.promoWeeks}+ wars in the clan, at most ${r.promoMisses} miss, average ${n(r.promoAvg)}+.`,
    `_Kept up to date automatically when the rules change._`,
  ].join('\n\n');
}

// Edit a remembered message, or post a new one if it's gone. Remembers the message id under `key`.
export const WELCOME = `**👋 Welcome! Link your Clash Royale account to see the rest of the server.**

**1.** Type \`/link\` and tap the one from **War Audit**.
**2.** Enter your player tag: in Clash Royale, tap your name; it's the code starting with **#** (e.g. \`#ABC123\`).
**3.** Send. Your clan role and nickname are set straight away.

Not in the clan yet? Join in game first, then link. Stuck? Ask a leader.`;

// Plain-language reason when Discord refuses a post.
function cantPost(channel, err) {
  const code = (String(err).match(/: (\d{3})$/) || [])[1];
  if (code === '403') return `I can't post in <#${channel}>: I'm missing permission there. Open that channel's settings → Permissions → add the **War Audit** role (or member) and allow **View Channel**, **Send Messages**, **Embed Links** and **Read Message History**.`;
  if (code === '404') return `I can't see <#${channel}>. Add the **War Audit** role to that channel's permissions with **View Channel** allowed.`;
  return `Discord refused the post in <#${channel}> (${code || 'error'}). Try again in a minute.`;
}

async function upsert(env, key, channel, content) {
  const saved = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  const body = { content: content.slice(0, 1990), allowed_mentions: { parse: [] } };
  if (saved && JSON.parse(saved.v).channel === channel) {   // same channel: edit; a new channel gets a new message
    const { channel: ch, id } = JSON.parse(saved.v);
    const ok = await dapi(env, 'PATCH', `/channels/${ch}/messages/${id}`, body).then(() => true).catch(() => false);
    if (ok) return id;
  }
  const m = await dapi(env, 'POST', `/channels/${channel}/messages`, body);
  if (m?.id) await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(key, JSON.stringify({ channel, id: m.id })).run();
  return m?.id;
}

// The live war board: one message per war, edited after every pull on battle days.
export async function warBoard(env, r, now) {
  if (!discordReady(env) || !r.day || !r.week || !r.board) return 0;
  await setupDB(env);
  const b = r.board, st = b.standings, i = st.findIndex(c => c.tag === r.clan), me = st[i];
  const y = Object.fromEntries((await env.DB.prepare('SELECT rival, fame FROM race_standings WHERE clan = ? AND week = ? AND day = ?').bind(r.clan, r.week, r.day - 1).all()).results.map(x => [x.rival, x.fame]));
  let gap = '';
  if (me && st.length > 1) {
    const other = i > 0 ? st[i - 1] : st[1], g = Math.abs(other.fame - me.fame), gy = y[other.tag] != null && y[me.tag] != null ? Math.abs(y[other.tag] - y[me.tag]) : null;
    gap = i > 0 ? ` · ${n(g)} behind ${cleanName(other.name)}` : ` · leading ${cleanName(other.name)} by ${n(g)}`;
    if (gy != null && gy !== g) gap += i > 0 ? (g < gy ? ' (closing ▲)' : ' (gap growing ▼)') : (g > gy ? ' (pulling away ▲)' : ' (they\'re closing ▼)');
  }
  const pct = b.decksTotal ? Math.round(100 * b.decksUsed / b.decksTotal) : 0;
  const content = [
    `⚔️ **War ${r.week} · battle day ${r.day} of 4**`,
    me ? `🏁 ${place(i)} of ${st.length} · ${n(me.fame)} medals${gap}` : '',
    `🎯 ${b.reached} of ${b.members} have reached ${n(r.target)}`,
    `🃏 Decks today: ${b.decksUsed}/${b.decksTotal} (${pct}%)${b.reset ? ` · resets ${b.reset} UK` : ''}`,
    b.notPlayed.length ? `⏳ Not played today: ${b.notPlayed.slice(0, 20).map(cleanName).join(', ')}${b.notPlayed.length > 20 ? ` +${b.notPlayed.length - 20} more` : ''}` : '✅ Everyone has played today',
    `_Updated ${ukClock(now)} UK_`,
  ].filter(Boolean).join('\n');
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === r.clan && c.channel)) {
    if (await upsert(env, `discord:board:${cfg.guild}:${r.week}`, cfg.channel, content).catch(() => null)) sent++;
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
  const stand = d => env.DB.prepare('SELECT rival, name, fame FROM race_standings WHERE clan = ? AND week = ? AND day = ?').bind(clan, week, d).all().then(x => x.results);
  const [today, before, st, stBefore, stTwo] = await Promise.all([rows(day), rows(day - 1), stand(day), stand(day - 1), stand(day - 2)]);
  if (!today.length) return 0;
  const prevFame = Object.fromEntries(before.map(p => [p.tag, p.fame]));
  const gains = today.map(p => ({ name: p.name, gain: p.fame - (prevFame[p.tag] || 0) })).sort((a, b) => b.gain - a.gain);
  const used = today.reduce((t, p) => t + Math.min(4, p.today), 0), total = today.length * 4;
  const ours = rs => rs.find(x => x.rival === clan)?.fame;
  const gain = ours(st) != null ? ours(st) - (ours(stBefore) ?? 0) : gains.reduce((t, x) => t + x.gain, 0);
  const prevGain = day > 1 && ours(stBefore) != null ? ours(stBefore) - (ours(stTwo) ?? 0) : null;
  const change = prevGain ? Math.round(100 * (gain - prevGain) / prevGain) : null;
  const sorted = st.slice().sort((a, b) => b.fame - a.fame), i = sorted.findIndex(x => x.rival === clan);
  const content = [
    `📊 **Battle day ${day} summary · war ${week}**`,
    `Medals: **+${n(gain)}**${change != null ? ` (${change >= 0 ? '+' : ''}${change}% vs day ${day - 1})` : ''}`,
    `Decks used: ${used}/${total} (${Math.round(100 * used / total)}%)`,
    i >= 0 ? `Place: ${place(i)} of ${sorted.length}${i > 0 ? `, ${n(sorted[i - 1].fame - sorted[i].fame)} behind ${cleanName(sorted[i - 1].name)}` : sorted[1] ? `, ${n(sorted[0].fame - sorted[1].fame)} ahead` : ''}` : '',
    `Top today: ${gains.slice(0, 3).map(x => `${cleanName(x.name)} +${n(x.gain)}`).join(', ')}`,
  ].filter(Boolean).join('\n');
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(once, '1').run();
  let sent = 0;
  for (const cfg of (await allConfigs(env)).filter(c => c.clan === clan && c.channel)) {
    await dapi(env, 'POST', `/channels/${cfg.channel}/messages`, { content, allowed_mentions: { parse: [] } }).then(() => sent++).catch(() => {});
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
