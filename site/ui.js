// ---- Shared by the leaders' page (app.js) and the members' page (me.js) ----

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }
function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
const fmtDate = t => t ? new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }) : '';
const fmtTime = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });

// Last scheduled/requested pull, in UK time: DD-MM-YYYY HH:MM
function ukTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}
// ---- Charts (inline SVG; one colour, thin marks, hover labels via <title>) ----
function spark(p, target) {
  const ws = p.weeks.slice(0, 20).reverse();
  if (ws.length < 2) return '';
  // Zoomed to the useful range (around the target), so the shape is readable.
  const W = 280, H = 60, pad = 7, right = 40, vals = ws.map(w => w.fame);
  const hi = Math.max(target * 1.15, ...vals), lo = Math.max(0, Math.min(target * 0.85, ...vals) - 100);
  const x = i => pad + i * (W - pad - right) / (ws.length - 1), y = v => H - pad - (v - lo) / (hi - lo) * (H - 2 * pad);
  const pts = ws.map((w, i) => `${x(i).toFixed(1)},${y(w.fame).toFixed(1)}`).join(' ');
  const dots = ws.map((w, i) => `<g><circle cx="${x(i)}" cy="${y(w.fame)}" r="3.5" class="${w.fame < target ? 'miss' : 'ok'}"/><circle cx="${x(i)}" cy="${y(w.fame)}" r="10" fill="transparent"><title>War ${esc(w.key)}: ${w.fame} medals, ${w.decks}/16 decks</title></circle></g>`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Medals per war, oldest to newest: ${ws.map(w => w.fame).join(', ')}. Dashed line is the ${target} target.">
    <line x1="${pad}" x2="${W - right}" y1="${y(target)}" y2="${y(target)}" class="target"/><text x="${W - right + 4}" y="${y(target) + 3}" class="ax start">${target}</text>
    <polyline points="${pts}" class="line"/>${dots}<text x="${W - right + 4}" y="${Math.max(9, Math.min(H - 2, y(vals[vals.length - 1]) + 3))}" class="ax start strong">${vals[vals.length - 1]}</text></svg>`;
}
function bars(items, { h = 110, fmt = v => v, ref = null, label = '' } = {}) {
  if (!items.length) return '';
  const W = Math.max(260, items.length * 22), pad = 18, max = Math.max(ref || 0, ...items.map(i => i.value)) || 1, bw = (W - pad) / items.length;
  const y = v => h - pad - v / max * (h - pad - 6);
  const rects = items.map((it, i) => `<g><rect x="${(i * bw + 1).toFixed(1)}" y="${y(it.value).toFixed(1)}" width="${Math.max(2, bw - 2).toFixed(1)}" height="${(h - pad - y(it.value)).toFixed(1)}" rx="2"/>
    <rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${h}" fill="transparent"><title>${esc(it.title || it.label + ': ' + fmt(it.value))}</title></rect>
    ${it.show ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 4}" class="ax">${esc(it.label)}</text>` : ''}</g>`).join('');
  const refLine = ref ? `<line x1="0" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" class="target"/>` : '';
  return `<div class="chartwrap"><svg class="bars" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${refLine}${rects}</svg></div>`;
}

// ---- Clan rules, explained for members (written from the current rule settings) ----
function rulesExplained(r, opts = {}) {
  const n = x => Number(x).toLocaleString();
  const sections = [
    ['🎯 The target', [
      `Get <b>${n(r.target)}+ medals every war</b>. A war has 4 battle days with 4 decks each (16 decks).`,
      `Every battle earns medals, win or lose: losing all 16 still gives 1,600, so <b>just 2 wins is enough</b> if you play every deck.`]],
    ['📅 Joining mid-war', [
      `Joined after the battle days started? You need <b>${n(r.perDay)} per battle day left</b> after the day you joined (joined on day 1 = ${n(r.perDay * 3)}, day 2 = ${n(r.perDay * 2)}, day 3 = ${n(r.perDay)}).`,
      `Joined on day 4: excused that war.` + (r.effortNet ? ` If you played every deck you could, you pass either way.` : '')]],
    ['⚠️ Missing the target', [
      `First miss: a <b>first & only warning</b>.`,
      `It stays until you reach ${n(r.target)}+ <b>${r.warnClear} wars in a row</b>. Miss again before then: <b>members are kicked</b>` + (r.demoteElders ? `, <b>Elders are demoted</b>.` : '.'),
      `Two misses in a row is also a kick` + (r.demoteElders ? ` (Elders: demoted)` : '') + `. New members who miss their first full war are kicked.`]],
    ['⚔️ Duels, 1v1 and boats', [
      `Medals per battle: <b>duels 250</b> a game won (100 lost), <b>1v1 200</b> (100), <b>boat attacks 125</b> (75). Duels first, boats last.`,
      r.spareBoats ? `Mostly on boats and under? You get the warning plus a tip. ` + (r.boatRepeatKick ? `Still under on boats next war: kick.` : '') : '']],
    ['💬 Going away?', [
      `Tell a leader${opts.discord ? ', or use <b>/away</b> on our Discord' : ' in chat'}. Regulars who reached the target <b>${r.holdWeeks}+ wars in a row</b> and go quiet for ${r.holdOffline}+ days get a check-in, not a kick.`]],
    ['⭐ Becoming Elder', [
      `Members with <b>${r.promoWeeks}+ wars</b> in the clan, at most <b>${r.promoMisses} miss</b>, and an average of <b>${n(r.promoAvg)}+</b> are put forward for Elder.`]],
    ['👑 Leaders decide', [
      `Leaders and co-leaders under the target, members back after leaving, and new members whose join day isn't known are decided by the leaders.`]],
  ];
  const chat = [
    `📜 War rules: ${n(r.target)}+ medals every war (play all 16 decks; 2 wins is enough). Joined mid-war? ${n(r.perDay)} per battle day left.`,
    `Miss once: first & only warning, until you hit ${n(r.target)}+ ${r.warnClear} wars in a row. Miss again before then: kicked${r.demoteElders ? ' (Elders demoted)' : ''}.`,
    `Duels pay most, boats least 🚤❌ Away? Tell a leader 💬 ${r.promoWeeks}+ wars, max ${r.promoMisses} miss, avg ${n(r.promoAvg)}+ gets Elder ⭐`,
  ].flatMap(t => split(t, r.chatLimit))
    // fewer messages: join parts while they still fit one chat message
    .reduce((acc, t) => { const last = acc[acc.length - 1]; if (last && last.length + 1 + t.length <= r.chatLimit) acc[acc.length - 1] = last + '\n' + t; else acc.push(t); return acc; }, []);
  return { sections, chat };
}
