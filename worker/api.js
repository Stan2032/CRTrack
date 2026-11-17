// API handler for the Cloudflare Worker (worker/index.js).
//   GET  /api/status                       what this site offers
//   GET  /api/v1/clans/%23TAG[/members|/currentriverrace|/riverracelog]  -> RoyaleAPI proxy with CR_API_KEY
//   GET  /api/v1/players/%23TAG[/battlelog]  -> same, for the recruit check
//   GET  /api/history?clan=TAG             stored history (needs D1 binding DB)
//   POST /api/notes?clan=TAG               shared choices (needs EDIT_KEY in X-Edit-Key)
//   POST /api/snapshot[?clan=TAG]          take a snapshot now (anyone: once per 5 min per clan; all clans needs EDIT_KEY)
//   GET  /api/member?tag=TAG               one member's own data (members' page)
//   GET  /api/push/key, /api/alerts/latest; POST /api/push/subscribe|unsubscribe|test   app notifications
// ALLOWED_CLANS="PPCCR8VU,ABC123" limits which clans can be used.
import { readHistory, readMember, writeNotes, snapshotAll, requestSnapshot } from './history.js';
import { publicKey, subscribe, unsubscribe, sendAlert, latestAlerts } from './push.js';

const PROXY_PATH = /^v1\/clans\/%23[0289PYLQGRJCUV]{3,12}(\/(members|currentriverrace|riverracelog))?$/;
const PLAYER_PATH = /^v1\/players\/%23[0289PYLQGRJCUV]{3,12}(\/battlelog)?$/;   // recruit check
const TAG = /^[0289PYLQGRJCUV]{3,12}$/;

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const allowed = (env.ALLOWED_CLANS || '').split(',').map(s => s.trim().toUpperCase().replace(/^#/, '')).filter(Boolean);
  const clanOk = tag => TAG.test(tag) && (!allowed.length || allowed.includes(tag));
  // Leader codes: EDIT_KEY (shared) and/or EDIT_KEYS = "Name:code,Name2:code2" (one per leader, so the log shows who).
  const editorName = () => {
    const given = request.headers.get('X-Edit-Key');
    if (!given) return null;
    for (const pair of (env.EDIT_KEYS || '').split(',')) {
      const i = pair.lastIndexOf(':');
      if (i > 0 && pair.slice(i + 1).trim() === given) return pair.slice(0, i).trim();
    }
    return env.EDIT_KEY && given === env.EDIT_KEY ? 'Leader' : null;
  };
  const isEditor = () => !!editorName();

  if (url.pathname === '/api/status')
    return json({ key: !!env.CR_API_KEY, clans: allowed, history: !!env.DB, edit: !!(env.EDIT_KEY || env.EDIT_KEYS) }, 200);

  // Notifications for the installed app
  if (url.pathname.startsWith('/api/push/') || url.pathname === '/api/alerts/latest') {
    if (!env.DB) return json({ reason: 'noHistory' }, 501);
    if (url.pathname === '/api/alerts/latest') {
      const c = (url.searchParams.get('clan') || '').toUpperCase().replace(/^#/, '');
      if (c && !clanOk(c)) return json({ reason: 'clanNotAllowed' }, 403);
      return json(await latestAlerts(env, allowed, c), 200, 'no-store');
    }
    if (url.pathname === '/api/push/key') return json({ key: await publicKey(env) }, 200);
    if (request.method !== 'POST') return json({ reason: 'methodNotAllowed' }, 405);
    let body; try { body = await request.json(); } catch (e) { return json({ reason: 'badJson' }, 400); }
    if (url.pathname === '/api/push/unsubscribe') { await unsubscribe(env, body.endpoint); return json({ ok: true }, 200); }
    if (!isEditor()) return json({ reason: 'needLeaderCode' }, 401);
    const clan = String(body.clan || '').toUpperCase().replace(/^#/, '');
    if (!clanOk(clan)) return json({ reason: 'clanNotAllowed' }, 403);
    if (url.pathname === '/api/push/subscribe') return json({ ok: await subscribe(env, clan, body.subscription, editorName(), url.origin) }, 200);
    if (url.pathname === '/api/push/test') return json({ sent: await sendAlert(env, clan, `test:${Date.now()}`, 'Test notification', `Notifications work for ${editorName()} 👍`) }, 200);
    return json({ reason: 'notFound' }, 404);
  }

  // Members' page: one player's own data only.
  if (url.pathname === '/api/member') {
    if (!env.DB) return json({ reason: 'noHistory' }, 501);
    const clan = (url.searchParams.get('clan') || allowed[0] || '').toUpperCase().replace(/^#/, '');
    const tag = (url.searchParams.get('tag') || '').toUpperCase().replace(/^#/, '').replace(/O/g, '0');
    if (!clanOk(clan)) return json({ reason: 'clanNotAllowed' }, 403);
    if (!TAG.test(tag)) return json({ reason: 'badTag' }, 400);
    const m = await readMember(env, clan, tag);
    return m ? json(m, 200, 'no-store') : json({ reason: 'notInClan' }, 404);
  }

  if (url.pathname === '/api/history' || url.pathname === '/api/notes' || url.pathname === '/api/snapshot') {
    if (!env.DB) return json({ reason: 'noHistory' }, 501);
    if (url.pathname === '/api/snapshot') {
      if (request.method !== 'POST') return json({ reason: 'methodNotAllowed' }, 405);
      const one = (url.searchParams.get('clan') || '').toUpperCase().replace(/^#/, '');
      if (one) {
        if (!clanOk(one)) return json({ reason: 'clanNotAllowed' }, 403);
        if (!allowed.length && !isEditor()) return json({ reason: 'needLeaderCode' }, 401);   // no clan list set: only leaders may pull
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
      // The page gets the last 26 wars; ?all=1 (backups) gets everything.
      return json(await readHistory(env, clan, { weeks: url.searchParams.get('all') ? 0 : 26 }), 200, 'no-store');
    }
    if (request.method !== 'POST') return json({ reason: 'methodNotAllowed' }, 405);
    if (!isEditor()) return json({ reason: 'needLeaderCode' }, 401);
    let body; try { body = await request.json(); } catch (e) { return json({ reason: 'badJson' }, 400); }
    return json(await writeNotes(env, clan, body.items, undefined, editorName()), 200);
  }

  if (request.method !== 'GET') return json({ reason: 'methodNotAllowed' }, 405);
  if (!env.CR_API_KEY) return json({ reason: 'noServerKey' }, 501);
  const path = url.pathname.replace(/^\/api\//, '').replace(/#/g, '%23');
  if (PLAYER_PATH.test(path)) {
    // Recruit check: public player data, read-only.
  } else if (!PROXY_PATH.test(path)) return json({ reason: 'notAllowed' }, 400);
  else if (!clanOk(path.split('/')[2].slice(3))) return json({ reason: 'clanNotAllowed' }, 403);
  const r = await fetch('https://proxy.royaleapi.dev/' + path + url.search, { headers: { Authorization: 'Bearer ' + env.CR_API_KEY } });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
}

const json = (o, status, cache) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...(cache ? { 'cache-control': cache } : {}) } });
