// Cloudflare Pages Function (only used if hosted on Pages instead of Workers).
import { handleApi } from '../../worker/api.js';
export const onRequest = ({ request, env }) => handleApi(request, env);
