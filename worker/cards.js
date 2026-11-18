// In-depth Discord reports: /me (a member's own numbers, like the members' page and more) and the clan stats board.
import { readMember } from './history.js';
import * as S from './stats.gen.js';
import * as L from './logic.gen.js';

const n = x => Number(x).toLocaleString('en-GB');
const clean = s => String(s ?? '').replace(/<\/?c\d*>/gi, '');
const wk = k => { const [a, b] = String(k).split('-').map(Number); return a * 1000 + (b || 0); };
export const bar = (f, w = 10) => { const k = Math.max(0, Math.min(w, Math.round(f * w))); return '█'.repeat(k) + '░'.repeat(w - k); };
// The game API's compact times ("20261116T094012.000Z") as well as ISO.
const gameTime = t => { const m = String(t || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.parse(t); };
const pct = x => `${Math.round(x * 100)}%`;
const ROLE = { member: 'Member', elder: 'Elder', coLeader: 'Co-leader', leader: 'Leader' };
const COLOR = { good: 0x2e9e5b, mid: 0xd9a520, bad: 0xc0392b, info: 0x3b7dd8 };
const ukHourOffset = () => { const d = new Date(); return (+d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }) - d.getUTCHours() + 24) % 24; };
const hourRange = (a, b) => `${String(a).padStart(2, '0')}:00–${String(b % 24).padStart(2, '0')}:00`;

// Current war, from the latest race_days rows: everyone's medals (for your place in the clan).
async function liveBoard(env, clan, week) {
  if (!week) return [];
  const d = await env.DB.prepare('SELECT max(day) AS d FROM race_days WHERE clan = ? AND week = ?').bind(clan, week).first();
  if (!d?.d) return [];
  return (await env.DB.prepare('SELECT tag, fame FROM race_days WHERE clan = ? AND week = ? AND day = ?').bind(clan, week, d.d).all()).results.sort((a, b) => b.fame - a.fame);
}

export async function meCard(env, clan, tag) {
  const m = await readMember(env, clan, tag);
  if (!m) return null;
  const r = L.sanitizeRules(m.rules || {}).rules, T = r.target;
  const weeks = m.weeks.map(w => ({ key: w.week, fame: w.fame, decks: w.decks, boats: w.boats })).sort((a, b) => wk(b.key) - wk(a.key));
  const p = { tag, weeks, before: weeks };
  const embeds = [];

  // This war
  const days = m.war?.days || [], today = days[days.length - 1];
  if (m.war?.day) {
    const fame = today?.fame ?? 0, used = today && today.day === m.war.day ? today.today : 0, left = 4 - used, need = Math.max(0, T - fame);
    const fc = need ? S.forecast({ tag, weeks }, { target: T, day: m.war.day, leftToday: left, fame, lookback: r.lookback, clan: { use: 0.8, perDeck: 150, sd: 25 } }) : null;
    const board = await liveBoard(env, clan, m.war.week), rank = board.findIndex(x => x.tag === tag) + 1;
    const perDay = [1, 2, 3, 4].map(d => { const x = days.find(y => y.day === d); return x ? `Day ${d}: ${x.today}/4 decks` : null; }).filter(Boolean);
    embeds.push({ title: `⚔️ This war · battle day ${m.war.day} of 4`, color: need ? (fc && fc.prob >= 0.8 ? COLOR.good : fc && fc.prob >= 0.2 ? COLOR.mid : COLOR.bad) : COLOR.good,
      description: [
        `${bar(Math.min(1, fame / T))} **${n(fame)}** / ${n(T)} medals`,
        need ? `**${n(need)}** more to reach ${n(T)}` : `✅ **Target reached!**`,
        `🃏 **${left}** deck${left === 1 ? '' : 's'} left today` + (m.resetAt ? ` · resets ${new Date(gameTime(m.resetAt)).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })} UK` : ''),
        fc ? `🔮 Forecast: **${S.band(fc.prob)}** (${pct(fc.prob)}) if you play like you usually do${left ? `. Playing all ${left} today helps most.` : '.'}` : '',
        rank ? `🏅 ${rank}${['st', 'nd', 'rd'][rank - 1] || 'th'} of ${board.length} in the clan so far` : '',
        perDay.length ? perDay.join(' · ') : '',
      ].filter(Boolean).join('\n') });
  } else embeds.push({ title: '⚔️ This war', color: COLOR.info, description: 'Training days. Battle days start soon.' });

  // Your wars
  if (weeks.length) {
    const rel = S.reliability(p, T, r.lookback), last = weeks[0];
    let streak = 0; for (const w of weeks) { if (w.fame >= T) streak++; else break; }
    const best = weeks.reduce((a, b) => (b.fame > a.fame ? b : a)), shown = weeks.slice(0, 10), top = Math.max(T * 1.5, ...shown.map(w => w.fame));
    const avg = Math.round(shown.reduce((s, w) => s + w.fame, 0) / shown.length);
    const decks = shown.reduce((s, w) => s + w.decks, 0), perDeck = decks ? Math.round(shown.reduce((s, w) => s + w.fame, 0) / decks) : 0;
    const word = s => s >= 85 ? 'Very reliable' : s >= 70 ? 'Reliable' : s >= 55 ? 'Hit and miss' : 'Unreliable';
    embeds.push({ title: '📈 Your wars', color: rel ? (rel.score >= 70 ? COLOR.good : rel.score >= 55 ? COLOR.mid : COLOR.bad) : COLOR.info,
      description: [
        '```', `War    Medals (✓ = ${n(T)}+)`, ...shown.map(w => `${w.key.padEnd(6)} ${n(w.fame).padStart(5)} ${w.fame >= T ? '✓' : '✗'} ${bar(w.fame / 3600, 10)}`), '```',
        `Average **${n(avg)}** · best **${n(best.fame)}** · ${perDeck} medals per battle`,
        streak ? `🔥 **${streak} war${streak === 1 ? '' : 's'} in a row** at ${n(T)}+` : `${n(T)}+ in ${shown.filter(w => w.fame >= T).length} of your last ${shown.length} wars`,
      ].join('\n'),
      fields: rel ? [{ name: `Reliability: ${rel.score}/100 · ${word(rel.score).toLowerCase()}`, value:
        `From your last ${rel.wars} wars: ${n(T)}+ in ${Math.round(rel.hit * rel.wars)}, ${pct(rel.deck)} of battles played, average ${n(rel.avg)}, last 3 wars ${rel.trend >= 0 ? '+' : ''}${n(rel.trend)} vs earlier.` }] : [] });
  }

  // How you play
  const ms = S.modeStats(m.battles, tag), bm = S.bestMode(ms), pt = S.playTimes(m.events, tag);
  const types = [['duel', 'Duels'], ['pvp', '1v1'], ['boat', 'Boat attacks']].filter(([k]) => ms[k].games);
  if (types.length || pt.total >= 4) embeds.push({ title: '🎮 How you play', color: COLOR.info, description: [
    ...types.map(([k, name]) => `**${name}:** ${ms[k].won}W–${ms[k].lost}L (${pct(ms[k].rate)} won) · ~${Math.round(ms[k].perDeck)} medals per deck`),
    bm ? `💡 ${bm.mode} earn you about **${bm.gain} more medals per deck** than ${bm.next}.` : '',
    pt.total >= 4 && pt.window ? `🕒 You usually play **${hourRange(pt.window.from, pt.window.to)} UK** (${pct(pt.window.share)} of ${pt.total} tracked decks)` : '',
  ].filter(Boolean).join('\n') });

  const away = await env.DB.prepare("SELECT value FROM notes WHERE clan = ? AND tag = ? AND kind = 'away' AND week = '*'").bind(clan, tag).first();
  let footer = `${ROLE[m.role] || 'Member'} · #${tag}`;
  try { const a = away && JSON.parse(away.value); if (a && Date.parse(a.until) > Date.now()) footer += ` · away until ${new Date(a.until).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })}`; } catch (e) {}
  embeds[0].author = { name: clean(m.name) };
  embeds[embeds.length - 1].footer = { text: footer };
  return { embeds };
}

// The clan stats board: recent wars, most reliable, streaks, battle types, busiest hours, members, donors.
export async function statsBoard(env, clan) {
  const db = env.DB;
  const rulesRow = await db.prepare("SELECT value FROM notes WHERE clan = ? AND kind = 'rules' AND week = '*' AND tag = '*'").bind(clan).first();
  let saved = {}; try { saved = JSON.parse(rulesRow?.value || '{}'); } catch (e) {}
  const r = L.sanitizeRules(saved).rules, T = r.target;
  const [wars, players, members, battles, hours, moves, donors] = await Promise.all([
    db.prepare('SELECT week, rank, trophy_change FROM wars WHERE clan = ? ORDER BY ended_at DESC LIMIT 26').bind(clan).all(),
    db.prepare('SELECT week, tag, name, fame, decks FROM war_players WHERE clan = ?1 AND week IN (SELECT week FROM wars WHERE clan = ?1 ORDER BY ended_at DESC LIMIT 26)').bind(clan).all(),
    db.prepare('SELECT tag, name FROM members WHERE clan = ? AND in_clan = 1').bind(clan).all(),
    db.prepare('SELECT type, sum(won) AS won, sum(lost) AS lost FROM war_battles WHERE clan = ? GROUP BY type').bind(clan).all(),
    db.prepare("SELECT CAST(strftime('%H', at) AS INTEGER) AS h, count(*) AS c FROM race_events WHERE clan = ? AND at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-35 days') GROUP BY h").bind(clan).all(),
    db.prepare("SELECT kind, count(*) AS c FROM member_events WHERE clan = ? AND kind IN ('join','leave') AND at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') GROUP BY kind").bind(clan).all(),
    // Latest real war week (numerically: "139-1" after "138-4"; rows with week 'unknown' never count).
    db.prepare(`SELECT tag, donations FROM member_stats WHERE clan = ?1 AND week = (SELECT week FROM member_stats WHERE clan = ?1 AND week GLOB '[0-9]*-[0-9]*'
      ORDER BY CAST(substr(week, 1, instr(week, '-') - 1) AS INTEGER) DESC, CAST(substr(week, instr(week, '-') + 1) AS INTEGER) DESC LIMIT 1) ORDER BY donations DESC LIMIT 3`).bind(clan).all(),
  ]);
  const here = new Map(members.results.map(m => [m.tag, clean(m.name)]));
  const ws = wars.results.sort((a, b) => wk(b.week) - wk(a.week));
  const byWeek = {}, byTag = {};
  for (const x of players.results) { (byWeek[x.week] ||= []).push(x); (byTag[x.tag] ||= []).push(x); }
  const lines = [`📊 **Clan stats** · ${here.size}/50 members`];

  // Recent wars
  const recent = ws.slice(0, 8).map(w => { const ps = (byWeek[w.week] || []).filter(x => x.decks > 0); return { ...w, total: ps.reduce((s, x) => s + x.fame, 0), passed: ps.filter(x => x.fame >= T).length, played: ps.length }; });
  if (recent.length) {
    const pl = k => ['1st', '2nd', '3rd', '4th', '5th'][k - 1] || '';
    lines.push('', `**Last ${recent.length} wars**`, '```', `War    Place  Got ${n(T)}+      Clan medals`,
      ...recent.map(w => `${w.week.padEnd(6)} ${pl(w.rank).padEnd(5)}  ${`${w.passed}/${w.played}`.padStart(5)} ${bar(w.played ? w.passed / w.played : 0, 6)}  ${n(w.total).padStart(7)}`), '```');
    const rates = recent.filter(w => w.played).map(w => w.passed / w.played);
    if (rates.length >= 4) { const a = rates.slice(0, 2).reduce((s, x) => s + x, 0) / 2, b = rates.slice(2).reduce((s, x) => s + x, 0) / (rates.length - 2); lines.push(`${a > b + 0.03 ? '📈' : a < b - 0.03 ? '📉' : '➡️'} Last 2 wars: ${pct(a)} of players got ${n(T)}+ (${pct(b)} the wars before)`); }
  }

  // Per member: reliability, streaks, improvement (current members, at least 3 wars)
  const people = [...here.keys()].map(tag => {
    const weeks = (byTag[tag] || []).map(x => ({ key: x.week, fame: x.fame, decks: x.decks })).sort((a, b) => wk(b.key) - wk(a.key));
    let streak = 0; for (const w of weeks) { if (w.fame >= T) streak++; else break; }
    return { name: here.get(tag), rel: S.reliability({ weeks }, T, r.lookback), streak, wars: weeks.length };
  }).filter(x => x.wars >= 3 && x.rel);
  if (people.length) {
    const rel = people.slice().sort((a, b) => b.rel.score - a.rel.score).slice(0, 5);
    lines.push('', `🏅 **Most reliable** (score out of 100): ${rel.map(x => `${x.name} ${x.rel.score}`).join(' · ')}`);
    const st = people.filter(x => x.streak >= 3).sort((a, b) => b.streak - a.streak).slice(0, 5);
    if (st.length) lines.push(`🔥 **Wars in a row at ${n(T)}+:** ${st.map(x => `${x.name} ${x.streak}${x.streak >= 26 ? '+' : ''}`).join(' · ')}`);
    const imp = people.filter(x => x.rel.trend >= 200).sort((a, b) => b.rel.trend - a.rel.trend).slice(0, 3);
    if (imp.length) lines.push(`📈 **Most improved** (average medals, last 3 wars vs earlier): ${imp.map(x => `${x.name} +${n(x.rel.trend)}`).join(' · ')}`);
    const dist = [0, 0, 0, 0]; for (const x of people) dist[x.rel.score >= 85 ? 0 : x.rel.score >= 70 ? 1 : x.rel.score >= 55 ? 2 : 3]++;
    lines.push(`Of ${people.length} members with 3+ wars: ${[[dist[0], 'very reliable'], [dist[1], 'reliable'], [dist[2], 'hit and miss'], [dist[3], 'unreliable']].filter(x => x[0]).map(x => `${x[0]} ${x[1]}`).join(' · ')}`);
  }

  // Battle types (clan-wide)
  const PER = { duel: [250, 100], pvp: [200, 100], boat: [125, 75] }, names = { duel: 'Duels', pvp: '1v1', boat: 'Boats' };
  const bt = battles.results.filter(x => PER[x.type] && x.won + x.lost >= 5).sort((a, b) => Object.keys(PER).indexOf(a.type) - Object.keys(PER).indexOf(b.type));
  if (bt.length) lines.push('', `⚔️ **Medals per battle:** ${bt.map(x => { const g = x.won + x.lost; return `${names[x.type]} ${Math.round((x.won * PER[x.type][0] + x.lost * PER[x.type][1]) / g)}${x.type === 'boat' ? '' : ` (${pct(x.won / g)} won)`}`; }).join(' · ')}`);

  // Busiest hours (UK), from deck plays in the last 5 weeks
  const hc = Array(24).fill(0), off = ukHourOffset();
  for (const x of hours.results) hc[(x.h + off) % 24] += x.c;
  const total = hc.reduce((s, x) => s + x, 0);
  if (total >= 20) {
    let bestH = 0, bestC = -1; for (let h = 0; h < 24; h++) { const c = hc[h] + hc[(h + 1) % 24] + hc[(h + 2) % 24]; if (c > bestC) { bestC = c; bestH = h; } }
    const quiet = hc.indexOf(Math.min(...hc));
    lines.push(`🕒 **Busiest:** ${hourRange(bestH, bestH + 3)} UK (${pct(bestC / total)} of decks) · quietest around ${String(quiet).padStart(2, '0')}:00`);
  }

  // Members and donations
  const mv = Object.fromEntries(moves.results.map(x => [x.kind, x.c]));
  lines.push('', `👥 Last 7 days: ${mv.join || 0} joined · ${mv.leave || 0} left · ${here.size >= 50 ? 'clan full' : `${50 - here.size} spot${50 - here.size === 1 ? '' : 's'} open`}`);
  const dn = donors.results.filter(x => here.has(x.tag) && x.donations > 0);
  if (dn.length) lines.push(`🎁 **Top donors this week:** ${dn.map(x => `${here.get(x.tag)} ${n(x.donations)}`).join(' · ')}`);
  lines.push(`_Updated ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UK_`);
  return lines.join('\n').slice(0, 1990);
}
