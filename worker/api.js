// Shared by the Worker (worker/index.js) and the Pages Function (functions/api/).
//   GET  /api/status                       what this site offers
//   GET  /api/v1/clans/%23TAG[/members|/currentriverrace|/riverracelog]  -> RoyaleAPI proxy with CR_API_KEY
//   GET  /api/history?clan=TAG             stored history (needs D1 binding DB)
//   POST /api/notes?clan=TAG               shared choices (needs EDIT_KEY in X-Edit-Key)
//   POST /api/snapshot[?clan=TAG]          take a snapshot now (anyone: once per 5 min per clan; all clans needs EDIT_KEY)
// ALLOWED_CLANS="PPCCR8VU,ABC123" limits which clans can be used.
import { readHistory, writeNotes, snapshotAll, requestSnapshot } from './history.js';

const PROXY_PATH = /^v1\/clans\/%23[0289PYLQGRJCUV]{3,12}(\/(members|currentriverrace|riverracelog))?$/;
const TAG = /^[0289PYLQGRJCUV]{3,12}$/;

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const allowed = (env.ALLOWED_CLANS || '').split(',').map(s => s.trim().toUpperCase().replace(/^#/, '')).filter(Boolean);
  const clanOk = tag => TAG.test(tag) && (!allowed.length || allowed.includes(tag));
  const isEditor = () => !!env.EDIT_KEY && request.headers.get('X-Edit-Key') === env.EDIT_KEY;

  if (url.pathname === '/api/status')
    return json({ key: !!env.CR_API_KEY, clans: allowed, history: !!env.DB, edit: !!env.EDIT_KEY }, 200);

  if (url.pathname === '/api/history' || url.pathname === '/api/notes' || url.pathname === '/api/snapshot') {
    if (!env.DB) return json({ reason: 'noHistory' }, 501);
    if (url.pathname === '/api/snapshot') {
      if (request.method !== 'POST') return json({ reason: 'methodNotAllowed' }, 405);
      const one = (url.searchParams.get('clan') || '').toUpperCase().replace(/^#/, '');
      if (one) {
        if (!clanOk(one)) return json({ reason: 'clanNotAllowed' }, 403);
        if (!env.CR_API_KEY) return json({ reason: 'noServerKey' }, 501);
        const r = await requestSnapshot(env, one, isEditor());
        return json(r.body, r.status, 'no-store');
      }
      if (!isEditor()) return json({ reason: 'needLeaderCode' }, 401);
      return json(await snapshotAll(env, { force: true }), 200);
    }
    const clan = (url.searchParams.get('clan') || '').toUpperCase().replace(/^#/, '');
    if (!clanOk(clan)) return json({ reason: 'clanNotAllowed' }, 403);
    if (url.pathname === '/api/history') {
      if (request.method !== 'GET') return json({ reason: 'methodNotAllowed' }, 405);
      return json(await readHistory(env, clan), 200, 'no-store');
    }
    if (request.method !== 'POST') return json({ reason: 'methodNotAllowed' }, 405);
    if (!isEditor()) return json({ reason: 'needLeaderCode' }, 401);
    let body; try { body = await request.json(); } catch (e) { return json({ reason: 'badJson' }, 400); }
    return json(await writeNotes(env, clan, body.items), 200);
  }

  if (request.method !== 'GET') return json({ reason: 'methodNotAllowed' }, 405);
  if (!env.CR_API_KEY) return json({ reason: 'noServerKey' }, 501);
  const path = url.pathname.replace(/^\/api\//, '').replace(/#/g, '%23');
  if (!PROXY_PATH.test(path)) return json({ reason: 'notAllowed' }, 400);
  if (!clanOk(path.split('/')[2].slice(3))) return json({ reason: 'clanNotAllowed' }, 403);
  const r = await fetch('https://proxy.royaleapi.dev/' + path + url.search, { headers: { Authorization: 'Bearer ' + env.CR_API_KEY } });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
}

const json = (o, status, cache) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...(cache ? { 'cache-control': cache } : {}) } });
