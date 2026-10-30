// ExamDesk shared-setup API. Storage-agnostic: pass any object with
//   get(key) -> Promise<string|null>,  set(key, string) -> Promise<void>,
//   delete(key) -> Promise<void>,  list(prefix) -> Promise<string[]>  (keys, sorted)
// so the same code can run on Netlify Blobs, Cloudflare KV, a file, a database...

const MAX_BYTES = 6 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
// Web Crypto is available in Node 20+, Cloudflare Workers and browsers, so no Node-only imports are needed.
const sha = async (s) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const same = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const nk = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const ID = /^[A-Za-z0-9_-]{4,64}$/;
const MAX_PER_CHILD = 3; // stored copies per child + paper (retakes or repeats)
const pad = (n) => String(n).padStart(13, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- licence: plan, student cap and paid-until date, set by the vendor (not by the school)
const PLANS = { core: { cap: 200 }, growth: { cap: 500 }, campus: { cap: 1000 }, max: { cap: 5000 } };
const DAY = 24 * 60 * 60 * 1000;
const countStudents = (setup) => ((setup && setup.classes) || []).reduce((a, c) => a + ((c.roster || []).length), 0);
function licView(l, setup, now) {
  if (!l) return { set: false, status: 'none', students: countStudents(setup) };
  const graceUntil = l.paidUntil + l.graceDays * DAY;
  const state = l.state === 'off' || l.state === 'suspended' ? l.state : 'on';
  const status = state === 'off' ? 'deactivated' : state === 'suspended' ? 'suspended' : now <= l.paidUntil ? 'active' : now <= graceUntil ? 'grace' : 'expired';
  return { set: true, state, plan: l.plan, cap: l.cap, paidUntil: l.paidUntil, graceUntil, graceDays: l.graceDays, status, enforce: l.enforce, school: l.school || '', students: countStudents(setup) };
}

export function makeHandler(store, opts = {}) {
  const failDelay = opts.failDelayMs ?? 700;
  const json = (o, status = 200, extra = {}) =>
    new Response(JSON.stringify(o), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
    });
  // The licence address may be called from the vendor console (a page opened from your own PC). Changing anything still needs the vendor key.
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-vendor', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-max-age': '600' };
  const jl = (o, status = 200) => json(o, status, CORS);

  // Wrong guesses slow down, and after MAX_FAILS inside the window the passcode is locked for LOCK_MS.
  const MAX_FAILS = opts.maxFails ?? 10, WINDOW_MS = opts.windowMs ?? 10 * 60 * 1000, LOCK_MS = opts.lockMs ?? 5 * 60 * 1000;
  async function checkAdmin(h2) {
    const auth = await store.get('auth');
    if (!auth) return { ok: false, none: true };
    const now = Date.now();
    let lock = {};
    try { lock = JSON.parse((await store.get('lock')) || '{}'); } catch (e) { lock = {}; }
    if (lock.until && lock.until > now) return { ok: false, locked: true };
    if (typeof h2 === 'string' && HEX64.test(h2) && same(await sha(h2), auth)) {
      if (lock.fails) await store.set('lock', '{}');
      return { ok: true };
    }
    const fresh = lock.first && now - lock.first < WINDOW_MS;
    const fails = (fresh ? lock.fails || 0 : 0) + 1;
    const next = { fails, first: fresh ? lock.first : now };
    if (fails >= MAX_FAILS) { next.until = now + LOCK_MS; next.fails = 0; next.first = 0; }
    await store.set('lock', JSON.stringify(next));
    await sleep(failDelay);
    return { ok: false };
  }
  const vendorKey = typeof opts.vendorKey === 'string' ? opts.vendorKey : '';
  async function getLicence() {
    try { return JSON.parse((await store.get('licence')) || 'null'); } catch (e) { return null; }
  }
  async function vendorOk(req) {
    const k = req.headers.get('x-vendor') || '';
    if (!vendorKey || vendorKey.length < 16 || !k) return false;
    return same(await sha('xd-vendor:' + k), await sha('xd-vendor:' + vendorKey));
  }
  const bad = (c) => json({ ok: false, locked: !!c.locked }, c.locked ? 429 : 401);

  return async function handle(req) {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try {
      if (path === '/api/setup' && req.method === 'GET') {
        const raw = await store.get('setup');
        const hasAdmin = !!(await store.get('auth'));
        const setup = raw ? JSON.parse(raw) : null;
        if (setup) setup.adminHash = hasAdmin ? 'srv' : '';
        return json({ kind: 'xd-srv', v: 1, hasAdmin, setup, licence: licView(await getLicence(), setup, Date.now()) });
      }

      if (path === '/api/licence' && req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      if (path === '/api/licence' && req.method === 'GET') {
        const raw = await store.get('setup');
        return jl({ ok: true, licence: licView(await getLicence(), raw ? JSON.parse(raw) : null, Date.now()) });
      }

      // Only the vendor key (an environment setting that the school never sees) can change the licence.
      if (path === '/api/licence' && req.method === 'PUT') {
        if (!(await vendorOk(req))) { await sleep(failDelay); return jl({ ok: false, error: vendorKey ? 'forbidden' : 'vendor_disabled' }, 403); }
        const b = await req.json();
        const prev = await getLicence();
        const plan = String(b.plan || '').toLowerCase();
        if (!PLANS[plan]) return jl({ ok: false, error: 'bad_plan' }, 400);
        const cap = b.cap == null ? PLANS[plan].cap : b.cap;
        const paidUntil = typeof b.paidUntil === 'number' ? b.paidUntil : Date.parse(b.paidUntil);
        const graceDays = b.graceDays == null ? 14 : b.graceDays;
        const enforce = b.enforce == null ? 'block' : b.enforce;
        if (!Number.isInteger(cap) || cap < 1 || cap > 100000) return jl({ ok: false, error: 'bad_cap' }, 400);
        if (!Number.isFinite(paidUntil)) return jl({ ok: false, error: 'bad_date' }, 400);
        if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) return jl({ ok: false, error: 'bad_grace' }, 400);
        if (enforce !== 'block' && enforce !== 'warn') return jl({ ok: false, error: 'bad_enforce' }, 400);
        const state = b.state == null ? (prev && prev.state) || 'on' : b.state;
        if (state !== 'on' && state !== 'suspended' && state !== 'off') return jl({ ok: false, error: 'bad_state' }, 400);
        const lic = { plan, cap, paidUntil, graceDays, enforce, state, school: String(b.school || '').slice(0, 120), updatedAt: Date.now() };
        await store.set('licence', JSON.stringify(lic));
        const raw = await store.get('setup');
        return jl({ ok: true, licence: licView(lic, raw ? JSON.parse(raw) : null, Date.now()) });
      }

      if (path === '/api/login' && req.method === 'POST') {
        const { h2 } = await req.json();
        const c = await checkAdmin(h2);
        return c.ok ? json({ ok: true }) : c.locked ? bad(c) : json({ ok: false, none: !!c.none }, 401);
      }

      if (path === '/api/passcode' && req.method === 'POST') {
        const { h2, newAuth } = await req.json();
        const c = await checkAdmin(h2);
        if (!c.ok) return bad(c);
        if (typeof newAuth !== 'string' || !HEX64.test(newAuth)) return json({ ok: false, error: 'bad' }, 400);
        await store.set('auth', await sha(newAuth));
        return json({ ok: true });
      }

      if (path === '/api/setup' && req.method === 'PUT') {
        const text = await req.text();
        if (text.length > MAX_BYTES) return json({ ok: false, error: 'too_large' }, 413);
        const body = JSON.parse(text);
        const setup = body && body.setup;
        if (!setup || !Array.isArray(setup.classes)) return json({ ok: false, error: 'bad' }, 400);
        const h2 = req.headers.get('x-admin') || '';
        // licence rules apply to saving the setup only; results and sittings are never blocked
        const lic = await getLicence();
        let warn = '';
        if (lic) {
          const v = licView(lic, setup, Date.now());
          if (v.status === 'deactivated') return json({ ok: false, error: 'licence_off', licence: v }, 402);
          if (v.status === 'suspended') return json({ ok: false, error: 'licence_suspended', licence: v }, 402);
          if (v.status === 'expired') return json({ ok: false, error: 'licence_expired', licence: v }, 402);
          const prevRaw = await store.get('setup');
          const prev = prevRaw ? countStudents(JSON.parse(prevRaw)) : 0;
          if (v.students > lic.cap && v.students > prev) {
            if (lic.enforce === 'block') return json({ ok: false, error: 'over_cap', cap: lic.cap, count: v.students, licence: v }, 402);
            warn = 'over_cap';
          }
        }
        const auth = await store.get('auth');
        if (!auth) {
          // first save claims the site for whoever holds this passcode
          if (!HEX64.test(h2)) return json({ ok: false, error: 'bad' }, 400);
          await store.set('auth', await sha(h2));
        } else {
          const c = await checkAdmin(h2);
          if (!c.ok) return bad(c);
        }
        const raw = await store.get('setup');
        const cur = raw ? JSON.parse(raw).stamp || 0 : 0;
        if (cur && !body.force && (body.baseStamp || 0) !== cur) return json({ ok: false, error: 'conflict', stamp: cur }, 409);
        const stamp = Math.max(Date.now(), cur + 1);
        setup.stamp = stamp;
        setup.adminHash = 'srv';
        await store.set('setup', JSON.stringify(setup));
        return json({ ok: true, stamp, warn, licence: licView(lic, setup, Date.now()) });
      }

      // ---- results: candidate devices send them; only the examiner can read them
      if (path === '/api/result' && req.method === 'POST') {
        const text = await req.text();
        if (text.length > 2 * 1024 * 1024) return json({ ok: false, error: 'too_large' }, 413);
        const body = JSON.parse(text);
        const list = Array.isArray(body.results) ? body.results.slice(0, 50) : [];
        const raw = await store.get('setup');
        if (!raw) return json({ ok: false, error: 'no_setup' }, 409);
        const setup = JSON.parse(raw);
        const accepted = [], rejected = [];
        for (const r of list) {
          const id = r && r.id;
          if (!ID.test(String(id))) { rejected.push({ id, reason: 'bad' }); continue; }
          if (JSON.stringify(r).length > 100000) { rejected.push({ id, reason: 'too_large' }); continue; }
          if (await store.get('i:' + id)) { accepted.push(id); continue; } // already have it
          const cls = (setup.classes || []).find((c) => c.id === r.cid);
          const exam = cls && (cls.exams || []).find((e) => e.id === r.eid);
          if (!cls || !exam) { rejected.push({ id, reason: 'unknown_paper' }); continue; }
          const onList = (cls.roster || []).some((n) => nk(n) === nk(r.name));
          const numbers = ['score', 'total', 'pct', 'submittedAt', 'startedAt', 'usedSec'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
          if (!onList || !numbers || typeof r.name !== 'string') { rejected.push({ id, reason: onList ? 'bad' : 'unknown_name' }); continue; }
          const ck = 'n:' + (await sha(r.cid + '|' + nk(r.name) + '|' + r.eid)).slice(0, 40);
          const have = parseInt((await store.get(ck)) || '0', 10);
          if (have >= MAX_PER_CHILD) { rejected.push({ id, reason: 'too_many' }); continue; }
          const at = Date.now();
          await store.set('r:' + pad(at) + ':' + id, JSON.stringify(r));
          await store.set('i:' + id, String(at));
          await store.set(ck, String(have + 1));
          accepted.push(id);
        }
        return json({ ok: true, accepted, rejected });
      }

      if (path === '/api/results' && req.method === 'GET') {
        const c = await checkAdmin(req.headers.get('x-admin') || '');
        if (!c.ok) return bad(c);
        const since = parseInt(new URL(req.url).searchParams.get('since') || '0', 10) || 0;
        const keys = (await store.list('r:')).filter((k) => parseInt(k.slice(2, 15), 10) > since);
        const results = [];
        let upTo = since;
        for (const k of keys.slice(0, 500)) {
          const v = await store.get(k);
          if (v) { results.push(JSON.parse(v)); upTo = Math.max(upTo, parseInt(k.slice(2, 15), 10)); }
        }
        return json({ ok: true, results, upTo, more: keys.length > 500 });
      }

      if (path === '/api/results' && req.method === 'DELETE') {
        const c = await checkAdmin(req.headers.get('x-admin') || '');
        if (!c.ok) return bad(c);
        for (const p of ['r:', 'i:', 'n:', 'm:', 'mp:']) for (const k of await store.list(p)) await store.delete(k);
        return json({ ok: true });
      }

      // ---- marks: teacher marks on written answers, with their change record. Examiner only; saving is licence-gated like the setup.
      if (path === '/api/marks' && req.method === 'POST') {
        const c = await checkAdmin(req.headers.get('x-admin') || '');
        if (!c.ok) return bad(c);
        const lic = await getLicence();
        if (lic) {
          const raw0 = await store.get('setup');
          const v = licView(lic, raw0 ? JSON.parse(raw0) : null, Date.now());
          if (v.status === 'deactivated') return json({ ok: false, error: 'licence_off', licence: v }, 402);
          if (v.status === 'suspended') return json({ ok: false, error: 'licence_suspended', licence: v }, 402);
          if (v.status === 'expired') return json({ ok: false, error: 'licence_expired', licence: v }, 402);
        }
        const text = await req.text();
        if (text.length > 1024 * 1024) return json({ ok: false, error: 'too_large' }, 413);
        const body = JSON.parse(text);
        const list = Array.isArray(body.marks) ? body.marks.slice(0, 100) : [];
        const accepted = [], rejected = [];
        const num = (x) => typeof x === 'number' && Number.isFinite(x);
        const hkey = (h) => h.at + '|' + h.m + '|' + h.from + '|' + h.by;
        for (const it of list) {
          const rid = it && it.rid, qi = it && it.qi, rec = it && it.rec;
          const key = rid + '|' + qi;
          if (!ID.test(String(rid)) || !Number.isInteger(qi) || qi < 0 || qi > 999 || !rec || !num(rec.m) || rec.m < 0 || rec.m > 1000 || !num(rec.at) || typeof rec.by !== 'string') { rejected.push({ key, reason: 'bad' }); continue; }
          if (!(await store.get('i:' + rid))) { rejected.push({ key, reason: 'unknown_result' }); continue; }
          const hist = (Array.isArray(rec.h) ? rec.h : []).filter((h) => h && num(h.m) && num(h.from) && num(h.at) && typeof h.by === 'string').slice(0, 60)
            .map((h) => ({ m: h.m, from: h.from, by: h.by.slice(0, 60), at: h.at }));
          const mine = { m: rec.m, by: rec.by.slice(0, 60), at: rec.at, h: hist };
          const ptr = await store.get('mp:' + rid + ':' + qi);
          let cur = null;
          if (ptr) { const ov = await store.get('m:' + pad(parseInt(ptr, 10)) + ':' + rid + ':' + qi); if (ov) cur = JSON.parse(ov).rec; }
          let out = mine;
          if (cur) {
            const win = cur.at > mine.at ? cur : mine;
            const seen = new Set(), all = [];
            for (const h of cur.h.concat(mine.h)) { const k = hkey(h); if (!seen.has(k)) { seen.add(k); all.push(h); } }
            all.sort((a, b) => a.at - b.at);
            out = { m: win.m, by: win.by, at: win.at, h: all.slice(-60) };
          }
          const at = Math.max(Date.now(), ptr ? parseInt(ptr, 10) + 1 : 0);
          if (ptr) await store.delete('m:' + pad(parseInt(ptr, 10)) + ':' + rid + ':' + qi);
          await store.set('m:' + pad(at) + ':' + rid + ':' + qi, JSON.stringify({ rid, qi, rec: out }));
          await store.set('mp:' + rid + ':' + qi, String(at));
          accepted.push(key);
        }
        return json({ ok: true, accepted, rejected });
      }

      if (path === '/api/marks' && req.method === 'GET') {
        const c = await checkAdmin(req.headers.get('x-admin') || '');
        if (!c.ok) return bad(c);
        const since = parseInt(new URL(req.url).searchParams.get('since') || '0', 10) || 0;
        const keys = (await store.list('m:')).filter((k) => parseInt(k.slice(2, 15), 10) > since);
        const marks = [];
        let upTo = since;
        for (const k of keys.slice(0, 500)) {
          const v = await store.get(k);
          if (v) { marks.push(JSON.parse(v)); upTo = Math.max(upTo, parseInt(k.slice(2, 15), 10)); }
        }
        return json({ ok: true, marks, upTo, more: keys.length > 500 });
      }

      return json({ ok: false, error: 'not_found' }, 404);
    } catch (e) {
      return json({ ok: false, error: 'server' }, 500);
    }
  };
}
