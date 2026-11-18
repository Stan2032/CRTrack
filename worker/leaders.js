// The leaders' page decisions for the latest war, worked out in the Worker (same code: logic.gen.js).
// Used by the leaders' weekly digest. The after-war to-do list itself lives on the website.
import * as L from './logic.gen.js';
import { readHistory, cr } from './history.js';

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
