// ---- Members' page: one player's own numbers (no leader notes, no other players) ----
const $ = s => document.querySelector(s);
const say = (m, err) => { $('#status').textContent = m; $('#status').classList.toggle('err', !!err); };
const place = n => ['1st', '2nd', '3rd', '4th', '5th'][n - 1] || n + 'th';

async function show() {
  const tag = $('#tag').value.trim().toUpperCase().replace(/^#/, '').replace(/O/g, '0');
  if (!VALID_TAG.test(tag)) return say('Check your player tag', true);
  say('Loading…');
  try {
    const r = await fetch('api/member?tag=' + tag, { cache: 'no-store' });
    if (r.status === 404) return say("That tag isn't in the clan", true);
    if (!r.ok) throw 0;
    const m = await r.json();
    put('cr-war-audit:me', tag); history.replaceState(null, '', '#' + tag);
    say('');
    render(m);
  } catch (e) { say("Couldn't load. Try again.", true); }
}

function render(m) {
  const r = { ...DEFAULT_RULES, ...(m.rules || {}) };
  const weeks = m.weeks.map(w => ({ key: w.week, fame: w.fame, decks: w.decks, boats: w.boats })).sort((a, b) => weekCmp(b.key, a.key));
  const p = { tag: m.tag, name: cleanName(m.name), weeks, before: weeks };
  const cards = [];

  // This war
  const days = m.war?.days || [], today = days[days.length - 1];
  if (m.war && m.war.day) {
    const fame = today?.fame ?? 0, used = today && today.day === m.war.day ? today.today : 0, left = 4 - used, need = Math.max(0, r.target - fame);
    const fc = need ? forecast({ tag: m.tag, weeks }, { target: r.target, day: m.war.day, leftToday: left, fame, lookback: r.lookback, clan: { use: 0.8, perDeck: 150, sd: 25 } }) : null;
    const reset = m.resetAt ? new Date(parseTime(m.resetAt)).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    cards.push(`<section class="step"><h2>This war · battle day ${m.war.day} of 4</h2>
      <div class="tiles"><div class="tile"><div class="tv">${fame.toLocaleString()}</div><div class="tl">medals so far</div></div>
      <div class="tile"><div class="tv">${left}</div><div class="tl">deck${left === 1 ? '' : 's'} left today${reset ? ` (resets ${reset} UK)` : ''}</div></div>
      <div class="tile"><div class="tv">${need ? need.toLocaleString() : '✓'}</div><div class="tl">${need ? `more to reach ${r.target.toLocaleString()}` : `reached ${r.target.toLocaleString()}!`}</div></div></div>
      ${fc ? `<p class="why">You're <b>${band(fc.prob).toLowerCase()}</b> to make it (${Math.round(fc.prob * 100)}%) if you play like you usually do. ${left ? `Playing all ${left} today helps most.` : 'Come back after the reset.'}</p>` : ''}
    </section>`);
  } else {
    cards.push(`<section class="step"><h2>This war</h2><p class="why">Training days. Battle days start soon; you'll see your progress here.</p></section>`);
  }

  // Last war + history
  const last = weeks[0];
  if (last) cards.push(`<section class="step"><h2>Your wars</h2>
    <p>Last war (${last.key}): <b>${last.fame.toLocaleString()}</b> medals, ${last.decks}/16 decks ${last.fame >= r.target ? '✅' : '❌'}</p>
    ${spark(p, r.target)}
    ${(() => { const rel = reliability(p, r.target, r.lookback); return rel ? `<p>Consistency: <b>${rel.score}/100</b>. You reached ${r.target.toLocaleString()}+ in ${Math.round(rel.hit * 100)}% of your recent wars and used ${Math.round(rel.deck * 100)}% of your decks.</p>` : ''; })()}
  </section>`);

  // Battle types and play times
  const ms = modeStats(m.battles, m.tag), bm = bestMode(ms), pt = playTimes(m.events, m.tag);
  const types = [['duel', 'Duels'], ['pvp', '1v1'], ['boat', 'Boat attacks']].filter(([k]) => ms[k].games);
  if (types.length || pt.total >= 4) cards.push(`<section class="step"><h2>How you play</h2>
    ${types.length ? `<table class="tbl">${types.map(([k, n]) => `<tr><td>${n}</td><td class="num">${ms[k].won}W–${ms[k].lost}L</td><td class="muted">${Math.round(ms[k].rate * 100)}% won · ~${Math.round(ms[k].perDeck)} medals per deck</td></tr>`).join('')}</table>` : ''}
    ${bm ? `<p class="why">💡 ${bm.mode} earn you about <b>${bm.gain} more medals per deck</b> than ${bm.next}.</p>` : ''}
    ${pt.total >= 4 && pt.window ? `<p class="why">🕒 You usually play ${String(pt.window.from).padStart(2, '0')}:00–${String(pt.window.to).padStart(2, '0')}:00 UK.</p>` : ''}
  </section>`);

  $('#out').innerHTML = `<h2 style="margin:4px 0 10px">${esc(p.name)} <span class="role">${esc({ elder: 'Elder', coLeader: 'Co-leader', leader: 'Leader' }[m.role] || 'Member')}</span></h2>` + cards.join('');
  const ex = rulesExplained(r);
  $('#explain').innerHTML = ex.sections.map(([h, ps]) => `<h3>${h}</h3>${ps.filter(Boolean).map(x => `<p>${x}</p>`).join('')}`).join('');
}

$('#go').onclick = show;
$('#tag').addEventListener('keydown', e => { if (e.key === 'Enter') show(); });
$('#explain').innerHTML = rulesExplained(DEFAULT_RULES).sections.map(([h, ps]) => `<h3>${h}</h3>${ps.filter(Boolean).map(x => `<p>${x}</p>`).join('')}`).join('');
const start = location.hash.replace(/^#/, '') || get('cr-war-audit:me', '');
if (start) { $('#tag').value = start; show(); }
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
