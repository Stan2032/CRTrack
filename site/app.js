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
let codeOk = false, leaderName = '';

const LABEL = { Kick: 'Kick', Demote: 'Demote', Warn: 'First & only warning', Check: 'Check on them', Review: 'Leaders decide',
  Promote: 'Promote to Elder', OK: 'Passed', Excused: 'Excused', Left: 'Left the clan', Out: "Can't reach target", Need: 'Still needs medals', Safe: 'Reached target' };
const GROUPS_END = ['Kick', 'Demote', 'Warn', 'Check', 'Review', 'Promote', 'OK', 'Excused', 'Left'];
const VERB = { Kick: 'kick', Demote: 'demotion', Warn: 'first & only warning', Check: 'check-in', Review: 'decision', Promote: 'promotion' };
const GROUPS_LIVE = ['Out', 'Need', 'Safe', 'Excused'];
const FOLDED = ['OK', 'Excused', 'Safe', 'Left'];
const JOIN = [['unknown', 'Joined when?'], ['full', 'Joined before war'], ['1', 'Joined battle day 1'], ['2', 'Joined battle day 2'], ['3', 'Joined battle day 3'], ['4', 'Joined battle day 4'], ['excused', 'Excused this war']];
const ROLE = { elder: 'Elder', coLeader: 'Co-leader', leader: 'Leader' };
const label = s => s === 'Out' ? `Can't reach ${rules().target}` : s === 'Safe' ? `Reached ${rules().target}` : LABEL[s] || s;


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
  // Saved values that are out of range (from before limits existed) are dropped, so the shared/default value applies.
  for (const [k, v] of Object.entries(local.rules)) if (RULE_SPEC[k] && sanitizeRules({ [k]: v }).rules[k] !== v) delete local.rules[k];
  return sanitizeRules({ ...sanitizeRules(shared).rules, ...local.rules }).rules;
}
const weekKey = () => mode === 'end' ? (model?.season || 'x') : (raceInfo.week || 'live');
const nk = (kind, p) => `${kind}|${weekKey()}|${p.tag}`;
const note = (kind, p) => local.notes[nk(kind, p)] ?? serverNotes()[nk(kind, p)];

async function postNotes(items) {
  if (!codeOk || !model) return false;
  const r = await fetch('api/notes?clan=' + model.clan.tag, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Edit-Key': settings.code }, body: JSON.stringify({ items }) });
  if (!r.ok) return false;
  model.history ||= { notes: {}, events: [], weeks: 0, since: null, saved: false };
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
  _clanH = null;
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
    const r = await fetch(url, viaSite ? { cache: 'no-store' } : { cache: 'no-store', headers: { Authorization: 'Bearer ' + settings.key } });
    if (!r.ok) throw r.status;
    return r.json();
  };
  try {
    const [clan, members, race, log, h] = await Promise.all([call(''), call('/members'), call('/currentriverrace'), call('/riverracelog?limit=10'),
      site.history ? fetch('api/history?clan=' + t, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : null]);
    hist = h;
    const rows = apiToRows({ clan, members, race, log });
    raceInfo = { week: rows.raceWeek, day: rows.raceDay, period: rows.racePeriod, outlook: rows.outlook };
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
    if (mode === 'end') return { ...p, ...endResult(p, model, r, (kind, tag) => note(kind, { tag }), past, fmtDate) };
    const manual = note('join', p), auto = p.autoJoinLive;
    const join = manual || auto || 'full';
    const res = judgeLive(p, r, join, day);
    const out = { ...p, join, joinAuto: !manual && !!auto, res, done: null };
    if (mode === 'live' && raceInfo.day && res.status !== 'Excused' && !p.gone)
      out.fc = forecast(p, { target: res.target, day, leftToday: 4 - res.today, fame: res.fame, lookback: r.lookback, clan: clanH() });
    return out;
  });
}
let _clanH = null;
const clanH = () => _clanH || (_clanH = clanHabits(model.players, rules().lookback));

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
  if (p.away && p.away.until > Date.now() - 14 * 864e5) lines.push(`${p.away.until > Date.now() ? 'Away' : 'Was away'} (said on Discord): ${awayText(p.away)}`);
  if (p.offlineDays != null) lines.push(`Last online ${p.offlineDays < 1 ? 'today' : Math.floor(p.offlineDays) + ' days ago'}`);
  const bw = mode === 'end' ? model.season : (raceInfo.week || 'current');
  const bt = battleText(p.battles?.[bw]);
  if (bt) lines.push(`War battles ${mode === 'end' ? 'that war' : 'this war'}: ${bt}`);
  if (p.donations != null && !p.gone) lines.push(`Donations this week: ${p.donations} given, ${p.received ?? 0} received`);
  if (p.roleNow && p.roleNow !== p.role) lines.push(`Was ${p.role} at war end, now ${p.roleNow}`);
  const ws0 = mode === 'end' ? warnState(p, r) : null;
  if (ws0) lines.push(ws0.active ? `On a first & only warning from war ${ws0.week} (clears after ${r.warnClear} wars in a row at ${r.target}+; ${ws0.run} so far)` : `Warning from war ${ws0.week} cleared (${r.warnClear} wars in a row at ${r.target}+)`);
  const rel = reliability(p, r.target, r.lookback);
  if (rel) lines.push(`Reliability ${rel.score}/100: reached ${r.target}+ in ${Math.round(rel.hit * 100)}% of wars, used ${Math.round(rel.deck * 100)}% of decks, average ${rel.avg.toLocaleString()}, last 3 wars ${rel.trend >= 0 ? '+' : ''}${rel.trend} vs before`);
  const pt = playTimes(hist?.raceEvents || [], p.tag);
  if (pt.total >= 4 && pt.window) lines.push(`Usually plays ${String(pt.window.from).padStart(2, '0')}:00–${String(pt.window.to).padStart(2, '0')}:00 UK (${Math.round(pt.window.share * 100)}% of ${pt.total} tracked decks)`);
  const ms = modeStats(hist?.battles || [], p.tag), modes = [['duel', 'Duels'], ['pvp', '1v1'], ['boat', 'Boats']].filter(([k]) => ms[k].games);
  if (modes.length) lines.push('All tracked war battles: ' + modes.map(([k, n]) => `${n} ${ms[k].won}W–${ms[k].lost}L (${Math.round(ms[k].rate * 100)}%, ~${Math.round(ms[k].perDeck)} per deck)`).join(' · '));
  const bm = bestMode(ms);
  if (bm) lines.push(`Earns most per deck in ${bm.mode}: ~${bm.gain} more than ${bm.next}`);
  const sum = [];
  if (rel) sum.push(`<b>${rel.score >= 85 ? 'Very reliable' : rel.score >= 70 ? 'Reliable' : rel.score >= 55 ? 'Hit and miss' : 'Unreliable'}</b> (${rel.score}/100)`);
  if (rel) sum.push(`usually ~${rel.avg.toLocaleString()} medals`);
  if (bm) sum.push(`best in ${bm.mode}`);
  if (pt.total >= 4 && pt.window) sum.push(`plays ~${String(pt.window.from).padStart(2, '0')}:00 UK`);
  return `<div class="more">${sum.length ? `<div class="psum">${sum.join(' · ')}</div>` : ''}${spark(p, r.target)}<details class="pdetail"><summary>Details</summary>${lines.map(l => `<div>${esc(l)}</div>`).join('')}${weeks ? `<div>Wars, oldest to newest (red = under ${r.target}):</div><div class="weeks">${weeks}</div>` : ''}</details><div class="row">${moreControls(p)}</div></div>`;
}
function moreControls(p) {
  const ctl = [];
  if (!p.gone && (p.isNew || note('join', p))) ctl.push(joinSelect(p));
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
    // Live: medals toward the target (number + bar), today's decks as 4 dots, and one status badge by the name.
    const x = p.res, pct = Math.min(100, Math.round(100 * x.fame / (r.target || 1)));
    facts = `<span class="med"><b>${x.fame.toLocaleString()}</b><span class="muted"> / ${r.target.toLocaleString()}</span></span>`
      + `<span class="bar" aria-hidden="true"><i class="${x.status === 'Safe' ? 'ok' : ''}" style="width:${pct}%"></i></span>`
      + `<span class="pips" title="${x.today} of 4 decks played today" aria-label="${x.today} of 4 decks today">${[0, 1, 2, 3].map(k => `<i class="${k < x.today ? 'on' : ''}"></i>`).join('')}</span>`;
    const b = p.fc && x.status === 'Need' ? band(p.fc.prob) : null, tip = p.fc ? ` title="Expect ~${p.fc.expected.toLocaleString()} (likely ${p.fc.low.toLocaleString()}–${p.fc.high.toLocaleString()}). Based on ${esc(p.fc.basis)}."` : '';
    right = x.status === 'Safe' ? `<span class="fcb ok">✓ Reached</span>`
      : x.status === 'Out' ? `<span class="fcb bad">Can't reach</span>`
      : b ? `<span class="fcb ${{ Likely: 'ok', 'At risk': 'risk', Unlikely: 'bad' }[b]}"${tip}>${b === 'Likely' ? 'On track' : `${b} · ${Math.round(p.fc.prob * 100)}%`}</span>` : '';
  }
  // The second line only when there's something to act on (or an away note).
  const b2 = mode !== 'end' && p.fc && p.res.status === 'Need' ? band(p.fc.prob) : null;
  const why = mode === 'end' ? p.res.why
    : [p.res.why, p.res.status === 'Out' ? `At most ${(p.res.fame + p.res.max).toLocaleString()} now` + (p.res.today === 0 ? ' · no decks today' : '')
      : p.res.status === 'Need' && b2 && b2 !== 'Likely' ? `Expected ~${p.fc.expected.toLocaleString()} by the end of the war` : ''].filter(Boolean).join(' · ');
  const ask = p.isNew && !p.gone && !p.joinAuto && !note('join', p) && (mode === 'live' || p.cur)
    ? `<div class="ask">Joined when? ${joinSelect(p)}</div>` : '';
  const isDone = p.done && (p.done.auto || p.done.manual);
  return `<div class="p ${isDone ? 'is-done' : ''}">
    <div class="top"><button class="name" data-more="${esc(p.tag)}" aria-expanded="false">${esc(p.name)} <span class="chev">›</span></button>${tags}<span class="grow"></span>${right}</div>
    <div class="facts">${facts}</div>${why ? `<div class="why">${esc(why)}</div>` : ''}${ask}
    <div class="morewrap hidden" id="m-${esc(p.tag)}">${more(p)}</div></div>`;
}

// Daily reset time in UK time, from when the last war ended (wars end at the daily reset).
function resetUK() {
  const w = (hist?.wars || []).map(x => parseTime(x.ended_at)).filter(Boolean).sort((a, b) => b - a)[0];
  return w ? new Date(w).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}
const liveOpts = () => ({ day, reset: resetUK() });

// The race (raceOutlook in logic.js): race points if today ended now, today's medals and place, what passing the
// next clan today is worth, and the finish on recent form. Colosseum weeks: total medals decide it.
const nth = i => ['1st', '2nd', '3rd', '4th', '5th'][i] || i + 1 + 'th';
function raceBox() {
  const o = raceInfo.outlook, st = o?.rows || [];
  if (mode !== 'live' || !raceInfo.day || st.length < 2) return '';
  const me = st.find(c => c.tag === model.clan.tag);
  if (!me) return '';
  const nm = c => esc(cleanName(c.name)), val = c => o.colosseum ? c.medals : c.ifNow;
  const head = o.colosseum ? '<tr><th></th><th>Clan</th><th class="num">Medals</th></tr>' : '<tr><th></th><th>Clan</th><th class="num">Race pts</th><th class="num">Today</th></tr>';
  const rows = st.map((c, i) => `<tr class="${c.tag === me.tag ? 'us' : ''}"><td>${i + 1}</td><td>${nm(c)}</td><td class="num">${val(c).toLocaleString()}</td>${o.colosseum ? '' : `<td class="num">${c.today.toLocaleString()}</td>`}</tr>`).join('');
  const lines = [];
  if (!o.colosseum && o.started) {
    const k = me.place, up = st.find(c => c.tag === me.next);
    lines.push(`Today we're <b>${nth(k)}</b> on medals (+${RANK_POINTS[k].toLocaleString()} race points)` + (up ? `. <b>${(up.today - me.today + 1).toLocaleString()}</b> more medals passes ${nm(up)}: <b>+${(RANK_POINTS[up.place] - RANK_POINTS[k]).toLocaleString()}</b>` : '. Keep it!'));
  }
  if (st.some(c => c.avgMedals != null)) {
    const pr = st.slice().sort((a, b) => b.projected - a.projected), k = pr.indexOf(me);
    lines.push(`On recent form: finish <b>${nth(k)}</b> (~${me.projected.toLocaleString()})` + (k > 0 ? `, ${nm(pr[0])} ~${pr[0].projected.toLocaleString()}` : `, ${nm(pr[1])} next on ~${pr[1].projected.toLocaleString()}`));
  }
  const sub = o.colosseum ? 'Colosseum: total medals decide it' : `Race points${o.started ? ' if today ended now' : ''}. Each day the clan with the most medals gets 3,000, then 1,800, 1,000, 600, 400`;
  return `<div class="race"><div class="steps-head">Race <span class="count">${nth(st.indexOf(me))} of ${st.length}</span></div><div class="hint">${sub}</div><table>${head}${rows}</table>${lines.map(l => `<div class="hint" style="margin-top:6px">${l}</div>`).join('')}</div>`;
}

function contextLine() {
  if (!model) return '';
  if (mode === 'end') return model.season ? '' : 'No finished war found';
  if (source === 'api' && !raceInfo.day) return `War ${raceInfo.week || ''}: training days. Battle days haven't started.`;
  const o = raceInfo.outlook, st = o?.rows || [], i = st.findIndex(c => c.tag === model.clan.tag);
  const place = i >= 0 ? ` · ${nth(i)} of ${st.length} clans` : '';
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
  $('#context').innerHTML = weekPicker() + `<span>${esc(contextLine())}</span>` + raceBox();
  if (mode === 'live' && source === 'api' && !raceInfo.day) {
    $('#steps').classList.add('hidden'); syncMsgBox();
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
    const fcs = list.filter(p => p.fc && p.res.status === 'Need');
    const cnt = b => fcs.filter(p => band(p.fc.prob) === b).length, likely = cnt('Likely'), risk = cnt('At risk'), unlikely = cnt('Unlikely');
    $('#chips').innerHTML = `<a href="#g-Out" class="s-Out">${out} can't reach ${r.target}</a> · <a href="#g-Need" class="s-Need">${need} still need medals</a>`
      + (fcs.length ? `<div class="muted">Forecast for those still needing medals: ${likely} likely, ${risk} at risk, ${unlikely} unlikely</div>` : '');
  }
  $('#groups').innerHTML = parts.map(([s, ps]) => {
    const d = ps.filter(isDone).length;
    const allDone = ACTIONS.includes(s) && ps.length && d === ps.length;
    const head = `${esc(label(s))} <span class="count">${ps.length}${allDone ? ' ✓ all done' : d ? `, ${d} done` : ''}</span>`;
    const body = ps.map(row).join('');
    return FOLDED.includes(s) || allDone ? `<details class="group" id="g-${s}"><summary class="s-${s}">${head}</summary>${body}</details>`
      : `<div class="group" id="g-${s}"><h3 class="s-${s}">${head}</h3>${body}</div>`;
  }).join('');

  const msgs = (mode === 'end' ? chatEnd(all.filter(p => !p.gone || p.res.status === 'Kick'), r) : chatLive(list, r, liveOpts())).map(m => ({ ...m, title: titleFor(m.title) }));
  if (mode === 'end') { const rc = recap(all, r); if (rc) msgs.push({ title: 'Recap', text: rc }); }
  if (mode === 'end' && model.season) {
    const [sid, sec] = model.season.split('-').map(Number), ss = sec >= 4 ? seasonSummary(data.log || [], hist?.wars, sid, r.target) : null;
    if (ss && ss.complete) {
      const pl = n => n ? ['1st', '2nd', '3rd', '4th', '5th'][n - 1] || n + 'th' : '?';
      const txt = [`Season ${sid} recap ⚔️`,
        ss.placings.some(x => x.rank) ? `Placings: ${ss.placings.map(x => pl(x.rank)).join(', ')}` : '',
        `Top: ${ss.top.slice(0, 3).map(x => `${cleanName(x.name)} ${x.total.toLocaleString()}`).join(', ')}`,
        ss.perfect.length ? `${r.target}+ every war: ${ss.perfect.slice(0, 5).map(x => cleanName(x.name)).join(', ')}${ss.perfect.length > 5 ? ` +${ss.perfect.length - 5} more` : ''}` : '',
        'Thanks all for a great season! 🏆'].filter(Boolean).join('\n');
      split(txt, r.chatLimit).forEach((t, i, a) => msgs.push({ title: a.length > 1 ? `Season ${i + 1}/${a.length}` : 'Season', text: t }));
    }
  }
  $('#cards').innerHTML = msgs.length ? msgs.map((m, i) => `<div class="card">
      <b>${esc(m.title)}<span class="cnt ${m.text.length > r.chatLimit ? 'over' : ''}" id="c${i}">${m.text.length}/${r.chatLimit}</span></b>
      <textarea data-i="${i}" aria-label="${esc(m.title)}">${esc(m.text)}</textarea>
      <button class="copybtn" data-copy="${i}">Copy</button></div>`).join('') : '<div class="empty">Nothing to post</div>';
  fit();
  renderSteps(all, msgs);
  renderLog();
  renderExplain();
  renderStats();
  renderFresh();
  renderNotify();
  autoSave(all);
}
// Weekly recap: placing, trophies, top scorers, most improved.
function recap(list, r) {
  if (!model.season) return '';
  const war = hist?.wars?.find(w => w.week === model.season);
  const played = list.filter(p => p.cur && p.cur.decks > 0);
  if (!played.length) return '';
  const top = played.slice().sort((a, b) => b.cur.fame - a.cur.fame).slice(0, 3);
  const up = played.filter(p => p.prev).map(p => ({ p, d: p.cur.fame - p.prev.fame })).sort((a, b) => b.d - a.d)[0];
  const passed = played.filter(p => p.cur.fame >= r.target).length;
  const place = war && war.rank > 0 ? `${['1st', '2nd', '3rd', '4th', '5th'][war.rank - 1] || war.rank + 'th'} place` : '';
  const trophies = war && war.trophy_change ? `${war.trophy_change > 0 ? '+' : ''}${war.trophy_change} trophies` : '';
  return [
    `War ${model.season} recap${[place, trophies].filter(Boolean).length ? ': ' + [place, trophies].filter(Boolean).join(', ') : ''}`,
    `${passed} of ${played.length} hit ${r.target}+`,
    `Top: ${top.map(p => `${p.name} ${p.cur.fame}`).join(', ')}`,
    up && up.d > 0 ? `Most improved: ${up.p.name} (+${up.d})` : '',
    'Thanks all! ⚔️',
  ].filter(Boolean).join('\n');
}
const titleFor = t => t.replace(/^Update/, 'Results').replace(/^Warnings/, 'First & only warnings').replace(/^Boats/, 'Boat attacks').replace(/^Check in/, 'Check-ins').replace(/^Out/, "Can't reach target").replace(/^Still need/, 'Still need medals');

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
// The messages are in their steps; the full list stays folded unless the steps aren't shown (e.g. an older war).
let _stepsShown = null;
function syncMsgBox() {
  const shown = !$('#steps').classList.contains('hidden');
  if (shown !== _stepsShown) { $('#msgbox').open = !shown; _stepsShown = shown; }
}
function renderSteps(list, msgs) {
  stepTexts = [];
  const box = $('#steps');
  const latest = mode === 'end' ? model.season === model.latest : true;
  const isDone = p => !!(p.done && (p.done.auto || p.done.manual));
  const of = s => list.filter(p => p.res.status === s && (s === 'Kick' || !p.gone));
  const names = a => `<div class="pills">${a.map(p => `<span class="pill ${isDone(p) ? 'done' : ''}">${esc(p.name)}</span>`).join('')}</div>`;
  // Each step shows its clan chat message(s) right there, each with its Copy button.
  const copy = prefix => msgs.filter(m => m.title.startsWith(prefix)).map(m => {
    stepTexts.push(m.text); const i = stepTexts.length - 1, part = m.title.match(/\d+\/\d+$/);
    return `<div class="stepmsg"><div class="quote">${esc(m.text)}</div><div class="stepmsg-foot"><span class="cnt">${m.text.length}/${rules().chatLimit}${part ? ` · part ${part[0].replace('/', ' of ')}` : ''}</span><button class="copybtn" data-copystep="${i}">Copy</button></div></div>`;
  }).join('');
  const steps = [];   // { text, copy, done, ctl }
  const auto = (ps, verb, cp = '') => ps.length && steps.push({ text: `In game, <b>${verb}</b> ${names(ps)}`, copy: cp, done: ps.every(isDone),
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
    auto(k, 'kick'); auto(d, 'demote'); auto(pr, 'promote to Elder', copy('Promotions'));
    players(rv, 'Review', `<b>Decide with the other leaders</b> ${names(rv)}`, '');
    if (k.length || d.length || pr.length) posted('RESULTS', 'Post the <b>results</b> in clan chat', copy('Results'));
    players(w, 'Warn', `Post the <b>first &amp; only warnings</b> ${names(w)}`, copy('First & only'));
    if (w.length) posted('BOATS', 'Post the <b>boat attack tip</b>', copy('Boat'));
    posted('RECAP', 'Post the <b>war recap</b> (optional)', copy('Recap'));
    posted('SEASON', 'Post the <b>season recap</b> (optional, last war of the season)', copy('Season'));
    players(c, 'Check', `Post the <b>check-in</b> ${names(c)}`, copy('Check'));
  } else if (mode === 'live') {
    const free = list.filter(p => p.res.status === 'Out' && !p.gone && p.res.today === 0);
    if (free.length) steps.push({ text: `Optional: <b>kick now</b> to free battle slots (can't reach ${rules().target}, no decks today) ${names(free)}`, tick: '<span class="tickbox auto"></span>' });
    const left = list.filter(p => !p.gone && p.res.today < 4).sort((a, b) => a.res.today - b.res.today);
    if (left.length) posted('DECKS-' + day, `Remind who still has <b>decks to play today</b> ${names(left)}`, copy('Decks left'));
    posted('REMIND-' + day, 'Post the <b>reminder</b> for players who still need medals', copy('Still need'));
  }
  box.classList.toggle('hidden', !(mode === 'live' ? steps.length : latest));
  syncMsgBox();
  const left = steps.filter(x => !x.done).length;
  box.innerHTML = `<div class="steps-head">Recommended <span class="count">${steps.length ? `${steps.length - left} of ${steps.length} done` : ''}</span></div>` + (steps.length
    ? `<ul>${steps.map(x => `<li class="${x.done ? 'is-done' : ''}">${x.tick || ''}<div class="step-text">${x.text}${x.copy
        ? (x.done ? `<details class="stepmsgs"><summary>Message${(x.copy.match(/class="stepmsg"/g) || []).length > 1 ? 's' : ''}</summary>${x.copy}</details>` : `<div class="stepmsgs">${x.copy}</div>`) : ''}</div></li>`).join('')}</ul>
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

let _cal = { key: null, val: null };
function renderStats() {
  const box = $('#statsbody');
  if (!$('#statsbox').open) return;   // worked out only when someone opens it
  if (!model) { box.innerHTML = '<div class="empty">Load a clan to see stats</div>'; return; }
  const r = rules(), parts = [];
  // 1. Clan medals and pass rate per war (from the war log, all members who took part)
  const byWeek = {};
  for (const x of data.log || []) { const k = x.season_key; (byWeek[k] ||= []).push({ fame: +x.player_fame || 0, decks: +x.player_decks_used || 0 }); }
  const weeks = Object.keys(byWeek).sort(weekCmp);
  const wars = Object.fromEntries((hist?.wars || []).map(w => [w.week, w]));
  const place = n => n > 0 ? ['1st', '2nd', '3rd', '4th', '5th'][n - 1] || n + 'th' : '';
  const ser = weeks.map(k => { const ps = byWeek[k].filter(p => p.decks > 0); return { week: k, medals: ps.reduce((s, p) => s + p.fame, 0), played: ps.length, passed: ps.filter(p => p.fame >= r.target).length, w: wars[k] }; });
  if (ser.length) {
    const step = Math.ceil(ser.length / 6), showAt = i => i % step === 0 && (ser.length - 1 - i >= step || i === ser.length - 1) || i === ser.length - 1;
    parts.push(`<h3>Clan medals per war</h3>` + bars(ser.map((x, i) => ({ label: x.week, value: x.medals, show: showAt(i),
      title: `War ${x.week}: ${x.medals.toLocaleString()} medals${x.w && x.w.rank ? ', ' + place(x.w.rank) + ' place' : ''}${x.w && x.w.trophy_change ? ', ' + (x.w.trophy_change > 0 ? '+' : '') + x.w.trophy_change + ' trophies' : ''}` })), { label: 'Clan medals per war, oldest to newest' })
      + (() => { const last = ser[ser.length - 1], avg = Math.round(ser.reduce((t, x) => t + x.medals, 0) / ser.length);
        return `<div class="hint">Last war ${last.week}: <b>${last.medals.toLocaleString()}</b> medals${last.w && last.w.rank ? ', ' + place(last.w.rank) + ' place' : ''} · average ${avg.toLocaleString()} over ${ser.length} wars</div>`; })());
    parts.push(`<h3>Members reaching ${r.target}+ per war</h3>` + bars(ser.map((x, i) => ({ label: x.week, value: x.played ? Math.round(100 * x.passed / x.played) : 0, show: showAt(i),
      title: `War ${x.week}: ${x.passed} of ${x.played} (${x.played ? Math.round(100 * x.passed / x.played) : 0}%)` })), { label: 'Percent of members reaching the target, per war' })
      + (() => { const last = ser[ser.length - 1], pct = x => x.played ? Math.round(100 * x.passed / x.played) : 0, avg = Math.round(ser.reduce((t, x) => t + pct(x), 0) / ser.length);
        return `<div class="hint">Last war: <b>${last.passed} of ${last.played}</b> (${pct(last)}%) · average ${avg}%</div>`; })());
  }
  // Seasons: total medals and placings per season
  const sids = [...new Set(weeks.map(k => k.split('-')[0]))];
  const seas = sids.map(sid => seasonSummary(data.log || [], hist?.wars, sid, r.target)).filter(Boolean);
  if (seas.length) {
    const pl = n => n ? ['1st', '2nd', '3rd', '4th', '5th'][n - 1] || n + 'th' : '–';
    parts.push(`<h3>Seasons</h3><table class="tbl">${seas.reverse().map(x => `<tr><td>Season ${esc(x.season)}${x.complete ? '' : ' (so far)'}</td><td class="num">${x.medals.toLocaleString()}</td><td class="muted">placings ${x.placings.map(p => pl(p.rank)).join(', ')} · top ${esc(cleanName(x.top[0]?.name || '–'))} · ${x.perfect.length} at ${r.target}+ every war</td></tr>`).join('')}</table>`);
  }
  // 2. Reliability ranking (current members)
  const rel = model.players.filter(p => !p.gone).map(p => ({ p, r: reliability(p, r.target, r.lookback) })).filter(x => x.r).sort((a, b) => b.r.score - a.r.score);
  if (rel.length) {
    const row = x => `<tr><td>${esc(x.p.name)}</td><td class="num">${x.r.score}</td><td class="muted">${Math.round(x.r.hit * 100)}% wars at target · avg ${x.r.avg.toLocaleString()}</td></tr>`;
    parts.push(`<h3>Most reliable</h3><table class="tbl">${rel.slice(0, 10).map(row).join('')}</table>`);
    if (rel.length > 15) parts.push(`<h3>Least reliable</h3><table class="tbl">${rel.slice(-5).reverse().map(row).join('')}</table>`);
    parts.push(`<div class="hint">Reliability (0–100): 40% wars at target, 30% decks used, 20% medals vs target, 10% recent trend. Last ${r.lookback} wars.</div>`);
  }
  // 3. Battle types, whole clan
  const ms = modeStats(hist?.battles || []), modes = [['duel', 'Duels'], ['pvp', '1v1'], ['boat', 'Boat attacks']].filter(([k]) => ms[k].games);
  parts.push(`<h3>War battles by type</h3>` + (modes.length ? `<table class="tbl">${modes.map(([k, n]) => `<tr><td>${n}</td><td class="num">${ms[k].won}W–${ms[k].lost}L</td><td class="muted">${Math.round(ms[k].rate * 100)}% won · ~${Math.round(ms[k].perDeck)} medals per deck</td></tr>`).join('')}</table>
    <div class="hint">From players' battle logs, read a few at a time. Duel games pay 250/100, 1v1 200/100, boats 125/75.</div>` : '<div class="empty">Collecting from battle logs on battle days</div>'));
  // 4. When the clan plays (UK time)
  const pt = playTimes(hist?.raceEvents || []);
  parts.push(`<h3>When the clan plays (UK time)</h3>` + (pt.total >= 10
    ? bars(pt.hours.map((v, h) => ({ label: String(h).padStart(2, '0'), value: v, show: h % 6 === 0, title: `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00: ${v} decks` })), { label: 'War decks played by hour of day, UK time' })
      + `<div class="hint">Busiest 4 hours: ${String(pt.window.from).padStart(2, '0')}:00–${String(pt.window.to).padStart(2, '0')}:00 (${Math.round(pt.window.share * 100)}% of ${pt.total} decks). Remind people just before.</div>`
    : '<div class="empty">Collecting on battle days (timed to within 15 minutes)</div>'));
  // Forecast accuracy, rerun on past battle days with only what was known then
  const done = new Set((hist?.wars || []).map(w => w.week));
  const ck = [[...done].join(','), (hist?.days || []).filter(d => done.has(d.week)).length, (hist?.notes || []).filter(n => n.kind === 'join').length, r.target, r.lookback, r.perDay].join('|');
  if (_cal.key !== ck) _cal = { key: ck, val: calibrate(hist, r.target, r.lookback, r.perDay) };
  const cal = _cal.val;
  parts.push(`<h3>How accurate the forecasts are</h3>` + (cal
    ? `<p class="why">Right <b>${Math.round(cal.accuracy * 100)}%</b> of the time: said “will make it” and they did, or “won't” and they didn't (${cal.n} forecasts over ${cal.wars} war${cal.wars === 1 ? '' : 's'}).</p>
       <table class="tbl">${Object.entries(cal.bands).filter(([, b]) => b.n).map(([k, b]) => `<tr><td>Said “${k}”</td><td class="num">${Math.round(100 * b.hit / b.n)}%</td><td class="muted">made ${r.target} (${b.hit} of ${b.n})</td></tr>`).join('')}</table>
       <div class="hint">By battle day: ${cal.byDay.filter(d => d.n).map(d => `day ${d.day} ${Math.round(d.right * 100)}% right`).join(' · ')}. Rerun on past battle days using only what was known at the time. ${cal.brier < cal.baseline ? 'Better than guessing from the usual pass rate.' : 'Not yet better than guessing from the usual pass rate: needs more wars.'}</div>`
    : `<div class="empty">${hist ? 'First check after the current war ends (needs a war with battle-day data)' : 'Needs the hosted site with history'}</div>`));
  // 5. Donations this week
  const don = model.players.filter(p => !p.gone && p.donations != null).sort((a, b) => b.donations - a.donations);
  if (don.length) parts.push(`<h3>Top donors this week</h3><table class="tbl">${don.slice(0, 5).map(p => `<tr><td>${esc(p.name)}</td><td class="num">${p.donations}</td><td class="muted">received ${p.received ?? 0}</td></tr>`).join('')}</table>`);
  // 6. Inactive outside war
  const idle = model.players.filter(p => !p.gone && p.offlineDays != null && p.offlineDays >= 7).sort((a, b) => b.offlineDays - a.offlineDays);
  parts.push(`<h3>Offline 7+ days</h3>` + (idle.length ? `<table class="tbl">${idle.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${Math.floor(p.offlineDays)} days</td><td></td></tr>`).join('')}</table>` : '<div class="empty">Nobody</div>'));
  // Headline tiles and plain-language findings, worked out from the same data.
  const last = ser[ser.length - 1], pct = x => x && x.played ? Math.round(100 * x.passed / x.played) : 0;
  const tiles = [];
  if (last) {
    tiles.push([last.w && last.w.rank ? place(last.w.rank) : '–', `place in war ${last.week}` + (last.w && last.w.trophy_change ? ` (${last.w.trophy_change > 0 ? '+' : ''}${last.w.trophy_change} trophies)` : '')]);
    tiles.push([`${last.passed}/${last.played}`, `reached ${r.target}+ (${pct(last)}%)`]);
    tiles.push([last.played ? Math.round(last.medals / last.played).toLocaleString() : '–', 'average medals per player']);
  }
  if (ms.duel.games >= 5) tiles.push([`${Math.round(ms.duel.rate * 100)}%`, 'of duel games won']);
  const finds = [];
  if (ser.length >= 6) {
    const a = ser.slice(-3), b = ser.slice(-6, -3), pa = Math.round(a.reduce((t, x) => t + pct(x), 0) / 3), pb = Math.round(b.reduce((t, x) => t + pct(x), 0) / 3);
    if (Math.abs(pa - pb) >= 3) finds.push(`${pa > pb ? '📈' : '📉'} Members reaching ${r.target} is ${pa > pb ? 'up' : 'down'}: ${pa}% over the last 3 wars, from ${pb}% before.`);
  }
  const strugglers = model.players.filter(p => !p.gone).map(p => ({ p, miss: p.weeks.slice(0, 5).filter(w => w.fame < r.target).length, n: Math.min(5, p.weeks.length) })).filter(x => x.n >= 3 && x.miss >= 3).sort((a, b) => b.miss - a.miss);
  if (strugglers.length) finds.push(`⚠️ Missing most wars: ${strugglers.slice(0, 4).map(x => `${esc(x.p.name)} (${x.miss} of last ${x.n})`).join(', ')}.`);
  if (ms.duel.games >= 5 && ms.pvp.games >= 5 && ms.duel.perDeck - ms.pvp.perDeck >= 15)
    finds.push(`⚔️ Duels earn ~${Math.round(ms.duel.perDeck - ms.pvp.perDeck)} more medals per deck than 1v1 for this clan. Encourage duels first.`);
  if (ms.boat.games >= 5 && ms.boat.perDeck < Math.max(ms.duel.perDeck || 0, ms.pvp.perDeck || 0) - 15)
    finds.push(`🚤 Boat attacks average ~${Math.round(ms.boat.perDeck)} per deck, the lowest of the three.`);
  if (pt.total >= 10) finds.push(`🕒 Most war decks are played ${String(pt.window.from).padStart(2, '0')}:00–${String(pt.window.to).padStart(2, '0')}:00 UK. Remind people just before.`);
  if (cal && cal.bands.Likely.n >= 10) finds.push(`🎯 Forecasts: players rated “Likely” reached ${r.target} ${Math.round(100 * cal.bands.Likely.hit / cal.bands.Likely.n)}% of the time.`);
  if (rel.length) finds.push(`⭐ Most reliable: ${rel.slice(0, 3).map(x => esc(x.p.name)).join(', ')}.`);
  const imp = model.players.filter(p => !p.gone && p.cur && p.prev && p.cur.decks).map(p => ({ p, d: p.cur.fame - p.prev.fame })).sort((a, b) => b.d - a.d)[0];
  if (imp && imp.d >= 300) finds.push(`🚀 Most improved last war: ${esc(imp.p.name)} (+${imp.d.toLocaleString()}).`);
  if (idle.length) finds.push(`💤 Offline 7+ days: ${idle.slice(0, 4).map(p => esc(p.name)).join(', ')}.`);
  box.innerHTML = (tiles.length ? `<div class="tiles">${tiles.map(([v, l]) => `<div class="tile"><div class="tv">${esc(v)}</div><div class="tl">${esc(l)}</div></div>`).join('')}</div>` : '')
    + (finds.length ? `<h3>What stands out</h3><ul class="finds">${finds.map(f => `<li>${f}</li>`).join('')}</ul>` : '')
    + `<details class="more-stats"><summary>Charts and tables</summary>${parts.join('')}</details>`;
}

let explainTexts = [];
function renderExplain() {
  const { sections, chat } = rulesExplained(rules(), { discord: site.discord });
  explainTexts = chat;
  $('#explain').innerHTML = sections.map(([h, ps]) => `<h3>${h}</h3>${ps.filter(Boolean).map(x => `<p>${x}</p>`).join('')}`).join('')
    + `<h3>Post in clan chat</h3>${chat.map((t, i) => `<div class="card"><b>Part ${i + 1} of ${chat.length}<span class="cnt">${t.length}/${rules().chatLimit}</span></b><div class="quote">${esc(t)}</div><button class="copybtn" data-explain="${i}">Copy</button></div>`).join('')}
       <div class="hint">Written from the current rules, so it updates if a rule changes.</div>
       <h3>Clan description (in game, 128 characters)</h3>
       <input id="descextra" class="grow" placeholder="Add something, e.g. your Discord link (optional)" aria-label="Extra text for the clan description" value="${esc(get('cr-war-audit:descextra', ''))}">
       <div id="desccards"></div>`;
  renderDesc();
}
let descTexts = [];
function renderDesc() {
  const box = $('#desccards'); if (!box) return;
  descTexts = clanDescriptions(rules(), $('#descextra')?.value || '');
  box.innerHTML = descTexts.map((t, i) => `<div class="card"><b>${i ? 'Shorter' : 'Most detail'}<span class="cnt">${t.length}/128</span></b><div class="quote">${esc(t)}</div><button class="copybtn" data-desc="${i}">Copy</button></div>`).join('')
    + '<div class="hint">Clan → Edit → Description. If the game cuts it off, use a shorter one (emoji can count as 2).</div>';
}
document.addEventListener('input', e => { if (e.target.id === 'descextra') { put('cr-war-audit:descextra', e.target.value); renderDesc(); } });

function renderLog() {
  if (!model?.history) { $('#log').innerHTML = `<div class="empty">${site.history ? 'Nothing yet' : 'This site has no history'}</div>`; return; }
  const h = model.history, words = { join: 'joined', leave: 'left', role: 'role' };
  const ev = h.events.map(e => `<div class="ev"><span class="when">${esc(fmtDate(parseTime(e.at)))}</span> <b>${esc(cleanName(e.name) || e.tag)}</b> ${
    e.kind === 'role' ? esc(String(e.detail).replace('>', ' → ')) : words[e.kind] || esc(e.kind)}</div>`).join('');
  const names = Object.fromEntries((hist.members || []).map(m => [m.tag, cleanName(m.name)]));
  const what = n => n.kind === 'done' ? (n.value ? 'ticked done' : 'unticked') : n.kind === 'over' ? (n.value ? `changed to ${label(n.value)}` : 'reset to suggested')
    : n.kind === 'join' ? `set join day: ${n.value || 'auto'}` : n.kind === 'rules' ? 'saved the rules' : n.kind === 'away' ? (n.value ? `away (${(() => { const x = parseAway(n.value); return x ? awayText(x) : ''; })()})` : 'back') : n.kind;
  const who = (hist.noteLog || []).filter(n => n.by).slice(0, 15).map(n => `<div class="ev"><span class="when">${esc(fmtDate(parseTime(n.at)))}</span> <b>${esc(n.by)}</b> ${esc(what(n))}${
    n.tag && n.tag !== '*' ? ' · ' + esc(names[n.tag] || (n.tag.startsWith('STEP-') ? n.tag.slice(5).toLowerCase() + ' step' : n.tag)) : ''}${n.week && n.week !== '*' ? ` <span class="muted">(war ${esc(n.week)})</span>` : ''}</div>`).join('');
  $('#log').innerHTML = `<div class="hint">${h.weeks} wars stored${h.since ? ' · tracking since ' + esc(fmtDate(h.since)) : ''}</div>${ev || '<div class="empty">No joins or leaves yet</div>'}`
    + (who ? `<div class="hint" style="margin-top:12px">Leader changes</div>${who}` : '');
}

function fit(el) { (el ? [el] : document.querySelectorAll('textarea')).forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }); }

function renderRules() {
  const r = rules(), groups = {};
  for (const [k, spec] of Object.entries(RULE_SPEC)) (groups[spec.group] ||= []).push([k, spec]);
  const changed = k => r[k] !== DEFAULT_RULES[k];
  $('#rules').innerHTML = Object.entries(groups).map(([g, items]) => `<fieldset class="rgroup"><legend>${esc(g)}</legend>${items.map(([k, spec]) => typeof DEFAULT_RULES[k] === 'boolean'
    ? `<label class="rule"><span>${esc(spec.label)}</span><input type="checkbox" role="switch" class="switch" data-rule="${k}" ${r[k] ? 'checked' : ''}></label>`
    // Short ranges (days, wars, %) get a slider; medal amounts keep − / + for precision.
    : spec.unit !== 'medals' && (spec.max - spec.min) / spec.step <= 30
      ? `<div class="rule slide"><span>${esc(spec.label)}<small>${spec.min}–${spec.max} ${esc(spec.unit)}${changed(k) ? ` · default ${DEFAULT_RULES[k]}` : ''}</small></span>
          <span class="sl"><input type="range" data-rule="${k}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${r[k]}" aria-label="${esc(spec.label)}"><output id="o-${k}">${r[k]}${spec.unit === '%' ? '%' : ''}</output></span></div>`
    : `<div class="rule"><span>${esc(spec.label)}<small>${spec.min.toLocaleString()}–${spec.max.toLocaleString()} ${esc(spec.unit)}${changed(k) ? ` · default ${DEFAULT_RULES[k].toLocaleString()}` : ''}</small></span>
        <span class="stepper"><button type="button" data-step="${k}" data-dir="-1" aria-label="Less" ${r[k] <= spec.min ? 'disabled' : ''}>−</button>
        <input type="number" inputmode="numeric" data-rule="${k}" value="${r[k]}" min="${spec.min}" max="${spec.max}" step="${spec.step}" aria-label="${esc(spec.label)}">
        <button type="button" data-step="${k}" data-dir="1" aria-label="More" ${r[k] >= spec.max ? 'disabled' : ''}>+</button></span></div>`).join('')}</fieldset>`).join('')
    + (ruleProblems(r).length ? `<div class="rprob">${ruleProblems(r).map(x => `<div>⚠️ ${esc(x)}</div>`).join('')}</div>` : '');
  // Changes apply straight away on this device; "Save for everyone" shares them.
  const mine = Object.keys(local.rules).filter(k => RULE_SPEC[k]);
  $('#rulenote').innerHTML = mine.length
    ? `<b>${mine.length} change${mine.length === 1 ? '' : 's'} on this device only</b> (${mine.map(k => esc(RULE_SPEC[k].label.toLowerCase())).join('; ')}). They apply here straight away.${codeOk ? ' Save them so every leader uses them.' : ''}`
    : 'Changes apply straight away. With the leader code you can save them for every leader.';
  $('#rulenote').classList.toggle('pending', mine.length > 0);
  $('#leader').classList.toggle('hidden', !site.edit);
  $('#saverules').classList.toggle('hidden', !codeOk);
  $('#discordrow').classList.toggle('hidden', !(codeOk && site.discord));
  $('#importrow').classList.toggle('hidden', !(codeOk && site.history));
  $('#codehint').textContent = codeOk ? `Leader code accepted${leaderName && leaderName !== 'Leader' ? ' (' + leaderName + ')' : ''}. Changes are saved for everyone. Remembered on this device.` : 'With the leader code, your changes are saved for everyone.';
}

// Set one rule, corrected to its allowed range, and say if it had to be changed.
function setRule(k, v) {
  const typed = typeof DEFAULT_RULES[k] === 'boolean' ? !!v : Number(v);
  const { rules: fixed } = sanitizeRules({ ...rules(), [k]: typed });
  local.rules[k] = fixed[k]; saveLocal(); render();
  const spec = RULE_SPEC[k];
  if (typeof typed === 'number' && fixed[k] !== typed) say(`${spec.label}: must be ${spec.min.toLocaleString()}–${spec.max.toLocaleString()} ${spec.unit} (steps of ${spec.step}). Set to ${fixed[k].toLocaleString()}.`, true);
  else say(codeOk ? 'Changed here. Tap "Save rules for everyone" to share.' : 'Saved on this device');
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
    if (r.ok) leaderName = (await r.json().catch(() => ({}))).by || 'Leader';
    return r.ok;
  } catch (e) { return false; }
}

function exportMd() {
  if (!model) return;
  const list = evaluate(), r = rules();
  const md = [`# War audit: ${model.clan.name} #${model.clan.tag} · ${contextLine()}`, '',
    '| Player | Role | Result | Why |', '|---|---|---|---|',
    ...list.map(p => `| ${p.name} | ${p.role} | ${label(p.res.status)} | ${p.res.why || ''} |`),
    '', '## Chat', '', ...(mode === 'end' ? chatEnd(list, r) : chatLive(list, r, liveOpts())).map(m => '```\n' + m.text + '\n```'),
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
  if (codeOk) $('#code').value = '';   // nothing left in the box, so the browser has no "password" to offer to save
  say(codeOk ? 'Leader code accepted' : 'Wrong leader code', !codeOk); render(); renderNotify();
};
$('#discordreg').onclick = async () => {
  $('#discordmsg').textContent = 'Registering…';
  try {
    const r = await fetch('api/discord/register', { method: 'POST', headers: { 'X-Edit-Key': settings.code } });
    const j = await r.json();
    $('#discordmsg').textContent = r.ok ? `Done: ${j.registered} commands in ${j.where}.` : 'Failed: ' + (j.reason || r.status);
  } catch (e) { $('#discordmsg').textContent = "Couldn't reach the site"; }
};
$('#saverules').onclick = async () => {
  // Save only what differs from the defaults, so future default changes still apply.
  const cur = rules(), diff = Object.fromEntries(Object.keys(DEFAULT_RULES).filter(k => cur[k] !== DEFAULT_RULES[k]).map(k => [k, cur[k]]));
  const ok = await postNotes([{ week: '*', tag: '*', kind: 'rules', value: JSON.stringify(diff) }]);
  if (ok) { local.rules = {}; saveLocal(); }
  say(ok ? 'Rules saved for everyone' : 'Saving failed', !ok); render();
};
document.addEventListener('click', e => {
  const dz = e.target.closest('[data-desc]');
  if (dz) return copyText(descTexts[+dz.dataset.desc], dz);
  const ex = e.target.closest('[data-explain]');
  if (ex) return copyText(explainTexts[+ex.dataset.explain], ex);
  const st = e.target.closest('[data-step]');
  if (st) { const k = st.dataset.step; return setRule(k, rules()[k] + RULE_SPEC[k].step * Number(st.dataset.dir)); }
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
  if (el.dataset.rule) setRule(el.dataset.rule, el.type === 'checkbox' ? el.checked : el.value);
});
document.addEventListener('input', e => {
  if (e.target.type === 'range' && e.target.dataset.rule) { const k = e.target.dataset.rule; $('#o-' + k).textContent = e.target.value + (RULE_SPEC[k].unit === '%' ? '%' : ''); return; }
  if (e.target.dataset.i == null) return;
  const n = e.target.value.length, c = $('#c' + e.target.dataset.i), lim = rules().chatLimit;
  c.textContent = `${n}/${lim}`; c.classList.toggle('over', n > lim); fit(e.target);
});
window.addEventListener('resize', () => fit());
$('#reset').onclick = () => { local.rules = {}; saveLocal(); render(); say('Back to the clan\'s saved rules'); };
$('#export').onclick = exportMd;

// ---- Spreadsheet (CSV) export: opens in Excel, Numbers or Google Sheets ----
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function downloadCSV(name, rows) {
  const text = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click();
}
$('#csvwar').onclick = () => {
  if (!model) return say('Load a clan first', true);
  const list = evaluate(), live = mode === 'live';
  downloadCSV(`${model.clan.tag}-${live ? 'war-' + (raceInfo.week || 'live') : 'war-' + model.season}.csv`, [
    live ? ['Player', 'Tag', 'Role', 'Medals', 'Decks today', 'Still needs', 'Result', 'Forecast %']
         : ['Player', 'Tag', 'Role', 'Medals', 'Decks', 'Boat attacks', 'Wars at target (recent)', 'Result', 'Reason'],
    ...list.filter(p => showGone || !p.gone).map(p => live
      ? [p.name, '#' + p.tag, p.roleNow || p.role, p.res.fame, p.res.today, p.res.need, label(p.res.status), p.fc ? Math.round(p.fc.prob * 100) : '']
      : [p.name, '#' + p.tag, p.roleNow || p.role, p.cur?.fame ?? '', p.cur?.decks ?? '', p.cur?.boats ?? '', `${recent(p, rules()).length - missCount(p, rules())}/${recent(p, rules()).length}`, label(p.res.status), p.res.why || '']),
  ]);
};
$('#csvall').onclick = () => {
  if (!data.log?.length) return say('Load a clan first', true);
  const rows = [...data.log].sort((a, b) => weekCmp(b.season_key, a.season_key) || (+b.player_fame) - (+a.player_fame));
  downloadCSV(`${model?.clan.tag || 'clan'}-all-wars.csv`, [['War', 'Player', 'Tag', 'Medals', 'Decks', 'Boat attacks'],
    ...rows.map(r => [r.season_key, cleanName(r.player_name), '#' + cleanTag(r.player_tag), r.player_fame, r.player_decks_used, r.player_boat_attacks])]);
};
$('#backup').onclick = async () => {
  const t = model?.clan.tag || cleanInputTag();
  try {
    const r = await fetch('api/history?all=1&clan=' + t);
    if (!r.ok) throw 0;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([await r.text()], { type: 'application/json' }));
    a.download = `clan-history-${t}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  } catch (e) { say('Backup needs the hosted site with history', true); }
};

// ---- Installable app + notifications (leaders only) ----
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let swReg = null;
async function pushState() {
  if (!swReg || !('PushManager' in window)) return null;
  return swReg.pushManager.getSubscription();
}
async function renderNotify() {
  const box = $('#notify');
  const show = site.history && codeOk && 'serviceWorker' in navigator;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const btn = $('#notifybtn'), text = $('#notifytext');
  if (isIOS && !installed()) { text.textContent = '🔔 For alerts on iPhone: Share → Add to Home Screen, then open it from there.'; btn.classList.add('hidden'); return; }
  if (!('PushManager' in window) || !('Notification' in window)) { text.textContent = '🔔 This browser can’t show notifications.'; btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  const sub = await pushState();
  text.textContent = sub ? '🔔 Alerts on for this device' : '🔔 Get alerts: joins/leaves, war ended, day 4 at risk';
  btn.textContent = sub ? 'Turn off' : 'Turn on';
}
async function toggleNotify() {
  const btn = $('#notifybtn'); btn.disabled = true;
  try {
    const sub = await pushState();
    if (sub) {
      await fetch('api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    } else {
      if (await Notification.requestPermission() !== 'granted') { $('#notifytext').textContent = '🔔 Notifications are blocked. Allow them in your browser settings.'; return; }
      const { key } = await (await fetch('api/push/key')).json();
      const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4)), c => c.charCodeAt(0));
      const s2 = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
      const r = await fetch('api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Edit-Key': settings.code }, body: JSON.stringify({ clan: model?.clan.tag || settings.tag, subscription: s2.toJSON() }) });
      if (!r.ok) { await s2.unsubscribe().catch(() => {}); throw new Error('subscribe'); }
      await (await caches.open('war-audit-meta')).put('/__clan', new Response(model?.clan.tag || settings.tag));
      await fetch('api/push/test', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Edit-Key': settings.code }, body: JSON.stringify({ clan: model?.clan.tag || settings.tag }) });
    }
  } catch (e) { $('#notifytext').textContent = '🔔 Couldn’t turn on alerts. Try again.'; btn.disabled = false; return; }
  btn.disabled = false; renderNotify();
}
$('#notifybtn').onclick = toggleNotify;
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; renderNotify(); }).catch(() => {});
}

// ---- Install as an app ----
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; renderInstall(); });
function renderInstall() {
  const box = $('#install'), btn = $('#installbtn'), text = $('#installtext');
  if (installed()) { box.classList.add('hidden'); return; }
  if (installEvt) { text.textContent = '📲 Use this as an app on your phone'; btn.classList.remove('hidden'); box.classList.remove('hidden'); return; }
  if (isIOS) { text.textContent = '📲 To use as an app: tap Share, then Add to Home Screen'; btn.classList.add('hidden'); box.classList.remove('hidden'); return; }
  box.classList.add('hidden');
}
$('#installbtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; renderInstall(); };
renderInstall();

// ---- Help: small ? buttons next to section titles open a short explanation underneath ----
const HELP = {
  act: 'What to do after each war, in order. Tap a circle when a step is done: kicks, demotions and promotions tick themselves once the game shows them. Tap a name for their history and battle record, or to change the suggestion. On battle days, <b>This war</b> shows who still has decks to play, forecasts and the race.',
  chat: 'Every clan chat message in one list (each within the 256-character limit). The same messages also sit inside their steps under Recommended.',
  rules: 'The numbers behind every suggestion. Leaders: enter the <b>leader code</b> here so your ticks and changes are shared with the other leaders, then turn on <b>🔔 alerts</b> at the top.',
  stats: 'Medals and pass rate per war, the most and least reliable players, battle types, when the clan plays (UK time), top donors and who has been offline.',
};
document.addEventListener('click', e => {
  const b = e.target.closest('.q[data-help]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();   // inside a <summary>: don't open or close the section
  const head = b.closest('h2, summary'), box = head.closest('.step');
  let tip = box.querySelector(':scope > .helptip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'helptip'; tip.innerHTML = HELP[b.dataset.help]; head.after(tip); b.setAttribute('aria-expanded', 'true'); }
  else { tip.remove(); b.setAttribute('aria-expanded', 'false'); }
}, true);

// ---- Import older wars (RoyaleAPI "War log" or "War history" CSV exports): adds only wars the tracker doesn't have ----
$('#importfile').addEventListener('change', async e => {
  const msg = $('#importmsg'), rows = [];
  for (const f of e.target.files) {
    const r = parseCSV(await f.text()), kind = detect(r);
    const log = kind === 'log' ? r : kind === 'history' ? historyToLog(r) : [];
    for (const x of log) rows.push({ week: x.season_key, tag: cleanTag(x.player_tag), name: cleanName(x.player_name), fame: +x.player_fame || 0, decks: +x.player_decks_used || 0, boats: x.player_boat_attacks === '' ? null : +x.player_boat_attacks || 0 });
  }
  e.target.value = '';
  if (!rows.length) { msg.textContent = 'No war rows found. Use RoyaleAPI\'s War log or War history export.'; return; }
  msg.textContent = 'Importing…';
  try {
    const r = await fetch('api/import?clan=' + (model?.clan.tag || cleanInputTag()), { method: 'POST', headers: { 'content-type': 'application/json', 'X-Edit-Key': settings.code }, body: JSON.stringify({ rows }) });
    const j = await r.json();
    if (!r.ok) { msg.textContent = 'Failed: ' + (j.reason || r.status); return; }
    msg.textContent = j.imported.length
      ? `Added ${j.imported.length} older war${j.imported.length === 1 ? '' : 's'} (${j.imported[0]} to ${j.imported[j.imported.length - 1]}).` + (j.skipped.length ? ` ${j.skipped.length} already tracked, left as they were.` : '')
      : `Nothing new: all ${j.skipped.length} wars in the file are already tracked.`;
    if (j.imported.length) pull();
  } catch (err) { msg.textContent = "Couldn't import. Try again."; }
});

// ---- Check a player (recruits) ----
async function checkPlayer() {
  const t = $('#ptag').value.trim().toUpperCase().replace(/^#/, '').replace(/O/g, '0'), out = $('#pout');
  if (!VALID_TAG.test(t)) { out.textContent = 'Check the player tag'; return; }
  const viaSite = !settings.key && site.key;
  const call = path => fetch((viaSite ? 'api/v1' : PROXY) + '/players/' + encodeURIComponent('#' + t) + path, viaSite ? {} : { headers: { Authorization: 'Bearer ' + settings.key } })
    .then(r => r.ok ? r.json() : Promise.reject(r.status));
  out.textContent = 'Checking…';
  try {
    const [pl, log] = await Promise.all([call(''), call('/battlelog').catch(() => [])]);
    const wars = (Array.isArray(log) ? log : []).filter(b => /^riverRace|^boatBattle/.test(b.type || ''));
    let won = 0, lost = 0, boats = 0;
    for (const b of wars) {
      if (b.type === 'boatBattle') { boats++; continue; }
      const me = b.team?.[0] || {}, op = b.opponent?.[0] || {};
      if (me.rounds && op.rounds) me.rounds.forEach((x, i) => x.crowns > (op.rounds[i]?.crowns ?? 0) ? won++ : lost++);
      else me.crowns > op.crowns ? won++ : lost++;
    }
    const last = log && log[0] ? parseTime(log[0].battleTime) : null;
    const rows = [
      ['Name', `${cleanName(pl.name)} (level ${pl.expLevel})`],
      ['Clan', pl.clan ? `${cleanName(pl.clan.name)} (${ROLE[pl.role] || 'Member'})` : 'No clan'],
      ['Trophies', `${pl.trophies} (best ${pl.bestTrophies})`],
      ['War day wins, all time', pl.warDayWins ?? '–'],
      ['Clan cards collected', pl.clanCardsCollected ?? '–'],
      ['Donations, all time', pl.totalDonations ?? '–'],
      ['Recent war battles', wars.length ? `${won}W–${lost}L${boats ? `, ${boats} boat attacks` : ''} (from last 25 battles)` : 'None in last 25 battles'],
      ['Last battle', last ? `${fmtDate(last)} ${fmtTime(last)}` : '–'],
    ];
    out.innerHTML = `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
  } catch (e) { out.textContent = e === 404 ? 'Player not found' : viaSite || settings.key ? "Couldn't load that player" : 'Needs the hosted site or your own key'; }
}
$('#pcheck').onclick = checkPlayer;
$('#statsbox').addEventListener('toggle', () => renderStats());
$('#ptag').addEventListener('keydown', e => { if (e.key === 'Enter') checkPlayer(); });

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
  if (settings.code) { settings.tag ||= cleanInputTag(); codeOk = await checkCode(settings.code); $('#code').value = ''; }
  renderRules();
  if ((settings.key || site.key) && VALID_TAG.test(cleanInputTag())) pull();
})();
