// Cloudflare Worker: serves site/, the /api endpoints, and scheduled history snapshots.
import { handleApi } from './api.js';
import { snapshotAll } from './history.js';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    if (env.DB && env.CR_API_KEY) ctx.waitUntil(snapshotAll(env));
  },
};
