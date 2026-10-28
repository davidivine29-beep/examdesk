// Sets or renews a school's licence. Only you can run this, because it needs the vendor key.
// Usage:
//   node tools/set-licence.mjs <site-url> <vendor-key> <plan> <paid-until YYYY-MM-DD> ["School name"] [--cap 250] [--warn] [--grace 14]
// Plans: core, growth, campus, max.   Example:
//   node tools/set-licence.mjs https://examdesk-edupeak.netlify.app MY-KEY core 2027-01-31 "Edupeak Montessori"
// With only <site-url> it prints the school's current licence instead.
const a = process.argv.slice(2);
const flag = (n) => { const i = a.indexOf(n); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
const warn = a.includes('--warn'); if (warn) a.splice(a.indexOf('--warn'), 1);
const cap = flag('--cap'), grace = flag('--grace');
const [site, key, plan, until, school] = a;
if (!site) { console.log('Usage: node tools/set-licence.mjs <site-url> <vendor-key> <plan> <YYYY-MM-DD> ["School"] [--cap N] [--warn] [--grace N]'); process.exit(1); }
const base = site.replace(/\/+$/, '');
if (!key) {
  const r = await fetch(base + '/api/licence'); console.log(JSON.stringify(await r.json(), null, 2)); process.exit(0);
}
const body = { plan, paidUntil: until ? new Date(until + 'T23:59:59').getTime() : undefined, school: school || '' };
if (cap) body.cap = Number(cap);
if (grace) body.graceDays = Number(grace);
if (warn) body.enforce = 'warn';
const r = await fetch(base + '/api/licence', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-vendor': key }, body: JSON.stringify(body) });
const j = await r.json();
console.log(r.status, JSON.stringify(j, null, 2));
process.exit(j.ok ? 0 : 1);
