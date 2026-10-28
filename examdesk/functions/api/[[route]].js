// Cloudflare Pages Functions wiring: stores the setup and results in a D1 database bound as DB.
import { makeHandler } from '../../lib/handler.mjs';
import { d1Store } from '../../lib/d1-store.mjs';

export async function onRequest(context) {
  if (!context.env.DB) {
    return new Response(JSON.stringify({ ok: false, error: 'no_database' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  return makeHandler(d1Store(context.env.DB), { vendorKey: context.env.XD_VENDOR_KEY || '' })(context.request);
}
