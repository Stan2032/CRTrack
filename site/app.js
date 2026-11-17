// ---- UI ----
const $ = s => document.querySelector(s);
const PROXY = 'https://proxy.royaleapi.dev/v1';
let data = { roster: [], log: [], race: [], history: [] };
let model = null, mode = 'end', day = 4, source = '', hist = null, pickWeek = null;
let showGone = get('cr-war-audit:showGone', false);
let raceInfo = { week: null, day: 0, period: null };
let local = { notes: {}, rules: {} };          // this device
let settings = { key: '', tag: '', code: '' };
let site = { key: false, clans: [], history: false, edit: false };
let codeOk = false;

const RULE_LABELS = {
  target: 'Weekly medals', perDay: 'Late joiner: medals per battle day left', effortNet: 'Late joiner passes if every deck used',
  demoteElders: 'Elders who miss are demoted, not kicked', elderWarnFirst: 'Elders get a first & only warning before demotion',
  boatRepeatKick: 'Boat attackers still under after a warning are kicked', spareBoats: 'Boat attackers get a warning, not a kick', boatShare: 'Counts as boat attacker at % boats',
  holdWeeks: 'Check on them: wars in a row at target', holdOffline: 'Check on them: days offline', promoWeeks: 'Promote: weeks in clan',
  promoMisses: 'Promote: most misses allowed', promoAvg: 'Promote: average medals', chatLimit: 'Chat message length', lookback: 'Weeks of history to use',
};
const LABEL = { Kick: 'Kick', Demote: 'Demote', Warn: 'First & only warning', Check: 'Check on them', Review: 'Leaders decide',
  Promote: 'Promote to Elder', OK: 'Passed', Excused: 'Excused', Left: 'Left the clan', Out: "Can't reach target", Need: 'Still needs medals', Safe: 'Reached target' };
const GROUPS_END = ['Kick', 'Demote', 'Warn', 'Check', 'Review', 'Promote', 'OK', 'Excused', 'Left'];
const ACTIONS = ['Kick', 'Demote', 'Warn', 'Check', 'Review', 'Promote'];
const AUTO_CHECKED = ['Kick', 'Demote', 'Promote'];   // the game shows these; no manual tick
const VERB = { Kick: 'kick', Demote: 'demotion', Warn: 'first & only warning', Check: 'check-in', Review: 'decision', Promote: 'promotion' };
const GROUPS_LIVE = ['Out', 'Need', 'Safe', 'Excused'];
const FOLDED = ['OK', 'Excused', 'Safe', 'Left'];
const JOIN = [['unknown', 'Joined when?'], ['full', 'Joined before war'], ['1', 'Joined battle day 1'], ['2', 'Joined battle day 2'], ['3', 'Joined battle day 3'], ['4', 'Joined battle day 4'], ['excused', 'Excused this war']];
const ROLE = { elder: 'Elder', coLeader: 'Co-leader', leader: 'Leader' };
const label = s => s === 'Out' ? `Can't reach ${rules().target}` : s === 'Safe' ? `Reached ${rules().target}` : LABEL[s] || s;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }
function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
const fmtDate = t => t ? new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }) : '';
const fmtTime = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });

// ---- choices: shared (server notes) with this-device fallback ----
const localKey = () => 'cr-war-audit:' + (model?.clan.tag || 'none');
function loadLocal() {
  const s = get(localKey(), null) || {};
  local = { notes: s.notes || {}, rules: s.rules || {} };
  for (const [k, v] of Object.entries(s.join || {})) local.notes['join|' + k] ??= v;   // older format
  for (const [k, v] of Object.entries(s.over || {})) local.notes['over|' + k] ??= v;
}
const saveLocal = () => put(localKey(), local);
const serverNotes = () => model?.history?.notes || {};
function rules() {
  let shared = {};
  try { shared = JSON.parse(serverNotes()['rules|*|*'] || '{}'); } catch (e) {}
  return { ...DEFAULT_RULES, ...shared, ...local.rules };
}
const weekKey = () => mode === 'end' ? (model?.season || 'x') : (raceInfo.week || 'live');
const nk = (kind, p) => `${kind}|${weekKey()}|${p.tag}`;
const note = (kind, p) => local.notes[nk(kind, p)] ?? serverNotes()[nk(kind, p)];

async function postNotes(items) {
  if (!codeOk || !model) return false;
  const r = await fetch('api/notes?clan=' + model.clan.tag, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Edit-Key': settings.code }, body: JSON.stringify({ items }) });
  if (!r.ok) return false;
  for (const i of items) { const k = `${i.kind}|${i.week}|${i.tag}`; if (i.value == null) delete model.history.notes[k]; else model.history.notes[k] = i.value; }
  return true;
}
async function setNote(kind, p, value) {
  const k = nk(kind, p), v = value === 'Auto' ? null : value;
  const shared = await postNotes([{ week: weekKey(), tag: p.tag, kind, value: v }]);
  if (shared) delete local.notes[k]; else if (v == null) delete local.notes[k]; else local.notes[k] = v;
  saveLocal(); render();
  say(shared ? 'Saved for everyone' : 'Saved on this device');
}

function say(msg, err) { const el = $('#status'); el.textContent = msg; el.classList.toggle('err', !!err); }
function cleanInputTag() { return $('#tag').value.trim().toUpperCase().replace(/^#/, '').replace(/O/g, '0'); }
function setLinks() {
  const t = cleanInputTag(), base = 'https://royaleapi.com/clan/' + t;
  $('#links').innerHTML = VALID_TAG.test(t)
    ? `Download CSVs: <a href="${base}" target="_blank" rel="noopener">Members</a> · <a href="${base}/war/log" target="_blank" rel="noopener">War log</a> · <a href="${base}/war/race" target="_blank" rel="noopener">Race</a>` : '';
}

function load(rows, src) {
  const base = rows.__rows || rows;
  data = { roster: [], log: [], race: [], history: [], ...base };
  if (hist) data.log = mergeLog(data.log, historyLogRows(hist));
  data.__rows = base;
  model = build(data, { season: pickWeek, withGone: true });
  if (hist) applyHistory(model, hist, raceInfo.week);
  if (model.clan.tag) { $('#tag').value = model.clan.tag; settings.tag = model.clan.tag; put('cr-war-audit:settings', settings); setLinks(); }
  loadLocal();
  source = src;
  $('#sub').textContent = [model.clan.name, model.clan.tag && '#' + model.clan.tag].filter(Boolean).join(' · ');
  render();
}

async function pull() {
  const t = cleanInputTag();
  if (!VALID_TAG.test(t)) return say('Check the clan tag', true);
  const viaSite = !settings.key && site.key;
  if (!settings.key && !viaSite) { $('#other').open = true; $('#key').focus(); return say('Add an API key first', true); }
  say('Loading…');
  const call = async path => {
    const url = (viaSite ? 'api/v1' : PROXY) + '/clans/' + encodeURIComponent('#' + t) + path;
    const r = await fetch(url, viaSite ? {} : { headers: { Authorization: 'Bearer ' + settings.key } });
    if (!r.ok) throw r.status;
    return r.json();
  };
  try {
    const [clan, members, race, log, h] = await Promise.all([call(''), call('/members'), call('/currentriverrace'), call('/riverracelog?limit=10'),
      site.history ? fetch('api/history?clan=' + t).then(r => r.ok ? r.json() : null).catch(() => null) : null]);
    hist = h;
    const rows = apiToRows({ clan, members, race, log });
    raceInfo = { week: rows.raceWeek, day: rows.raceDay, period: rows.racePeriod, standings: rows.standings };
    if (raceInfo.day) day = raceInfo.day;
    pickWeek = null;
    load(rows, 'api');
    // Battle days open on This war, unless last war still has things to do.
    mode = 'end';
    const todo = model.season === model.latest && evaluate().some(p => !p.gone && ACTIONS.includes(p.res.status) && !(p.done && (p.done.auto || p.done.manual)));
    setMode(raceInfo.day && !todo ? 'live' : 'end');
    say('Updated ' + fmtTime(Date.now()) + (hist?.events?.length ? ' · history since ' + fmtDate(model.history.since) : ''));
  } catch (e) {
    const msg = viaSite && e === 501 ? 'This site has no key. Add your own below.'
      : viaSite && e === 403 ? 'This site only works for its own clan'
      : e === 403 ? 'Key refused. Check the allowed IP.'
      : e === 404 ? 'Clan not found' : typeof e === 'number' ? 'Error ' + e : "Couldn't connect";
    say(msg, true);
    if (e === 403 || e === 501) $('#other').open = true;
  }
}

async function addFiles(files) {
  const rows = source === 'api' ? { roster: [], log: [], race: [], history: [] } : { ...(data.__rows || data) };
  pickWeek = null;
  hist = null; raceInfo = { week: null, day: 0, period: null };
  const bad = [];
  for (const f of files) { const r = parseCSV(await f.text()), kind = detect(r); if (kind) rows[kind] = r; else bad.push(f.name); }
  load(rows, 'csv');
  if (rows.race.length) { day = guessDay(model.players); $('#day').value = day; }
  if (rows.race.length && !rows.log.length && !rows.history.length) setMode('live');
  const have = [['roster', 'Members'], ['log', 'War log'], ['race', 'Race']].map(([k, n]) => (rows[k].length ? '✓ ' : '✗ ') + n);
  say(have.join('   ') + (bad.length ? '   · not recognised: ' + bad.join(', ') : ''));
}

function evaluate() {
  const r = rules(), past = mode === 'end' && model.season !== model.latest;
  return model.players.map(p => {
    const manual = note('join', p);
    const auto = mode === 'end' ? p.autoJoin : p.autoJoinLive;
    const join = manual || auto || (p.isNew && !p.gone && mode === 'end' ? 'unknown' : 'full');
    const saved = past ? note('result', p) : null;
    const res = mode === 'end' ? judgeEnd(p, r, join, note('over', p) || saved) : judgeLive(p, r, join, day);
    if (mode === 'end' && saved && !note('over', p)) res.why = res.why.replace(/^Changed by a leader/, 'Saved result');
    // Gone: counts as a kick only if they left after the war ended (seen by the tracker); otherwise they just left.
    const keptAfterWar = p.gone && p.leftAt && model.endedAt && p.leftAt > model.endedAt;
    if (mode === 'end' && p.gone && !(res.status === 'Kick' && keptAfterWar)) { res.status = 'Left'; res.why = p.leftAt ? 'Left ' + fmtDate(p.leftAt) : 'Left during or before this war'; }
    // A promotion or demotion seen in game after this war counts as this war's action, whatever was suggested.
    if (mode === 'end' && !p.gone && model.endedAt) {
      const after = (p.roleEvents || []).filter(e => e.at > model.endedAt).map(e => e.detail);
      const promoted = after.some(d => /^member>(elder|coLeader)$/.test(d)), demoted = after.some(d => /^(elder>member|coLeader>(elder|member))$/.test(d));
      if (promoted && res.status !== 'Promote') { res.status = 'Promote'; res.why = 'Promoted after this war'; }
      if (demoted && res.status !== 'Demote') { res.status = 'Demote'; res.why = 'Demoted after this war'; }
    }
    const done = mode === 'end' && ACTIONS.includes(res.status)
      ? { auto: autoDone(p, res.status, model.endedAt), manual: !AUTO_CHECKED.includes(res.status) && note('done', p) === '1' } : null;
    return { ...p, join, joinAuto: !manual && !!auto, res, done };
  });
}

// Results are remembered automatically when a leader opens the latest war.
let saving = false;
async function autoSave(list) {
  if (!codeOk || saving || mode !== 'end' || !model.season || model.season !== model.latest) return;
  const items = list.filter(p => !p.gone && serverNotes()[`result|${model.season}|${p.tag}`] !== p.res.status)
    .map(p => ({ week: model.season, tag: p.tag, kind: 'result', value: p.res.status }));
  if (!items.length) return;
  saving = true;
  try { await postNotes(items); } finally { saving = false; }
}

function more(p) {
  const r = rules();
  const weeks = p.weeks.slice(0, 20).reverse().map(w => `<span class="${w.fame < r.target ? 'bad' : ''}">${esc(w.key)}: ${w.fame}${w.decks < 16 ? ` (${w.decks} decks)` : ''}${w.boats ? ` · ${w.boats} boat` : ''}</span>`).join('');
  const days = (mode === 'end' ? p.days : p.daysLive);
  const lines = [];
  if (p.joined) lines.push(p.joined.seen ? `In clan since at least ${fmtDate(p.joined.at)}` : `Joined ${fmtDate(p.joined.at)}`);
  if (days) lines.push('Decks by battle day: ' + days.map(d => d == null ? '–' : d).join(' · '));
  if (p.offlineDays != null) lines.push(`Last online ${p.offlineDays < 1 ? 'today' : Math.floor(p.offlineDays) + ' days ago'}`);
  const bw = mode === 'end' ? model.season : (raceInfo.week || 'current');
  const bt = battleText(p.battles?.[bw]);
  if (bt) lines.push(`War battles ${mode === 'end' ? 'that war' : 'this war'}: ${bt}`);
  if (p.donations != null && !p.gone) lines.push(`Donations this week: ${p.donations} given, ${p.received ?? 0} received`);
  if (p.roleNow && p.roleNow !== p.role) lines.push(`Was ${p.role} at war end, now ${p.roleNow}`);
  return `<div class="more">${lines.map(l => `<div>${esc(l)}</div>`).join('')}${weeks ? `<div>Wars, oldest to newest (red = under ${r.target}):</div><div class="weeks">${weeks}</div>` : ''}<div class="row">${moreControls(p)}</div></div>`;
}
function moreControls(p) {
  const ctl = [];
  if (!p.gone) ctl.push(joinSelect(p));
  if (mode === 'end') {
    const o = note('over', p) || 'Auto';
    ctl.push(`<select data-over="${esc(p.tag)}" aria-label="Change result"><option value="Auto">Suggested: ${esc(label(p.res.auto))}</option>${GROUPS_END.filter(s => s !== 'Left').map(s => `<option value="${s}" ${o === s ? 'selected' : ''}>Change to: ${esc(label(s))}</option>`).join('')}</select>`);
  }
  return ctl.join('');
}
const joinSelect = p => `<select data-join="${esc(p.tag)}" aria-label="Joined">${JOIN.map(([v, l]) => `<option value="${v}" ${p.join === v ? 'selected' : ''}>${l}${p.joinAuto && p.join === v ? ' (auto)' : ''}</option>`).join('')}</select>`;

function row(p) {
  const r = rules(), role = p.roleNow || p.role;
  const tags = `${ROLE[role] ? `<span class="role">${ROLE[role]}</span>` : ''}${p.isNew && !p.gone ? '<span class="new">NEW</span>' : ''}`;
  let facts, right = '';
  if (mode === 'end') {
    const w = p.cur, ws = recent(p, r).slice().reverse(), miss = missCount(p, r);
    const dots = ws.map(x => `<i class="dot ${x.fame < r.target ? 'miss' : ''}" title="${esc(x.key)}: ${x.fame}"></i>`).join('');
    facts = w ? `<span>${w.fame} medals</span><span>${w.decks}/16 decks${w.boats ? `, ${w.boats} on boats` : ''}</span>` : '<span>Not in this war</span>';
    if (ws.length) facts += `<span class="dots" title="${ws.length - miss} of last ${ws.length} wars at ${r.target}+">${dots}</span>`;
    if (p.done) right = p.done.auto ? '<span class="tick done">✓ Done</span>'
      : AUTO_CHECKED.includes(p.res.status) ? (p.gone || model.season !== model.latest ? '' : '<span class="tick wait">Waiting for game</span>')
      : `<button class="tick ${p.done.manual ? 'done' : ''}" data-done="${esc(p.tag)}" aria-pressed="${p.done.manual}">${p.done.manual ? '✓ Done' : 'Mark done'}</button>`;
  } else {
    facts = `<span>${p.res.fame} medals</span><span>${p.res.today}/4 decks today</span>`;
  }
  const why = mode === 'end' ? p.res.why
    : p.res.status === 'Out' ? `Most possible ${p.res.fame + p.res.max}` + (p.res.today === 0 ? ' · no decks today, kicking frees a slot' : '')
    : p.res.status === 'Need' ? `Needs ${p.res.need} more · up to ${p.res.max} still possible` : '';
  const ask = p.isNew && !p.gone && !p.joinAuto && !note('join', p) && (mode === 'live' || p.cur)
    ? `<div class="ask">Joined when? ${joinSelect(p)}</div>` : '';
  const isDone = p.done && (p.done.auto || p.done.manual);
  return `<div class="p ${isDone ? 'is-done' : ''}">
    <div class="top"><button class="name" data-more="${esc(p.tag)}" aria-expanded="false">${esc(p.name)} <span class="chev">›</span></button>${tags}<span class="grow"></span>${right}</div>
    <div class="facts">${facts}</div>${why ? `<div class="why">${esc(why)}</div>` : ''}${ask}
    <div class="morewrap hidden" id="m-${esc(p.tag)}">${more(p)}</div></div>`;
}

function contextLine() {
  if (!model) return '';
  if (mode === 'end') return model.season ? '' : 'No finished war found';
  if (source === 'api' && !raceInfo.day) return `War ${raceInfo.week || ''}: training days. Battle days haven't started.`;
  const st = raceInfo.standings || [], i = st.findIndex(c => c.tag === model.clan.tag);
  const place = i >= 0 ? ` · ${['1st', '2nd', '3rd', '4th', '5th'][i] || i + 1 + 'th'} of ${st.length} clans, ${st[i].fame.toLocaleString()} medals` : '';
  return `${raceInfo.week ? 'War ' + raceInfo.week + ': ' : ''}battle day ${day} of 4${place}`;
}
function weekPicker() {
  if (mode !== 'end' || !model?.seasons?.length) return '';
  const ended = w => { const x = hist?.wars?.find(v => v.week === w); const t = x && parseTime(x.ended_at); return t ? ', ended ' + fmtDate(t) : ''; };
  return `<select id="week" aria-label="Which war">${model.seasons.map(w => `<option value="${w}" ${w === model.season ? 'selected' : ''}>War ${w}${ended(w)}${w === model.latest ? ' (latest)' : ''}</option>`).join('')}</select>`;
}

function render() {
  renderRules();
  $('#daywrap').classList.toggle('hidden', !(mode === 'live' && source === 'csv'));
  if (!model || !model.players.length) return;
  $('#context').innerHTML = weekPicker() + `<span>${esc(contextLine())}</span>`;
  if (mode === 'live' && source === 'api' && !raceInfo.day) {
    $('#steps').classList.add('hidden');
    $('#chips').innerHTML = ''; $('#groups').innerHTML = '<div class="empty">Nothing to check until battle day 1.</div>';
    $('#cards').innerHTML = '<div class="empty">Nothing yet</div>'; renderLog(); return;
  }
  const r = rules(), all = evaluate(), goneCount = all.filter(p => p.gone).length;
  const list = showGone ? all : all.filter(p => !p.gone);
  const groups = mode === 'end' ? GROUPS_END : GROUPS_LIVE;
  const isDone = p => !!(p.done && (p.done.auto || p.done.manual));
  const sortKey = p => (isDone(p) ? 1e6 : 0) + (mode === 'end' ? (p.cur?.fame ?? 0) : p.res.today * 10000 + p.res.fame);
  const parts = groups.map(s => [s, list.filter(p => p.res.status === s).sort((a, b) => sortKey(a) - sortKey(b))]).filter(g => g[1].length);

  if (mode === 'end') {
    const todo = ACTIONS.map(s => [s, list.filter(p => p.res.status === s && !isDone(p)).length]).filter(x => x[1]);
    const done = list.filter(isDone).length;
    const word = (n, s) => n + ' ' + VERB[s] + (n === 1 ? '' : 's');
    $('#chips').innerHTML = (todo.length ? `<b>To do:</b> ${todo.map(([s, n]) => `<a href="#g-${s}" class="s-${s}">${word(n, s)}</a>`).join(', ')}` : '<b>All done</b>')
      + (done ? ` <span class="muted">· ${done} done</span>` : '')
      + (goneCount ? `<label class="toggle"><input type="checkbox" id="showgone" ${showGone ? 'checked' : ''}> Show ${goneCount} who left the clan</label>` : '');
  } else {
    const out = list.filter(p => p.res.status === 'Out').length, need = list.filter(p => p.res.status === 'Need').length;
    $('#chips').innerHTML = `<a href="#g-Out" class="s-Out">${out} can't reach ${r.target}</a> · <a href="#g-Need" class="s-Need">${need} still need medals</a>`;
  }
  $('#groups').innerHTML = parts.map(([s, ps]) => {
    const d = ps.filter(isDone).length;
    const head = `${esc(label(s))} <span class="count">${ps.length}${d ? `, ${d} done` : ''}</span>`;
    const body = ps.map(row).join('');
    return FOLDED.includes(s) ? `<details class="group" id="g-${s}"><summary class="s-${s}">${head}</summary>${body}</details>`
      : `<div class="group" id="g-${s}"><h3 class="s-${s}">${head}</h3>${body}</div>`;
  }).join('');

  const msgs = (mode === 'end' ? chatEnd(all.filter(p => !p.gone || p.res.status === 'Kick'), r) : chatLive(list, r)).map(m => ({ ...m, title: titleFor(m.title) }));
  $('#cards').innerHTML = msgs.length ? msgs.map((m, i) => `<div class="card">
      <b>${esc(m.title)}<span class="cnt ${m.text.length > r.chatLimit ? 'over' : ''}" id="c${i}">${m.text.length}/${r.chatLimit}</span></b>
      <textarea data-i="${i}" aria-label="${esc(m.title)}">${esc(m.text)}</textarea>
      <button class="btn" data-copy="${i}">Copy</button></div>`).join('') : '<div class="empty">Nothing to post</div>';
  fit();
  renderSteps(all, msgs);
  renderLog();
  renderFresh();
  autoSave(all);
}
const titleFor = t => t.replace(/^Update/, 'Results').replace(/^Warnings/, 'First & only warnings').replace(/^Boats/, 'Boat attacks').replace(/^Check in/, 'Check-ins').replace(/^Out/, "Can't reach target").replace(/^Still need/, 'Still need medals');

// Last scheduled/requested pull, in UK time: DD-MM-YYYY HH:MM
function ukTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}
function renderFresh() {
  const show = site.history && hist && hist.lastRun;
  $('#fresh').classList.toggle('hidden', !show);
  if (!show) return;
  const age = Date.now() - Date.parse(hist.lastRun), limit = raceInfo.day ? 45 * 60e3 : 13 * 3600e3;
  $('#lastpull').textContent = `Data last pulled: ${ukTime(hist.lastRun)} (UK time)` + (age > limit ? ' · older than expected, the schedule may have stopped' : '');
  $('#fresh').classList.toggle('stale', age > limit);
}
async function requestUpdate() {
  const b = $('#refresh'), t = model?.clan.tag || cleanInputTag();
  b.disabled = true; b.textContent = 'Updating…';
  try {
    const r = await fetch('api/snapshot?clan=' + t, { method: 'POST', headers: codeOk ? { 'X-Edit-Key': settings.code } : {} });
    const j = await r.json().catch(() => ({}));
    const msg = m => { $('#freshmsg').textContent = m; setTimeout(() => { if ($('#freshmsg').textContent === m) $('#freshmsg').textContent = ''; }, 8000); };
    if (r.status === 429) msg(`Already fresh. You can ask again in ${Math.max(1, Math.ceil(j.retryAfter / 60))} min.`);
    else if (!r.ok) msg("Couldn't update right now. Try again shortly.");
    else { await pull(); msg('Updated'); }
  } catch (e) { $('#freshmsg').textContent = "Couldn't connect"; }
  b.disabled = false; b.textContent = 'Request updated data';
}

// ---- Recommended steps: in-game actions first, then what to post ----
let stepTexts = [];
const STEP = id => ({ tag: 'STEP-' + id });
function renderSteps(list, msgs) {
  stepTexts = [];
  const box = $('#steps');
  const latest = mode === 'end' ? model.season === model.latest : true;
  const isDone = p => !!(p.done && (p.done.auto || p.done.manual));
  const of = s => list.filter(p => p.res.status === s && (s === 'Kick' || !p.gone));
  const names = a => `<div class="pills">${a.map(p => `<span class="pill ${isDone(p) ? 'done' : ''}">${esc(p.name)}</span>`).join('')}</div>`;
  const copy = prefix => msgs.filter(m => m.title.startsWith(prefix)).map(m => {
    stepTexts.push(m.text); const i = stepTexts.length - 1, part = m.title.match(/\d+\/\d+$/);
    return `<button class="copybtn" data-copystep="${i}">Copy${part ? ' ' + part[0] : ''}</button>`;
  }).join('');
  const steps = [];   // { text, copy, done, ctl }
  const auto = (ps, verb) => ps.length && steps.push({ text: `In game, <b>${verb}</b> ${names(ps)}`, done: ps.every(isDone),
    tick: `<span class="tickbox auto ${ps.every(isDone) ? 'on' : ''}" title="${ps.every(isDone) ? 'Done in game' : 'Ticks itself when done in game'}" aria-label="${ps.every(isDone) ? 'Done' : 'Not done yet'}"></span>` });
  const players = (ps, status, text, cp) => {
    if (!ps.length) return;
    const done = ps.every(isDone);
    steps.push({ text, copy: cp, done, tick: `<button class="tickbox ${done ? 'on' : ''}" data-markall="${status}" data-undo="${done ? 1 : ''}" aria-pressed="${done}" aria-label="Mark done"></button>` });
  };
  const posted = (id, text, cp) => {
    if (!cp) return;
    const done = note('done', STEP(id)) === '1';
    steps.push({ text, copy: cp, done, tick: `<button class="tickbox ${done ? 'on' : ''}" data-stepdone="${id}" aria-pressed="${done}" aria-label="Mark done"></button>` });
  };
  if (mode === 'end' && latest) {
    const k = of('Kick'), d = of('Demote'), pr = of('Promote'), w = of('Warn'), c = of('Check'), rv = of('Review');
    auto(k, 'kick'); auto(d, 'demote'); auto(pr, 'promote to Elder');
    players(rv, 'Review', `<b>Decide with the other leaders</b> ${names(rv)}`, '');
    if (k.length || d.length || pr.length) posted('RESULTS', 'Post the <b>results</b> in clan chat', copy('Results'));
    players(w, 'Warn', `Post the <b>first &amp; only warnings</b> ${names(w)}`, copy('First & only'));
    if (w.length) posted('BOATS', 'Post the <b>boat attack tip</b>', copy('Boat'));
    players(c, 'Check', `Post the <b>check-in</b> ${names(c)}`, copy('Check'));
  } else if (mode === 'live') {
    const free = list.filter(p => p.res.status === 'Out' && !p.gone && p.res.today === 0);
    if (free.length) steps.push({ text: `Optional: <b>kick now</b> to free battle slots (can't reach ${rules().target}, no decks today) ${names(free)}`, tick: '<span class="tickbox auto"></span>' });
    posted('REMIND-' + day, 'Post the <b>reminder</b> for players who still need medals', copy('Still need'));
  }
  box.classList.toggle('hidden', !(mode === 'live' ? steps.length : latest));
  const left = steps.filter(x => !x.done).length;
  box.innerHTML = `<div class="steps-head">Recommended <span class="count">${steps.length ? `${steps.length - left} of ${steps.length} done` : ''}</span></div>` + (steps.length
    ? `<ul>${steps.map(x => `<li class="${x.done ? 'is-done' : ''}">${x.tick || ''}<div class="step-text">${x.text}</div><div class="copies">${x.copy || ''}</div></li>`).join('')}</ul>
       ${left ? '' : '<div class="alldone">✓ All done for this war</div>'}
       <div class="hint">Tap a circle when done. In-game steps tick themselves.</div>`
    : '<div class="alldone">✓ Nothing to do for this war</div>');
}
async function markAll(status, undo) {
  const ps = evaluate().filter(p => p.res.status === status && !p.gone && !(p.done && p.done.auto));
  const items = ps.map(p => ({ week: weekKey(), tag: p.tag, kind: 'done', value: undo ? null : '1' }));
  const shared = await postNotes(items);
  if (!shared) for (const i of items) { const k = `done|${i.week}|${i.tag}`; if (undo) delete local.notes[k]; else local.notes[k] = '1'; }
  saveLocal(); render(); say(shared ? 'Saved for everyone' : 'Saved on this device');
}
function copyText(text, btn) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).catch(() => {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  });
  const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => btn.textContent = old, 1200);
}

function renderLog() {
  if (!model?.history) { $('#log').innerHTML = `<div class="empty">${site.history ? 'Nothing yet' : 'This site has no history'}</div>`; return; }
  const h = model.history, words = { join: 'joined', leave: 'left', role: 'role' };
  const ev = h.events.map(e => `<div class="ev"><span class="when">${esc(fmtDate(parseTime(e.at)))}</span> <b>${esc(e.name || e.tag)}</b> ${
    e.kind === 'role' ? esc(String(e.detail).replace('>', ' → ')) : words[e.kind] || esc(e.kind)}</div>`).join('');
  $('#log').innerHTML = `<div class="hint">${h.weeks} wars stored${h.since ? ' · tracking since ' + esc(fmtDate(h.since)) : ''}</div>${ev || '<div class="empty">No joins or leaves yet</div>'}`;
}

function fit(el) { (el ? [el] : document.querySelectorAll('textarea')).forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }); }

function renderRules() {
  const r = rules();
  $('#rules').innerHTML = Object.keys(DEFAULT_RULES).map(k => `<label class="rule"><span>${RULE_LABELS[k]}</span>${
    typeof DEFAULT_RULES[k] === 'boolean' ? `<input type="checkbox" data-rule="${k}" ${r[k] ? 'checked' : ''}>`
      : `<input type="number" data-rule="${k}" value="${r[k]}">`}</label>`).join('');
  $('#leader').classList.toggle('hidden', !site.edit);
  $('#saverules').classList.toggle('hidden', !codeOk);
  $('#codehint').textContent = codeOk ? 'Leader code accepted. Changes are saved for everyone.' : 'With the leader code, your changes are saved for everyone.';
}

function setMode(m) {
  mode = m;
  $('#m-end').classList.toggle('on', m === 'end'); $('#m-live').classList.toggle('on', m === 'live');
  $('#m-end').setAttribute('aria-selected', m === 'end'); $('#m-live').setAttribute('aria-selected', m === 'live');
  render();
}

async function checkCode(code) {
  if (!site.edit || !code || !settings.tag) return false;
  try {
    const r = await fetch('api/notes?clan=' + settings.tag, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Edit-Key': code }, body: '{"items":[]}' });
    return r.ok;
  } catch (e) { return false; }
}

function exportMd() {
  if (!model) return;
  const list = evaluate(), r = rules();
  const md = [`# War audit: ${model.clan.name} #${model.clan.tag} · ${contextLine()}`, '',
    '| Player | Role | Result | Why |', '|---|---|---|---|',
    ...list.map(p => `| ${p.name} | ${p.role} | ${label(p.res.status)} | ${p.res.why || ''} |`),
    '', '## Chat', '', ...(mode === 'end' ? chatEnd(list, r) : chatLive(list, r)).map(m => '```\n' + m.text + '\n```'),
  ].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = `war-audit-${model.clan.tag || 'clan'}-${weekKey()}.md`; a.click();
}

// events
const drop = $('#drop');
['dragover', 'dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('over')));
drop.addEventListener('drop', ev => { ev.preventDefault(); addFiles(ev.dataTransfer.files); });
$('#pick').addEventListener('change', e => addFiles(e.target.files));
$('#pull').onclick = pull;
$('#refresh').onclick = requestUpdate;
$('#tag').addEventListener('input', setLinks);
$('#tag').addEventListener('keydown', e => { if (e.key === 'Enter') pull(); });
$('#savekey').onclick = () => { settings.key = $('#key').value.trim(); put('cr-war-audit:settings', settings); $('#other').open = false; say(settings.key ? 'Key saved' : 'Key removed'); };
$('#m-end').onclick = () => setMode('end');
$('#m-live').onclick = () => setMode('live');
$('#day').onchange = e => { day = +e.target.value; render(); };
$('#savecode').onclick = async () => {
  const c = $('#code').value.trim();
  codeOk = await checkCode(c);
  settings.code = codeOk ? c : ''; put('cr-war-audit:settings', settings);
  say(codeOk ? 'Leader code accepted' : 'Wrong leader code', !codeOk); render();
};
$('#saverules').onclick = async () => {
  const ok = await postNotes([{ week: '*', tag: '*', kind: 'rules', value: JSON.stringify(rules()) }]);
  if (ok) { local.rules = {}; saveLocal(); }
  say(ok ? 'Rules saved for everyone' : 'Saving failed', !ok); render();
};
document.addEventListener('click', e => {
  const cs = e.target.closest('[data-copystep]');
  if (cs) return copyText(stepTexts[+cs.dataset.copystep], cs);
  const ma = e.target.closest('[data-markall]');
  if (ma) return markAll(ma.dataset.markall, !!ma.dataset.undo);
  const sd = e.target.closest('[data-stepdone]');
  if (sd) { const st = STEP(sd.dataset.stepdone); return setNote('done', st, note('done', st) === '1' ? 'Auto' : '1'); }
  const d = e.target.closest('[data-done]');
  if (d) { const p = model.players.find(x => x.tag === d.dataset.done); setNote('done', p, note('done', p) === '1' ? 'Auto' : '1'); return; }
  const m = e.target.closest('[data-more]');
  if (m) { const box = document.getElementById('m-' + m.dataset.more); box.classList.toggle('hidden'); m.setAttribute('aria-expanded', !box.classList.contains('hidden')); }
  const c = e.target.closest('[data-copy]');
  if (!c) return;
  const t = document.querySelector(`textarea[data-i="${c.dataset.copy}"]`);
  (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).catch(() => { t.select(); document.execCommand('copy'); });
  c.textContent = 'Copied'; setTimeout(() => c.textContent = 'Copy', 1200);
});
document.addEventListener('change', e => {
  const el = e.target, p = model && model.players.find(x => x.tag === (el.dataset.join || el.dataset.over));
  if (el.id === 'showgone') { showGone = el.checked; put('cr-war-audit:showGone', showGone); render(); return; }
  if (el.id === 'week') { pickWeek = el.value === model.latest ? null : el.value; load(data.__rows, source); return; }
  if (el.dataset.join && p) setNote('join', p, el.value);
  if (el.dataset.over && p) setNote('over', p, el.value);
  if (el.dataset.rule) { local.rules[el.dataset.rule] = el.type === 'checkbox' ? el.checked : +el.value; saveLocal(); render(); say(codeOk ? 'Changed here. Tap "Save rules for everyone" to share.' : 'Saved on this device'); }
});
document.addEventListener('input', e => {
  if (e.target.dataset.i == null) return;
  const n = e.target.value.length, c = $('#c' + e.target.dataset.i), lim = rules().chatLimit;
  c.textContent = `${n}/${lim}`; c.classList.toggle('over', n > lim); fit(e.target);
});
window.addEventListener('resize', () => fit());
$('#reset').onclick = () => { local.rules = {}; saveLocal(); render(); say('Rules reset on this device'); };
$('#export').onclick = exportMd;

settings = { ...settings, ...get('cr-war-audit:settings', {}) };
$('#key').value = settings.key || '';
(async () => {
  if (/^https?:$/.test(location.protocol)) {
    try { const r = await fetch('api/status'); if (r.ok) site = { ...site, ...(await r.json()) }; } catch (e) {}
  }
  if (site.key) { $('#setup').classList.add('hidden'); $('#other-sum').textContent = 'Use CSVs instead'; }
  const hashTag = location.hash.replace(/^#/, '');
  $('#tag').value = hashTag || settings.tag || (site.clans.length === 1 ? site.clans[0] : '');
  setLinks();
  if (settings.code) { settings.tag ||= cleanInputTag(); codeOk = await checkCode(settings.code); $('#code').value = codeOk ? settings.code : ''; }
  renderRules();
  if ((settings.key || site.key) && VALID_TAG.test(cleanInputTag())) pull();
})();
