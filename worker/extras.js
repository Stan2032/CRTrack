// Season recaps, rival scouting, the weekly leaders' digest and monthly backups (Discord).
import * as S from './stats.gen.js';
import * as L from './logic.gen.js';
import { readHistory, cr } from './history.js';
import { endDecisions } from './leaders.js';

const n = x => Number(x).toLocaleString('en-GB');
const clean = s => String(s ?? '').replace(/<\/?c\d*>/gi, '');
const place = i => ['1st', '2nd', '3rd', '4th', '5th'][i - 1] || `${i}th`;
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
async function rulesOf(env, clan) {
  const row = await env.DB.prepare("SELECT value FROM notes WHERE clan = ? AND kind = 'rules' AND week = '*' AND tag = '*'").bind(clan).first();
  let saved = {}; try { saved = JSON.parse(row?.value || '{}'); } catch (e) {}
  return L.sanitizeRules(saved).rules;
}

// ---- Season recap: every war of a season, the top 5, everyone at target every war, most improved vs the season before.
export async function seasonRecap(env, clan, season) {
  const r = await rulesOf(env, clan), T = r.target;
  const rows = (await env.DB.prepare("SELECT w.week, w.tag, w.name, w.fame, w.decks FROM war_players w WHERE w.clan = ? AND (w.week LIKE ? OR w.week LIKE ?)")
    .bind(clan, `${season}-%`, `${season - 1}-%`).all()).results;
  const log = rows.map(x => ({ season_key: x.week, player_tag: x.tag, player_name: clean(x.name), player_fame: x.fame, player_decks_used: x.decks }));
  const wars = (await env.DB.prepare('SELECT week, rank, trophy_change FROM wars WHERE clan = ? AND week LIKE ?').bind(clan, `${season}-%`).all()).results;
  const ss = S.seasonSummary(log, wars, season, T);
  if (!ss) return null;
  const prev = S.seasonSummary(log, [], season - 1, T);
  const trophies = wars.reduce((t, w) => t + (w.trophy_change || 0), 0);
  // Most improved: average per war this season vs last season (2+ wars in each).
  const per = (sid, tag) => { const ws = log.filter(x => x.player_tag === tag && x.season_key.startsWith(sid + '-') && x.player_decks_used > 0).map(x => x.player_fame); return ws.length >= 2 ? avg(ws) : null; };
  const tags = [...new Set(log.filter(x => x.season_key.startsWith(season + '-')).map(x => x.player_tag))];
  const imp = tags.map(t => ({ name: log.find(x => x.player_tag === t).player_name, now: per(season, t), before: per(season - 1, t) }))
    .filter(x => x.now != null && x.before != null && x.now - x.before >= 150).sort((a, b) => (b.now - b.before) - (a.now - a.before)).slice(0, 3);
  const medal = ['🥇', '🥈', '🥉', '4.', '5.'];
  return [
    `🏆 **Season ${season} recap** · ${ss.weeks.length} wars`,
    `Placings: ${ss.placings.map(p => p.rank ? place(p.rank) : '–').join(', ')}${trophies ? ` · ${trophies > 0 ? '+' : ''}${n(trophies)} war trophies` : ''}`,
    `Clan medals: **${n(ss.medals)}**${prev ? ` (${ss.medals >= prev.medals ? '+' : ''}${Math.round(100 * (ss.medals - prev.medals) / (prev.medals || 1))}% vs season ${season - 1})` : ''}`,
    '', '**Top 5 for the season**', ...ss.top.map((x, i) => `${medal[i]} ${x.name} · ${n(x.total)} (${x.passed}/${x.wars} wars at ${n(T)}+)`),
    ss.perfect.length ? `\n⭐ **${n(T)}+ every war (${ss.perfect.length}):** ${ss.perfect.map(x => x.name).join(', ')}` : '',
    imp.length ? `📈 **Most improved** (average per war vs season ${season - 1}): ${imp.map(x => `${x.name} +${n(Math.round(x.now - x.before))}`).join(' · ')}` : '',
    '', 'Thanks everyone! ⚔️',
  ].filter(x => x !== '').join('\n').slice(0, 1990);
}

// ---- Rival scouting: each clan in this race, from their own last 5 wars (public) and any times we've met.
export async function scoutRivals(env, clan, week, rivals) {
  const others = rivals.filter(c => c.tag !== clan).slice(0, 4);
  if (!others.length) return null;
  const recentOf = async tag => {
    const log = await cr(env, `/clans/${encodeURIComponent('#' + tag)}/riverracelog?limit=5`).catch(() => null);
    // Medals = their players' medals added up. (A clan's own "fame" in the log is race points in normal weeks but
    // medals in colosseum weeks, so averaging it mixes two different things.)
    const rows = (log?.items || []).map(w => { const s = (w.standings || []).find(x => String(x.clan?.tag).replace('#', '') === tag);
      return s?.clan?.participants?.length ? { rank: s.rank, fame: s.clan.participants.reduce((t, p) => t + (p.fame || 0), 0) } : null; }).filter(Boolean);
    return rows.length ? { fame: avg(rows.map(x => x.fame)), rank: avg(rows.map(x => x.rank)), wins: rows.filter(x => x.rank === 1).length, n: rows.length } : null;
  };
  const [ours, ...theirs] = await Promise.all([recentOf(clan), ...others.map(c => recentOf(c.tag))]);
  const met = (await env.DB.prepare(`SELECT rival, week, max(fame) AS fame FROM race_standings WHERE clan = ? AND rival IN (${others.map(() => '?').join(',')}) AND week != ? GROUP BY rival, week`)
    .bind(clan, ...others.map(c => c.tag), week).all()).results;
  const list = others.map((c, i) => ({ ...c, rec: theirs[i], met: met.filter(m => m.rival === c.tag).length }))
    .sort((a, b) => (b.rec?.fame || 0) - (a.rec?.fame || 0));
  const line = (name, score, rec, extra = '') => `**${clean(name)}**${score ? ` · ${n(score)} trophies` : ''}\n   ${rec ? `avg **${n(Math.round(rec.fame))}** medals · avg place ${rec.rank.toFixed(1)} · ${rec.wins}/${rec.n} wins` : 'no recent wars found'}${extra}`;
  const ourScore = rivals.find(c => c.tag === clan)?.score;
  const threat = list.find(c => c.rec && ours && c.rec.fame > ours.fame);
  return [
    `🔭 **War ${week}: who we're up against** (their last 5 wars)`,
    ...list.map(c => line(c.name, c.score, c.rec, c.met ? ` · met us ${c.met}× before` : '')),
    '', line('Us', ourScore, ours),
    '', threat ? `⚠️ Biggest threat: **${clean(threat.name)}** (about ${n(Math.round(threat.rec.fame - ours.fame))} more medals a war than us). Every deck counts!`
      : ours ? '💪 On recent form we\'re the strongest here. Play every deck and it\'s ours.' : '',
  ].filter(x => x !== '').join('\n').slice(0, 1990);
}

// ---- Weekly digest for leaders (before battle days): warnings, close to promotion, trending down, away, unlinked.
export async function leaderDigest(env, clan, guild = null) {
  const d = await endDecisions(env, clan);
  const r = d.r, T = r.target, here = d.list.filter(p => !p.gone);
  const warned = here.filter(p => (p.res.status === 'Warn' && p.done?.manual) || L.warnState({ ...p, before: p.weeks }, r)?.active);
  const close = here.filter(p => (p.roleNow || p.role) === 'member' && p.res.status !== 'Promote').map(p => {
    const ws = L.recent(p, r), miss = L.missCount(p, r), av = L.avgMedals(p, r), need = [];
    if (ws.length < r.promoWeeks) need.push(`${r.promoWeeks - ws.length} more war${r.promoWeeks - ws.length === 1 ? '' : 's'}`);
    if (miss > r.promoMisses) need.push(`fewer misses (${miss})`);
    if (av < r.promoAvg) need.push(`average ${n(av)} → ${n(r.promoAvg)}`);
    return { p, need, gap: (r.promoWeeks - ws.length > 0 ? r.promoWeeks - ws.length : 0) + Math.max(0, miss - r.promoMisses) + Math.max(0, (r.promoAvg - av) / 200) };
  }).filter(x => x.need.length && x.gap <= 1.5).sort((a, b) => a.gap - b.gap).slice(0, 6);
  const down = here.map(p => ({ p, rel: S.reliability(p, T, r.lookback) })).filter(x => x.rel && x.rel.trend <= -300 && x.rel.wars >= 4)
    .sort((a, b) => a.rel.trend - b.rel.trend).slice(0, 6);
  const now = Date.now(), away = here.filter(p => p.away && p.away.until > now);
  const linked = guild ? await env.DB.prepare('SELECT tag FROM discord_links WHERE guild = ?').bind(guild).all().then(x => new Set(x.results.map(y => y.tag)), () => null) : null;
  const unlinked = linked ? here.filter(p => !linked.has(p.tag)) : [];
  const nm = p => clean(p.name);
  return [
    `🗞️ **Leaders' weekly digest** · battle days start soon`,
    warned.length ? `⚠️ **On a first & only warning (${warned.length}):** ${warned.map(nm).join(', ')}` : '⚠️ Nobody on a warning.',
    close.length ? `⭐ **Close to Elder:** ${close.map(x => `${nm(x.p)} (needs ${x.need.join(', ')})`).join(' · ')}` : '',
    down.length ? `📉 **Slipping** (last 3 wars vs before): ${down.map(x => `${nm(x.p)} ${n(x.rel.trend)}`).join(' · ')}` : '📈 Nobody slipping badly.',
    away.length ? `🏖️ **Away:** ${away.map(p => `${nm(p)} until ${new Date(p.away.until).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' })}`).join(' · ')}` : '',
    linked ? `🔗 **Not linked on Discord (${unlinked.length}):** ${unlinked.slice(0, 15).map(nm).join(', ')}${unlinked.length > 15 ? ` +${unlinked.length - 15} more` : ''}` : '',
    `👥 ${here.length}/50 members · ${50 - here.length} spot${50 - here.length === 1 ? '' : 's'} open`,
  ].filter(Boolean).join('\n').slice(0, 1990);
}

// ---- Monthly backup: the full history as a gzipped JSON file.
export async function backupFile(env, clan, now = Date.now()) {
  const h = await readHistory(env, clan, { weeks: 0 });
  const json = JSON.stringify({ app: 'crtrack', version: 1, clan, at: new Date(now).toISOString(), history: h });
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const month = new Date(now).toISOString().slice(0, 7);
  return { name: `crtrack-${clan}-${month}.json.gz`, data: gz, size: gz.byteLength, raw: json.length,
    summary: `${h.wars.length} wars, ${h.members.filter(m => m.in_clan).length} members, ${h.events.length} clan events${h.events[0] ? `, since ${String(h.events[0].at).slice(0, 10)}` : ''}` };
}
