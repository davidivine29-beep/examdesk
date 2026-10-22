// ExamDesk shared-setup API. Storage-agnostic: pass any object with
//   get(key) -> Promise<string|null>,  set(key, string) -> Promise<void>,
//   delete(key) -> Promise<void>,  list(prefix) -> Promise<string[]>  (keys, sorted)
// so the same code can run on Netlify Blobs, Cloudflare KV, a file, a database...
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_BYTES = 6 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const nk = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const ID = /^[A-Za-z0-9_-]{4,64}$/;
const MAX_PER_CHILD = 3; // stored copies per child + paper (retakes or repeats)
const pad = (n) => String(n).padStart(13, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeHandler(store, opts = {}) {
  const failDelay = opts.failDelayMs ?? 700;
  const json = (o, status = 200) =>
    new Response(JSON.stringify(o), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

  // Wrong guesses slow down, and after MAX_FAILS inside the window the passcode is locked for LOCK_MS.
  const MAX_FAILS = opts.maxFails ?? 10, WINDOW_MS = opts.windowMs ?? 10 * 60 * 1000, LOCK_MS = opts.lockMs ?? 5 * 60 * 1000;
  async function checkAdmin(h2) {
    const auth = await store.get('auth');
    if (!auth) return { ok: false, none: true };
    const now = Date.now();
    let lock = {};
    try { lock = JSON.parse((await store.get('lock')) || '{}'); } catch (e) { lock = {}; }
    if (lock.until && lock.until > now) return { ok: false, locked: true };
    if (typeof h2 === 'string' && HEX64.test(h2) && same(sha(h2), auth)) {
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
  const bad = (c) => json({ ok: false, locked: !!c.locked }, c.locked ? 429 : 401);

  return async function handle(req) {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try {
      if (path === '/api/setup' && req.method === 'GET') {
        const raw = await store.get('setup');
        const hasAdmin = !!(await store.get('auth'));
        const setup = raw ? JSON.parse(raw) : null;
        if (setup) setup.adminHash = hasAdmin ? 'srv' : '';
        return json({ kind: 'xd-srv', v: 1, hasAdmin, setup });
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
        await store.set('auth', sha(newAuth));
        return json({ ok: true });
      }

      if (path === '/api/setup' && req.method === 'PUT') {
        const text = await req.text();
        if (text.length > MAX_BYTES) return json({ ok: false, error: 'too_large' }, 413);
        const body = JSON.parse(text);
        const setup = body && body.setup;
        if (!setup || !Array.isArray(setup.classes)) return json({ ok: false, error: 'bad' }, 400);
        const h2 = req.headers.get('x-admin') || '';
        const auth = await store.get('auth');
        if (!auth) {
          // first save claims the site for whoever holds this passcode
          if (!HEX64.test(h2)) return json({ ok: false, error: 'bad' }, 400);
          await store.set('auth', sha(h2));
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
        return json({ ok: true, stamp });
      }

      // ---- results: candidate devices send them; only the examiner can read them
      if (path === '/api/result' && req.method === 'POST') {
        const text = await req.text();
        if (text.length > 1024 * 1024) return json({ ok: false, error: 'too_large' }, 413);
        const body = JSON.parse(text);
        const list = Array.isArray(body.results) ? body.results.slice(0, 50) : [];
        const raw = await store.get('setup');
        if (!raw) return json({ ok: false, error: 'no_setup' }, 409);
        const setup = JSON.parse(raw);
        const accepted = [], rejected = [];
        for (const r of list) {
          const id = r && r.id;
          if (!ID.test(String(id))) { rejected.push({ id, reason: 'bad' }); continue; }
          if (JSON.stringify(r).length > 30000) { rejected.push({ id, reason: 'too_large' }); continue; }
          if (await store.get('i:' + id)) { accepted.push(id); continue; } // already have it
          const cls = (setup.classes || []).find((c) => c.id === r.cid);
          const exam = cls && (cls.exams || []).find((e) => e.id === r.eid);
          if (!cls || !exam) { rejected.push({ id, reason: 'unknown_paper' }); continue; }
          const onList = (cls.roster || []).some((n) => nk(n) === nk(r.name));
          const numbers = ['score', 'total', 'pct', 'submittedAt', 'startedAt', 'usedSec'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
          if (!onList || !numbers || typeof r.name !== 'string') { rejected.push({ id, reason: onList ? 'bad' : 'unknown_name' }); continue; }
          const ck = 'n:' + sha(r.cid + '|' + nk(r.name) + '|' + r.eid).slice(0, 40);
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
        for (const p of ['r:', 'i:', 'n:']) for (const k of await store.list(p)) await store.delete(k);
        return json({ ok: true });
      }

      return json({ ok: false, error: 'not_found' }, 404);
    } catch (e) {
      return json({ ok: false, error: 'server' }, 500);
    }
  };
}
