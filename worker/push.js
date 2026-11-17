// Web Push for the installed app. Pushes carry no data (no payload encryption needed):
// the phone's service worker fetches /api/alerts/latest and shows that.
// VAPID keys are created on first use and kept in D1.
import { q } from './history.js';

export const PUSH_SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, clan TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, clan TEXT, key TEXT UNIQUE, title TEXT, body TEXT, at TEXT);
`.trim();

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));

async function kvGet(db, k) { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; }
async function kvSet(db, k, v) { await db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, v).run(); }

async function vapid(env) {
  await env.DB.exec(PUSH_SCHEMA);
  let stored = await kvGet(env.DB, 'vapid');
  if (!stored) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
    stored = JSON.stringify({ priv, pub });
    await kvSet(env.DB, 'vapid', stored);
  }
  const { priv, pub } = JSON.parse(stored);
  const key = await crypto.subtle.importKey('jwk', priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { key, pub };
}

export async function publicKey(env) { return (await vapid(env)).pub; }

async function vapidAuth(env, endpoint) {
  const { key, pub } = await vapid(env);
  const sub = (await kvGet(env.DB, 'origin')) || 'https://github.com';
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const body = enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

export async function subscribe(env, clan, sub, by, origin) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return false;
  await env.DB.exec(PUSH_SCHEMA);
  await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint, clan, by, at) VALUES (?, ?, ?, ?)').bind(sub.endpoint, clan, by, new Date().toISOString()).run();
  if (origin && /^https:\/\/[^/]+$/.test(origin)) await kvSet(env.DB, 'origin', origin);
  return true;
}

export async function unsubscribe(env, endpoint) {
  await env.DB.exec(PUSH_SCHEMA);
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(endpoint || '')).run();
}

// Records an alert once (by key) and pings every subscribed device for that clan.
export async function sendAlert(env, clan, key, title, body) {
  await env.DB.exec(PUSH_SCHEMA);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO alerts (clan, key, title, body, at) VALUES (?, ?, ?, ?, ?)')
    .bind(clan, key, title, body, new Date().toISOString()).run();
  const changes = r?.meta?.changes ?? r?.changes ?? 1;
  if (!changes) return 0;
  const subs = (await env.DB.prepare('SELECT endpoint FROM push_subs WHERE clan = ?').bind(clan).all()).results;
  let sent = 0;
  for (const { endpoint } of subs.slice(0, 20)) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', Authorization: await vapidAuth(env, endpoint), 'Content-Length': '0' } });
      if (res.status === 404 || res.status === 410) await unsubscribe(env, endpoint);
      else if (res.ok) sent++;
    } catch (e) { /* one bad endpoint must not stop the rest */ }
  }
  return sent;
}

export async function latestAlerts(env, clans) {
  await env.DB.exec(PUSH_SCHEMA);
  const where = clans.length ? `WHERE clan IN (${clans.map(q).join(',')})` : '';
  return (await env.DB.prepare(`SELECT clan, key, title, body, at FROM alerts ${where} ORDER BY id DESC LIMIT 10`).all()).results;
}
