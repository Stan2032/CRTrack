// Cloudflare Pages Function: /api/v1/clans/... -> RoyaleAPI proxy, adding the key stored on Cloudflare.
// Set secret CR_API_KEY (key allowed for IP 45.79.218.79). Optional ALLOWED_CLANS="PPCCR8VU,ABC123".
const ALLOWED = /^v1\/clans\/%23[0289PYLQGRJCUV]{3,12}(\/(members|currentriverrace|riverracelog))?$/;

export async function onRequestGet({ params, request, env }) {
  if (!env.CR_API_KEY) return json({ reason: 'noServerKey' }, 501);
  const raw = new URL(request.url).pathname.replace(/^\/api\//, '');
  const path = raw.replace(/#/g, '%23');
  if (!ALLOWED.test(path)) return json({ reason: 'notAllowed' }, 400);
  const tag = path.split('/')[2].slice(3);
  const allowed = (env.ALLOWED_CLANS || '').split(',').map(s => s.trim().toUpperCase().replace(/^#/, '')).filter(Boolean);
  if (allowed.length && !allowed.includes(tag)) return json({ reason: 'clanNotAllowed' }, 403);
  const q = new URL(request.url).search;
  const r = await fetch('https://proxy.royaleapi.dev/' + path + q, { headers: { Authorization: 'Bearer ' + env.CR_API_KEY } });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
}

const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
