// Browser tests for the leaders' page and the members' page, against fake data built from samples/.
// No network: the site's files are served from site/ and every /api call is answered here.
// Usage: node tests/ui.mjs   (needs Playwright with Chromium)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fakeApi } from './check.mjs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright not installed; skipping page tests'); process.exit(0); }

const api = fakeApi();
const notes = [];
const hist = { clan: 'PPCCR8VU', lastRun: new Date().toISOString(), members: api.members.items.map(m => ({ tag: m.tag.slice(1), name: m.name, role: m.role, in_clan: 1 })),
  events: [], wars: [{ week: '138-2', ended_at: '20261116T094306.000Z', rank: 2, fame: 7700, trophy_change: 10 }], players: [], periods: [], days: [], get notes() { return notes; },
  stats: [], standings: [], battles: [], noteLog: [], raceEvents: [] };
const site = 'https://audit.test/';
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', webmanifest: 'application/manifest+json', png: 'image/png' };

async function page(b, path = '') {
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.route(site + '**', r => {
    const u = new URL(r.request().url()), j = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/status') return j({ key: true, clans: ['PPCCR8VU'], history: true, edit: true, discord: false });
    if (u.pathname === '/api/history') return j(hist);
    if (u.pathname === '/api/notes') {
      if (r.request().headers()['x-edit-key'] !== 'code') return j({}, 401);
      for (const i of JSON.parse(r.request().postData()).items) notes.push({ ...i, at: 'x' });
      return j({ saved: 1, by: 'Tester' });
    }
    if (u.pathname === '/api/member') return j({ tag: 'P8C99JYRG', name: 'iccyman2511', role: 'coLeader', inClan: true, war: null, rules: {}, weeks: [{ week: '138-2', fame: 2850, decks: 16, boats: 0 }, { week: '138-1', fame: 2600, decks: 16, boats: 0 }, { week: '137-4', fame: 2200, decks: 16, boats: 0 }], battles: [], events: [] });
    if (u.pathname.startsWith('/api/')) { const k = decodeURIComponent(u.pathname); return j(k.endsWith('/members') ? api.members : k.includes('currentriverrace') ? { ...api.race, periodType: 'training', periodIndex: 15, sectionIndex: 2 } : k.includes('riverracelog') ? api.log : api.clan); }
    const f = 'site' + (u.pathname === '/' ? '/index.html' : u.pathname);
    return existsSync(f) ? r.fulfill({ status: 200, contentType: types[f.split('.').pop()] || 'text/plain', body: readFileSync(f) }) : r.fulfill({ status: 404, body: '' });
  });
  await p.goto(site + path); await p.waitForTimeout(1200);
  return p;
}

const b = await chromium.launch();
try {
  // Leaders' page: loads the clan and opens on last war (training day)
  const p = await page(b);
  // Help: a ? next to a section title shows its explanation; again hides it. In a folded section it doesn't open it.
  await p.click('button[data-help="act"]');
  assert.match(await p.textContent('.helptip'), /Tap a circle/);
  await p.click('button[data-help="act"]'); assert.equal(await p.locator('.helptip').count(), 0);
  await p.click('button[data-help="stats"]');
  assert.equal(await p.evaluate(() => document.querySelector('button[data-help="stats"]').closest('details').open), false, 'stays folded');
  assert.match(await p.textContent('.helptip'), /reliable/);
  await p.click('button[data-help="stats"]');
  assert.match(await p.textContent('#chips'), /To do:/);
  assert.match(await p.textContent('#groups'), /Kick/);
  // Recommended steps and copy
  assert.ok(await p.$('#steps li'), 'recommended steps');
  await p.click('[data-copystep]'); assert.match(await p.evaluate(() => navigator.clipboard.readText()), /War update|First & only|Switch boats|Holding|Congrats/);
  // War picker
  await p.selectOption('#week', '137-4'); await p.waitForTimeout(200);
  assert.ok((await p.$$eval('textarea', t => t.map(x => x.getAttribute('aria-label')))).some(l => /^Season/.test(l)), 'season recap on a season\'s last war');
  await p.selectOption('#week', '138-2');
  // Rules: steppers and limits
  await p.click('#rulesbox summary');
  await p.fill('input[data-rule="chatLimit"]', '999'); await p.dispatchEvent('input[data-rule="chatLimit"]', 'change');
  assert.equal(await p.inputValue('input[data-rule="chatLimit"]'), '256'); assert.match(await p.textContent('#status'), /must be 50–256/);
  assert.equal(await p.getAttribute('input[data-rule="boatShare"]', 'type'), 'range', 'short ranges use a slider');
  assert.match(await p.textContent('#rulenote'), /on this device only/);
  await p.click('[data-step="target"][data-dir="1"]'); assert.equal(await p.inputValue('input[data-rule="target"]'), '1850');
  // Leader code, then a shared tick
  await p.fill('#code', 'code'); await p.click('#savecode'); await p.waitForTimeout(200);
  assert.match(await p.textContent('#status'), /accepted/);
  const tick = await p.$('[data-stepdone], [data-markall]');
  if (tick) { await tick.click(); await p.waitForTimeout(200); assert.match(await p.textContent('#status'), /Saved for everyone/); }
  // Clan stats and the rules explainer open without errors
  await p.click('#statsbox summary'); await p.waitForTimeout(200); assert.match(await p.textContent('#statsbody'), /What stands out|Charts/);
  await p.click('#explainbox summary'); assert.match(await p.textContent('#explain'), /first & only warning/);
  // Clan description: versions that fit in 128 characters; extra text is added where it fits.
  assert.ok(await p.locator('#desccards .card').count() >= 2);
  await p.fill('#descextra', 'Discord: dsc.gg/x');
  assert.match(await p.textContent('#desccards'), /Discord: dsc\.gg\/x/);
  for (const c of await p.locator('#desccards .cnt').allTextContents()) assert.ok(+c.split('/')[0] <= 128, c);
  if (process.env.SHOT) { await p.evaluate(() => { const el = document.querySelector('#descextra'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60); }); await p.screenshot({ path: process.env.SHOT }); }
  assert.deepEqual(p.errs, [], 'no page errors');

  // Members' page: own numbers only
  const m = await page(b, 'me.html#P8C99JYRG');
  assert.match(await m.textContent('#out'), /iccyman2511[\s\S]*Last war \(138-2\): 2,850/);
  assert.equal(await m.$('#groups'), null, 'no leader sections on the members\' page');
  assert.deepEqual(m.errs, [], 'no page errors (members)');
  console.log('Page checks passed');
} finally { await b.close(); }
