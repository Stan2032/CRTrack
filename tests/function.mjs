// Checks the /api handler with a fake fetch. Usage: node tests/function.mjs
import assert from 'node:assert/strict';
import { handleApi } from '../worker/api.js';

const calls = [];
globalThis.fetch = async (url, opt) => { calls.push({ url, auth: opt.headers.Authorization }); return new Response('{"ok":1}', { status: 200 }); };
const go = (path, env) => handleApi(new Request('https://x.workers.dev/api/' + path), env);

assert.equal((await go('v1/clans/%23PPCCR8VU/members', {})).status, 501);
assert.equal((await go('v1/clans/%23PPCCR8VU/members', { CR_API_KEY: 'K' })).status, 200);
assert.deepEqual(calls.pop(), { url: 'https://proxy.royaleapi.dev/v1/clans/%23PPCCR8VU/members', auth: 'Bearer K' });
await go('v1/clans/%23PPCCR8VU/riverracelog?limit=10', { CR_API_KEY: 'K' });
assert.equal(calls.pop().url, 'https://proxy.royaleapi.dev/v1/clans/%23PPCCR8VU/riverracelog?limit=10');
assert.equal((await go('v1/players/%23ABC', { CR_API_KEY: 'K' })).status, 400);
assert.equal((await go('v1/clans/%23PPCCR8VU', { CR_API_KEY: 'K', ALLOWED_CLANS: '#ABC123' })).status, 403);
assert.equal((await go('v1/clans/%23PPCCR8VU', { CR_API_KEY: 'K', ALLOWED_CLANS: 'abc123, #ppccr8vu' })).status, 200);
const st = await (await go('status', { CR_API_KEY: 'K', ALLOWED_CLANS: 'ppccr8vu' })).json();
assert.deepEqual(st, { key: true, clans: ['PPCCR8VU'], history: false, edit: false });
assert.deepEqual(await (await go('status', {})).json(), { key: false, clans: [], history: false, edit: false });
console.log('API checks passed');
