// Netlify wiring: stores the setup in Netlify Blobs (included with every Netlify site).
import { getStore } from '@netlify/blobs';
import { makeHandler } from '../../lib/handler.mjs';

const blobs = () => getStore('examdesk');
const store = {
  get: (k) => blobs().get(k, { type: 'text' }),
  set: (k, v) => blobs().set(k, v),
  delete: (k) => blobs().delete(k),
  list: async (prefix) => {
    const out = [];
    for await (const page of blobs().list({ prefix, paginate: true })) out.push(...page.blobs.map((b) => b.key));
    return out.sort();
  },
};
// XD_VENDOR_KEY is an environment variable set in Netlify (never in the code). Only its holder can set the licence.
const vendorKey = (globalThis.Netlify && Netlify.env.get('XD_VENDOR_KEY')) || process.env.XD_VENDOR_KEY || '';
const handle = makeHandler(store, { vendorKey });

export default async (req) => handle(req);
export const config = { path: ['/api/setup', '/api/login', '/api/passcode', '/api/result', '/api/results', '/api/licence'] };
