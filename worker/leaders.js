// After each war: the leaders' to-do list in a leaders-only Discord channel, made with the same
// logic as the leaders' page (logic.gen.js). Kicks, demotions and promotions tick themselves from
// the game; warnings, check-ins and decisions have buttons that tick them (shared with the page).
import * as L from './logic.gen.js';
import { readHistory, writeNotes, cr, q } from './history.js';

const MANUAL = { Warn: 'Warnings posted', Check: 'Check-ins posted', Review: 'Decided' };

// Decisions for the latest finished war, exactly as the page makes them.
export async function endDecisions(env, clan) {
  const t = encodeURIComponent('#' + clan);
  // Only as many past wars as the rules look back over (keeps this within the free plan's CPU time).
  const rulesRow = await env.DB.prepare("SELECT value FROM notes WHERE clan = ? AND kind = 'rules' AND week = '*' AND tag = '*'").bind(clan).first();
  let lookback = 10; try { lookback = L.sanitizeRules(JSON.parse(rulesRow?.value || '{}')).rules.lookback; } catch (e) {}
  const [members, race, log, h] = await Promise.all([cr(env, `/clans/${t}/members`), cr(env, `/clans/${t}/currentriverrace`),
    cr(env, `/clans/${t}/riverracelog?limit=10`), readHistory(env, clan, { weeks: lookback + 2, lite: true })]);
  const rows = L.apiToRows({ members, race, log });
  const model = L.build({ roster: rows.roster, log: L.mergeLog(rows.log, L.historyLogRows(h)), race: rows.race, history: [] }, { withGone: true });
  L.applyHistory(model, h, rows.raceWeek);
  const notes = model.history.notes;
  let saved = {}; try { saved = JSON.parse(notes['rules|*|*'] || '{}'); } catch (e) {}
  const r = L.sanitizeRules(saved).rules;
  const note = (kind, tag) => notes[`${kind}|${model.season}|${tag}`];
  const list = model.players.map(p => ({ ...p, ...L.endResult(p, model, r, note, false) }));
  return { week: model.season, endedAt: model.endedAt, r, list };
}

// What's left to do, from the saved list plus what the game and the shared ticks show now.
async function state(env, clan, week) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(`todo:${clan}:${week}`).first();
  if (!row) return null;
  const t = JSON.parse(row.v), tags = t.items.map(x => x.tag);
  if (!tags.length) return { ...t, items: [] };
  const inList = `(${tags.map(q).join(',')})`;
  const [here, roles, done] = await Promise.all([
    env.DB.prepare(`SELECT tag FROM members WHERE clan = ? AND in_clan = 1 AND tag IN ${inList}`).bind(clan).all(),
    env.DB.prepare(`SELECT tag, detail FROM member_events WHERE clan = ? AND kind = 'role' AND at > ? AND tag IN ${inList}`).bind(clan, new Date(t.endedAt || 0).toISOString()).all(),
    env.DB.prepare(`SELECT tag FROM notes WHERE clan = ? AND week = ? AND kind = 'done' AND value = '1' AND tag IN ${inList}`).bind(clan, week).all(),
  ]);
  const inClan = new Set(here.results.map(x => x.tag)), ticked = new Set(done.results.map(x => x.tag));
  const changes = {};
  for (const e of roles.results) (changes[e.tag] ||= []).push(e.detail);
  for (const x of t.items) {
    const ch = changes[x.tag] || [];
    x.done = x.status === 'Kick' ? !inClan.has(x.tag)
      : x.status === 'Promote' ? ch.some(d => /^member>(elder|coLeader)$/.test(d))
      : x.status === 'Demote' ? ch.some(d => /^(elder>member|coLeader>(elder|member))$/.test(d))
      : ticked.has(x.tag);
  }
  return t;
}

export function todoMessage(t, now = Date.now()) {
  const n = x => Number(x).toLocaleString('en-GB');
  const of = s => t.items.filter(x => x.status === s);
  const box = ps => ps.every(x => x.done) ? '✅' : '⬜';
  const who = ps => ps.map(x => `${x.done ? '~~' : ''}${x.name}${x.done ? '~~' : ''}${x.why ? ` (${x.why})` : ''}`).join(', ');
  const lines = [`📋 **After war ${t.week}: what to do**`];
  const game = [['Kick', 'Kick'], ['Demote', 'Demote'], ['Promote', 'Promote to Elder']].filter(([s]) => of(s).length);
  if (game.length) lines.push('', '**In game** · ticks itself when the game shows it', ...game.map(([s, label]) => `${box(of(s))} **${label}:** ${who(of(s))}`));
  const manual = [['Review', 'Decide together'], ['Warn', 'Post first & only warnings'], ['Check', 'Post check-ins']].filter(([s]) => of(s).length);
  if (manual.length) lines.push('', '**Leaders** · tap the button when done', ...manual.map(([s, label]) => `${box(of(s))} **${label}:** ${who(of(s))}`));
  const left = t.items.filter(x => !x.done).length;
  lines.push('', !t.items.length ? '✅ Nothing to do this war. Everyone made it or was excused.' : left ? `${t.items.length - left} of ${t.items.length} done` : '✅ **All done for this war**');
  lines.push(`_Updated ${new Date(now).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })} UK · same ticks as the site_`);
  const buttons = Object.entries(MANUAL).filter(([s]) => of(s).length).map(([s, label]) => {
    const all = of(s).every(x => x.done);
    return { type: 2, style: all ? 2 : 3, label: all ? `Undo: ${label.toLowerCase()}` : `✅ ${label}`, custom_id: `todo|${t.week}|${s}|${all ? 'undo' : 'do'}` };
  });
  return { content: lines.join('\n').slice(0, 1990), components: buttons.length ? [{ type: 1, components: buttons }] : [], allowed_mentions: { parse: [] } };
}

// The clan chat messages, ready to copy (code blocks copy cleanly on phones).
export function chatMessage(t) {
  if (!t.chat.length) return null;
  let out = `💬 **Clan chat messages for war ${t.week}** (long-press a block to copy)`;
  for (const m of t.chat) {
    const block = `\n**${m.title}**\n\`\`\`\n${m.text.replace(/```/g, "'''")}\n\`\`\``;
    if (out.length + block.length > 1950) { out += '\n_More on the site._'; break; }
    out += block;
  }
  return out;
}

// Work out and save the list for the latest war. Returns the saved list.
export async function makeTodo(env, clan) {
  const d = await endDecisions(env, clan);
  if (!d.week) return null;
  const items = d.list.filter(p => L.ACTIONS.includes(p.res.status) && !(p.gone && p.res.status !== 'Kick'))
    .map(p => ({ tag: p.tag, name: L.cleanName(p.name), status: p.res.status,
      why: ['Kick', 'Demote', 'Promote'].includes(p.res.status) ? L.shortReason(p, d.r) : p.res.why.split(' · ')[0] }));
  const chat = L.chatEnd(d.list.filter(p => !p.gone || p.res.status === 'Kick'), d.r);
  const t = { week: d.week, endedAt: d.endedAt, items, chat };
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`todo:${clan}:${d.week}`, JSON.stringify(t)).run();
  await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(`todo:latest:${clan}`, d.week).run();
  return t;
}

// Tick from a Discord button: same shared notes the page writes.
export async function tickTodo(env, clan, week, status, undo, by) {
  const t = await state(env, clan, week);
  if (!t) return null;
  const items = t.items.filter(x => x.status === status && MANUAL[status]).map(x => ({ week, tag: x.tag, kind: 'done', value: undo ? null : '1' }));
  if (items.length) await writeNotes(env, clan, items, new Date().toISOString(), by);
  return state(env, clan, week);
}

export { state as todoState };
