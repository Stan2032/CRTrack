// The leaders' page decisions, worked out in the Worker (for the weekly digest): same code as the page.
// Usage: node tests/leaders.mjs
import assert from 'node:assert/strict';
import { fakeD1 } from './fake-d1.mjs';
import { fakeApi } from './check.mjs';
import { SCHEMA } from '../worker/history.js';
import { endDecisions } from '../worker/leaders.js';

const api = fakeApi();
globalThis.fetch = async url => {
  url = String(url);
  if (url.endsWith('/members')) return Response.json(api.members);
  if (url.includes('/currentriverrace')) return Response.json({ ...api.race, periodType: 'training', periodIndex: 0 });
  if (url.includes('/riverracelog')) return Response.json(api.log);
  return new Response('{}', { status: 404 });
};
const DB = fakeD1(), env = { DB, CR_API_KEY: 'k' };
await DB.exec(SCHEMA);
const d = await endDecisions(env, 'PPCCR8VU');
assert.equal(d.week, '138-2');
const by = Object.fromEntries(d.list.map(p => [p.name, p.res.status]));
// (No saved history here, so new members' join days are unknown: leaders decide.)
assert.equal(by.bestgirlclasher, 'Kick'); assert.equal(by.Luke, 'Promote'); assert.equal(by.Manny1, 'Review'); assert.equal(by['Thomas king'], 'Warn');
console.log('Leaders decision checks passed');
