// Cloudflare Pages "advanced mode" worker: serves /api/* itself and hands everything else to the static files.
// Bundled into one _worker.js by build-cloudflare.mjs so it works with a plain drag-and-drop upload (no Git).
import { makeHandler } from '../lib/handler.mjs';
import { d1Store } from '../lib/d1-store.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!env.DB) {
        return new Response(JSON.stringify({ ok: false, error: 'no_database' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return makeHandler(d1Store(env.DB), { vendorKey: env.XD_VENDOR_KEY || '' })(request);
    }
    return env.ASSETS.fetch(request);
  },
};
