// Shared by the Worker (worker/index.js) and the Pages Function (functions/api/).
// /api/v1/clans/%23TAG[/members|/currentriverrace|/riverracelog] -> RoyaleAPI proxy, adding the CR_API_KEY secret.
// Optional ALLOWED_CLANS="PPCCR8VU,ABC123" limits which clans can be pulled.
const ALLOWED = /^v1\/clans\/%23[0289PYLQGRJCUV]{3,12}(\/(members|currentriverrace|riverracelog))?$/;

export async function handleApi(request, env) {
  if (request.method !== 'GET') return json({ reason: 'methodNotAllowed' }, 405);
  if (!env.CR_API_KEY) return json({ reason: 'noServerKey' }, 501);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, '').replace(/#/g, '%23');
  if (!ALLOWED.test(path)) return json({ reason: 'notAllowed' }, 400);
  const tag = path.split('/')[2].slice(3);
  const allowed = (env.ALLOWED_CLANS || '').split(',').map(s => s.trim().toUpperCase().replace(/^#/, '')).filter(Boolean);
  if (allowed.length && !allowed.includes(tag)) return json({ reason: 'clanNotAllowed' }, 403);
  const r = await fetch('https://proxy.royaleapi.dev/' + path + url.search, { headers: { Authorization: 'Bearer ' + env.CR_API_KEY } });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
}

const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
