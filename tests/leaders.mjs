// The leaders' to-do list: same decisions as the page, ticks from the game, buttons and the site.
// Usage: node tests/leaders.mjs
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { fakeApi } from './check.mjs';
import { SCHEMA, writeNotes } from '../worker/history.js';
import { handleApi } from '../worker/api.js';
import { postTodo, refreshTodo } from '../worker/discord.js';
import { todoState } from '../worker/leaders.js';

const api = fakeApi(), calls = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  calls.push({ url, method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null });
  if (url.includes('proxy.royaleapi.dev')) {
    if (url.endsWith('/members')) return Response.json(api.members);
    if (url.includes('/currentriverrace')) return Response.json({ ...api.race, periodType: 'training', periodIndex: 0 });
    if (url.includes('/riverracelog')) return Response.json(api.log);
  }
  if (/\/channels\/LC\/messages$/.test(url) && opt.method === 'POST') return Response.json({ id: 'M' + calls.length });
  return new Response('{}', { status: 200 });
};
const DB = fakeD1();
const env = { DB, CR_API_KEY: 'k', DISCORD_PUBLIC_KEY: 'p', DISCORD_BOT_TOKEN: 'T', DISCORD_APP_ID: 'A', ALLOWED_CLANS: 'PPCCR8VU', EDIT_KEY: 'code1234' };
await DB.exec(SCHEMA);
await DB.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  INSERT INTO kv (k, v) VALUES ('discord:G', '{"clan":"PPCCR8VU","channels":{"leaders":"LC"},"roles":{}}');`);
await DB.exec(`INSERT INTO members (clan, tag, in_clan, role) VALUES ${api.members.items.map(m => `('PPCCR8VU','${m.tag.slice(1)}',1,'${m.role}')`).join(',')};`);

// Worked out like the page: war 138-2's kicks, demotion and warnings.
assert.equal(await postTodo(env, 'PPCCR8VU', null, true), 1);
const post = calls.filter(c => c.method === 'POST' && /channels\/LC\/messages$/.test(c.url));
const list = post[0].body.content;
assert.match(list, /After war 138-2/);
// (No saved history here, so new members' join days are unknown: leaders decide.)
assert.match(list, /⬜ \*\*Kick:\*\*[^\n]*bestgirlclasher \(1,350 medals, 2nd miss in a row\)/);
assert.match(list, /⬜ \*\*Promote to Elder:\*\*[^\n]*Luke \(10\/10 wars 1800\+/);
assert.match(list, /⬜ \*\*Decide together:\*\*[^\n]*Manny1/);
assert.match(list, /⬜ \*\*Post first & only warnings:\*\*[^\n]*Thomas king/);
assert.match(list, /0 of 24 done/);
const warnBtn = post[0].body.components[0].components.find(b => b.custom_id === 'todo|138-2|Warn|do');
assert.ok(warnBtn, 'a button for warnings');
assert.match(post[1].body.content, /Clan chat messages for war 138-2[\s\S]*```/, 'chat messages posted to copy');

// Kicked in game: ticks itself on the next pull.
const manny = (await todoState(env, 'PPCCR8VU', '138-2')).items.find(x => x.name === 'bestgirlclasher');
await DB.prepare("UPDATE members SET in_clan = 0 WHERE tag = ?").bind(manny.tag).run();
calls.length = 0;
assert.equal(await refreshTodo(env, 'PPCCR8VU', ['NOTONLIST']), 0, 'unrelated change: no redraw');
assert.equal(await refreshTodo(env, 'PPCCR8VU', [manny.tag]), 1);
assert.match(calls.find(c => c.method === 'PATCH').body.content, /~~bestgirlclasher~~/);

// A leader taps "Warnings posted": shared done notes, list redrawn in place. Members can't.
const { tickTodo, todoMessage } = await import('../worker/leaders.js');
let t = await tickTodo(env, 'PPCCR8VU', '138-2', 'Warn', false, 'Discord: stan');
assert.ok(t.items.filter(x => x.status === 'Warn').every(x => x.done));
const m = todoMessage(t);
assert.match(m.content, /✅ \*\*Post first & only warnings/);
assert.equal(m.components[0].components.find(b => b.custom_id.includes('|Warn|')).custom_id, 'todo|138-2|Warn|undo');
const perc = t.items.find(x => x.name === 'Thomas king');
assert.equal((await DB.prepare("SELECT value FROM notes WHERE kind = 'done' AND week = '138-2' AND tag = ?").bind(perc.tag).first()).value, '1', 'same note the page reads');
assert.equal((await DB.prepare("SELECT by FROM note_log WHERE kind = 'done' LIMIT 1").first()).by, 'Discord: stan');

// Unticked on the site: Discord list follows.
calls.length = 0;
const r = await handleApi(new Request('https://x.dev/api/notes?clan=PPCCR8VU', { method: 'POST', headers: { 'X-Edit-Key': 'code1234', 'content-type': 'application/json' },
  body: JSON.stringify({ items: [{ week: '138-2', tag: perc.tag, kind: 'done', value: null }] }) }), env, {});
assert.equal(r.status, 200);
assert.match(calls.find(c => c.method === 'PATCH').body.content, /⬜ \*\*Post first & only warnings/);
// After a war ends, the next scheduled run makes the list (in a run of its own).
const { snapshotAll } = await import('../worker/history.js');
await DB.exec(`INSERT INTO kv (k, v) VALUES ('todo:due:PPCCR8VU', '1')`);
const out = await snapshotAll(env);
assert.equal(out[0].todo, 1);
assert.equal(await DB.prepare("SELECT 1 FROM kv WHERE k = 'todo:due:PPCCR8VU'").first(), null, 'done once');
console.log('Leaders to-do checks passed');
