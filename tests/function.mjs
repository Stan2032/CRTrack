// Checks the Cloudflare Pages Function with a fake fetch. Usage: node tests/function.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
const { onRequestGet } = await import('data:text/javascript,' + encodeURIComponent(src));

const calls = [];
globalThis.fetch = async (url, opt) => { calls.push({ url, auth: opt.headers.Authorization }); return new Response('{"ok":1}', { status: 200 }); };
const req = path => ({ request: new Request('https://x.pages.dev/api/' + path), params: {} });

let r = await onRequestGet({ ...req('v1/clans/%23PPCCR8VU/members'), env: {} });
assert.equal(r.status, 501);
r = await onRequestGet({ ...req('v1/clans/%23PPCCR8VU/members'), env: { CR_API_KEY: 'K' } });
assert.equal(r.status, 200);
assert.deepEqual(calls.pop(), { url: 'https://proxy.royaleapi.dev/v1/clans/%23PPCCR8VU/members', auth: 'Bearer K' });
r = await onRequestGet({ ...req('v1/clans/%23PPCCR8VU/riverracelog?limit=10'), env: { CR_API_KEY: 'K' } });
assert.equal(calls.pop().url, 'https://proxy.royaleapi.dev/v1/clans/%23PPCCR8VU/riverracelog?limit=10');
r = await onRequestGet({ ...req('v1/players/%23ABC'), env: { CR_API_KEY: 'K' } });
assert.equal(r.status, 400);
r = await onRequestGet({ ...req('v1/clans/%23PPCCR8VU'), env: { CR_API_KEY: 'K', ALLOWED_CLANS: '#ABC123' } });
assert.equal(r.status, 403);
r = await onRequestGet({ ...req('v1/clans/%23PPCCR8VU'), env: { CR_API_KEY: 'K', ALLOWED_CLANS: 'abc123, #ppccr8vu' } });
assert.equal(r.status, 200);
console.log('Function checks passed');
