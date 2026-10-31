import { makeHandler } from '../lib/handler.mjs';
import { createHash } from 'node:crypto';
import { d1Store } from '../lib/d1-store.mjs';
let mem, store;
if (process.env.STORE === 'd1') {
  // run the same tests against the Cloudflare D1 adapter, using Node's built-in SQLite as a stand-in for D1
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  const db = {
    prepare(q) {
      const st = sql.prepare(q);
      return {
        bind: (...a) => ({
          first: async () => st.get(...a) ?? null,
          all: async () => ({ results: st.all(...a) }),
          run: async () => (st.run(...a), {}),
        }),
        run: async () => (st.run(), {}),
      };
    },
  };
  store = d1Store(db);
  mem = { clear: () => sql.exec('DELETE FROM kv') };
} else {
  const m = new Map();
  store = {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)).sort(),
  };
  mem = m;
}
const h = makeHandler(store, { failDelayMs: 5 });
const nk = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const A = sha('xd-auth:1234'), B = sha('xd-auth:9999'), C = sha('xd-auth:new');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', m); };
const call = async (method, path, body, headers = {}) => {
  const r = await h(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', ...headers } }));
  return { s: r.status, j: await r.json() };
};
const setup = (n) => ({ v: 2, stamp: 0, school: n, adminHash: 'LOCALHASH', classes: [{ id: 'b1', name: 'Basic 1', roster: ['A'], exams: [] }] });

let r = await call('GET', '/api/setup');
ok(r.s === 200 && r.j.kind === 'xd-srv' && r.j.setup === null && r.j.hasAdmin === false, 'empty server: no setup, no admin');
r = await call('PUT', '/api/setup', { setup: setup('S1'), baseStamp: 0 }, { 'x-admin': A });
ok(r.s === 200 && r.j.ok && r.j.stamp > 0, 'first save claims the site and stores the setup');
const st1 = r.j.stamp;
r = await call('GET', '/api/setup');
ok(r.j.hasAdmin && r.j.setup.school === 'S1' && r.j.setup.adminHash === 'srv' && r.j.setup.stamp === st1, 'GET returns setup with adminHash hidden');
ok(!JSON.stringify(r.j).includes(A) && !JSON.stringify(r.j).includes(sha(A)), 'GET never exposes any passcode value');
r = await call('PUT', '/api/setup', { setup: setup('HACK'), baseStamp: st1 }, { 'x-admin': B });
ok(r.s === 401, 'wrong passcode cannot save');
r = await call('PUT', '/api/setup', { setup: setup('HACK') }, {});
ok(r.s === 401, 'no passcode cannot save');
r = await call('PUT', '/api/setup', { setup: setup('S2'), baseStamp: st1 }, { 'x-admin': A });
ok(r.s === 200 && r.j.stamp > st1, 'right passcode saves again');
const st2 = r.j.stamp;
r = await call('PUT', '/api/setup', { setup: setup('S3'), baseStamp: st1 }, { 'x-admin': A });
ok(r.s === 409, 'stale base is refused (someone saved newer)');
r = await call('GET', '/api/setup');
ok(r.j.setup.school === 'S2', 'refused save changed nothing');
r = await call('POST', '/api/login', { h2: A });
ok(r.s === 200 && r.j.ok, 'login ok with the right passcode');
r = await call('POST', '/api/login', { h2: B });
ok(r.s === 401 && !r.j.ok, 'login refused with a wrong passcode');
r = await call('POST', '/api/login', { h2: 'zzz' });
ok(r.s === 401, 'login refused with junk');
r = await call('POST', '/api/passcode', { h2: B, newAuth: C });
ok(r.s === 401, 'passcode change needs the old passcode');
r = await call('POST', '/api/passcode', { h2: A, newAuth: C });
ok(r.s === 200 && r.j.ok, 'passcode changed');
r = await call('POST', '/api/login', { h2: A });
ok(r.s === 401, 'old passcode no longer works');
r = await call('POST', '/api/login', { h2: C });
ok(r.j.ok, 'new passcode works');
r = await call('PUT', '/api/setup', { setup: { nope: 1 } }, { 'x-admin': C });
ok(r.s === 400, 'malformed setup refused');
r = await call('GET', '/api/nothing');
ok(r.s === 404, 'unknown path is 404');

// ---------- results
const rs = (id, over = {}) => ({ id, cid: 'b1', eid: 'e1', name: 'Okafor  Ngozi', subject: 'Maths', title: 'T', score: 3, total: 5, pct: 60, submittedAt: 1000, startedAt: 500, usedSec: 500, ...over });
const setupR = { v: 2, stamp: 0, school: 'S', adminHash: 'x', classes: [{ id: 'b1', name: 'Basic 1', roster: ['Okafor Ngozi', 'Bello Amina'], exams: [{ id: 'e1', subject: 'Maths' }] }] };
mem.clear();
r = await call('POST', '/api/result', { results: [rs('aaaa1111')] });
ok(r.s === 409 && r.j.error === 'no_setup', 'result before any setup is refused');
await call('PUT', '/api/setup', { setup: setupR, baseStamp: 0 }, { 'x-admin': A });
r = await call('POST', '/api/result', { results: [rs('aaaa1111')] });
ok(r.s === 200 && r.j.accepted.includes('aaaa1111') && r.j.rejected.length === 0, 'valid result accepted (name spacing and case forgiven)');
r = await call('POST', '/api/result', { results: [rs('aaaa1111')] });
ok(r.j.accepted.includes('aaaa1111'), 'sending the same result again is accepted, not duplicated');
let g = await call('GET', '/api/results', null, { 'x-admin': A });
ok(g.s === 200 && g.j.results.length === 1, 'repeat stored once');
g = await call('GET', '/api/results');
ok(g.s === 401, 'results cannot be read without the passcode');
g = await call('GET', '/api/results', null, { 'x-admin': B });
ok(g.s === 401, 'results cannot be read with a wrong passcode');
r = await call('POST', '/api/result', { results: [rs('bbbb2222', { name: 'Nobody Here' })] });
ok(r.j.rejected[0].reason === 'unknown_name', 'name not on the class list is rejected');
r = await call('POST', '/api/result', { results: [rs('cccc3333', { eid: 'nope' })] });
ok(r.j.rejected[0].reason === 'unknown_paper', 'unknown paper is rejected');
r = await call('POST', '/api/result', { results: [rs('dddd4444', { score: 'lots' })] });
ok(r.j.rejected[0].reason === 'bad', 'non-numeric score is rejected');
r = await call('POST', '/api/result', { results: [rs('x'), rs('eeee5555', { submittedAt: 2000 }), rs('ffff6666', { submittedAt: 3000 }), rs('gggg7777', { submittedAt: 4000 })] });
ok(r.j.rejected.some((x) => x.id === 'x') && r.j.accepted.length === 2 && r.j.rejected.some((x) => x.reason === 'too_many'), 'bad id refused, and a child cannot store more than 3 copies per paper');
r = await call('POST', '/api/result', { results: [rs('hhhh8888', { name: 'Bello Amina' })] });
const upTo = (await call('GET', '/api/results', null, { 'x-admin': A })).j.upTo;
await new Promise((z) => setTimeout(z, 5));
r = await call('POST', '/api/result', { results: [rs('iiii9999', { name: 'Bello Amina', eid: 'e1', submittedAt: 9 })] });
g = await call('GET', '/api/results?since=' + upTo, null, { 'x-admin': A });
ok(g.j.results.length === 1 && g.j.results[0].id === 'iiii9999', 'since returns only newer results');
g = await call('GET', '/api/results', null, { 'x-admin': A });
ok(g.j.results.length === 5, 'examiner reads all stored results: ' + g.j.results.length);
r = await call('DELETE', '/api/results', null, { 'x-admin': B });
ok(r.s === 401, 'only the examiner can clear server results');
r = await call('DELETE', '/api/results', null, { 'x-admin': A });
g = await call('GET', '/api/results', null, { 'x-admin': A });
ok(r.j.ok && g.j.results.length === 0, 'examiner can clear server results');
r = await call('POST', '/api/result', { results: [rs('aaaa1111')] });
ok(r.j.accepted.length === 1, 'after clearing, the same child can be stored again');
r = await call('GET', '/api/setup');
ok(r.j.setup && r.j.setup.school === 'S', 'clearing results leaves the setup alone');


// ---------- lockout
const h3 = makeHandler(store, { failDelayMs: 1, maxFails: 4, lockMs: 60 });
mem.clear();
const call3 = async (method, path, body, headers = {}) => {
  const r = await h3(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', ...headers } }));
  return { s: r.status, j: await r.json() };
};
await call3('PUT', '/api/setup', { setup: setupR, baseStamp: 0 }, { 'x-admin': A });
let last;
for (let i = 0; i < 4; i++) last = await call3('POST', '/api/login', { h2: B });
r = await call3('POST', '/api/login', { h2: A });
ok(r.s === 429 && r.j.locked, 'after repeated wrong guesses even the right passcode is locked out for a while');
r = await call3('PUT', '/api/setup', { setup: setupR, baseStamp: 0 }, { 'x-admin': A });
ok(r.s === 429, 'saving is locked out too');
await new Promise((z) => setTimeout(z, 90));
r = await call3('POST', '/api/login', { h2: A });
ok(r.s === 200 && r.j.ok, 'lockout ends and the right passcode works again');
await call3('POST', '/api/login', { h2: B });
r = await call3('POST', '/api/login', { h2: A });
ok(r.s === 200, 'a success clears the failed-guess count');

// ---------- licence
const VK = 'vendor-secret-key-123456';
const h4 = makeHandler(store, { failDelayMs: 1, vendorKey: VK });
const call4 = async (method, path, body, headers = {}) => {
  const r = await h4(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', ...headers } }));
  return { s: r.status, j: await r.json() };
};
const V = { 'x-vendor': VK };
const roster = (n) => Array.from({ length: n }, (_, i) => 'Child ' + i);
const sized = (n) => ({ v: 2, stamp: 0, school: 'L', adminHash: 'x', classes: [{ id: 'c1', name: 'C1', roster: roster(n), exams: [{ id: 'e1', subject: 'Maths', title: 'T', questions: [] }] }] });
mem.clear();
r = await call4('GET', '/api/licence');
ok(r.j.licence.set === false && r.j.licence.status === 'none', 'no licence set: reported as none');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: Date.now() + 86400000 }, {});
ok(r.s === 403, 'licence cannot be set without the vendor key');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: Date.now() + 86400000 }, { 'x-vendor': 'wrong-key-wrong-key-1' });
ok(r.s === 403, 'licence cannot be set with a wrong vendor key');
const hOff = makeHandler(store, { failDelayMs: 1 });
r = await (await hOff(new Request('http://x/api/licence', { method: 'PUT', body: JSON.stringify({ plan: 'core', paidUntil: 1 }), headers: { 'x-vendor': 'anything-anything-12' } }))).json();
ok(r.error === 'vendor_disabled', 'with no vendor key configured, licence setting is disabled');
r = await call4('PUT', '/api/licence', { plan: 'gold', paidUntil: Date.now() + 1e8 }, V);
ok(r.s === 400 && r.j.error === 'bad_plan', 'unknown plan rejected');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: 'not a date' }, V);
ok(r.s === 400 && r.j.error === 'bad_date', 'bad date rejected');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: Date.now() + 30 * 86400000, school: 'Edupeak' }, V);
ok(r.s === 200 && r.j.licence.cap === 200 && r.j.licence.status === 'active' && r.j.licence.enforce === 'block', 'core licence set: cap 200 from the plan, active, blocking');
r = await call4('GET', '/api/setup');
ok(r.j.licence && r.j.licence.plan === 'core' && !JSON.stringify(r.j).includes(VK), 'GET /api/setup carries the licence summary and never the vendor key');
r = await call4('PUT', '/api/setup', { setup: sized(200), baseStamp: 0 }, { 'x-admin': A });
ok(r.s === 200 && r.j.licence.students === 200, 'exactly at the cap saves');
const stL = r.j.stamp;
r = await call4('PUT', '/api/setup', { setup: sized(201), baseStamp: stL }, { 'x-admin': A });
ok(r.s === 402 && r.j.error === 'over_cap' && r.j.cap === 200 && r.j.count === 201, 'one over the cap is refused with the numbers');
r = await call4('GET', '/api/setup', null, { 'x-admin': A });
ok(r.j.setup.classes[0].roster.length === 200, 'refused save left the stored setup unchanged');
await call4('PUT', '/api/licence', { plan: 'core', cap: 150, paidUntil: Date.now() + 30 * 86400000 }, V);
r = await call4('PUT', '/api/setup', { setup: sized(180), baseStamp: stL }, { 'x-admin': A });
ok(r.s === 200, 'a school already over its cap can still shrink or edit without adding children');
const stL2 = r.j.stamp;
r = await call4('PUT', '/api/setup', { setup: sized(181), baseStamp: stL2 }, { 'x-admin': A });
ok(r.s === 402, 'but cannot add more children while over the cap');
await call4('PUT', '/api/licence', { plan: 'core', cap: 150, enforce: 'warn', paidUntil: Date.now() + 30 * 86400000 }, V);
r = await call4('PUT', '/api/setup', { setup: sized(185), baseStamp: stL2 }, { 'x-admin': A });
ok(r.s === 200 && r.j.warn === 'over_cap', 'warn mode saves but flags the overage');
const stL3 = r.j.stamp;
await call4('PUT', '/api/licence', { plan: 'core', paidUntil: Date.now() - 5 * 86400000, graceDays: 14 }, V);
r = await call4('GET', '/api/licence');
ok(r.j.licence.status === 'grace', 'a few days after the paid-until date is the grace period');
r = await call4('PUT', '/api/setup', { setup: sized(150), baseStamp: stL3 }, { 'x-admin': A });
ok(r.s === 200, 'saving still works during grace');
const stL4 = r.j.stamp;
await call4('PUT', '/api/licence', { plan: 'core', paidUntil: Date.now() - 40 * 86400000, graceDays: 14 }, V);
r = await call4('PUT', '/api/setup', { setup: sized(150), baseStamp: stL4 }, { 'x-admin': A });
ok(r.s === 402 && r.j.error === 'licence_expired', 'after grace, saving the setup is refused');
const rid = 'res-licence-0001';
r = await call4('POST', '/api/result', { results: [{ id: rid, cid: 'c1', name: 'Child 1', eid: 'e1', subject: 'Maths', title: 'T', score: 1, total: 2, pct: 50, startedAt: 1, submittedAt: 2, usedSec: 1 }] });
ok(r.s === 200 && r.j.accepted.includes(rid), 'results are still accepted when the licence has expired');
r = await call4('POST', '/api/login', { h2: A });
ok(r.s === 200, 'examiner sign-in still works when expired');
r = await call4('GET', '/api/results', null, { 'x-admin': A });
ok(r.s === 200 && r.j.results.length === 1, 'examiner can still read results when expired');
await call4('PUT', '/api/licence', { plan: 'growth', paidUntil: Date.now() + 90 * 86400000 }, V);
r = await call4('PUT', '/api/setup', { setup: sized(450), baseStamp: stL4 }, { 'x-admin': A });
ok(r.s === 200 && r.j.licence.plan === 'growth' && r.j.licence.cap === 500, 'renewing and upgrading takes effect at once, no redeploy');

// ---------- suspend / deactivate / CORS
mem.clear();
const future = Date.now() + 60 * 86400000;
await call4('PUT', '/api/licence', { plan: 'core', paidUntil: future }, V);
r = await call4('PUT', '/api/setup', { setup: sized(5), baseStamp: 0 }, { 'x-admin': A });
const stS = r.j.stamp;
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: future, state: 'suspended' }, V);
ok(r.j.licence.status === 'suspended' && r.j.licence.state === 'suspended', 'suspend sets status suspended even though paid');
r = await call4('PUT', '/api/setup', { setup: sized(6), baseStamp: stS }, { 'x-admin': A });
ok(r.s === 402 && r.j.error === 'licence_suspended', 'suspended school cannot save setup');
r = await call4('POST', '/api/login', { h2: A });
ok(r.s === 200, 'suspended examiner can still sign in');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: future + 86400000 }, V);
ok(r.j.licence.state === 'suspended', 'renewing without a state keeps the school suspended');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: future, state: 'off' }, V);
ok(r.j.licence.status === 'deactivated', 'deactivate');
r = await call4('PUT', '/api/setup', { setup: sized(6), baseStamp: stS }, { 'x-admin': A });
ok(r.s === 402 && r.j.error === 'licence_off', 'deactivated school cannot save setup');
r = await call4('GET', '/api/setup');
ok(r.j.licence.status === 'deactivated' && r.j.setup.classes.length === 1, 'devices can see the deactivated status and the setup is kept');
r = await call4('POST', '/api/result', { results: [{ id: 'res-deact-00001', cid: 'c1', name: 'Child 1', eid: 'e1', subject: 'Maths', title: 'T', score: 1, total: 2, pct: 50, startedAt: 1, submittedAt: 2, usedSec: 1 }] });
ok(r.s === 200 && r.j.accepted.length === 1, 'a result submitted by a sitting already under way is still accepted when deactivated');
r = await call4('GET', '/api/results', null, { 'x-admin': A });
ok(r.s === 200 && r.j.results.length === 1, 'stored results are kept and readable when deactivated');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: future, state: 'on' }, V);
ok(r.j.licence.status === 'active', 'reactivate');
r = await call4('PUT', '/api/setup', { setup: sized(6), baseStamp: stS }, { 'x-admin': A });
ok(r.s === 200, 'saving works again after reactivation');
r = await call4('PUT', '/api/licence', { plan: 'core', paidUntil: future, state: 'maybe' }, V);
ok(r.s === 400 && r.j.error === 'bad_state', 'bad state rejected');
const pre = await h4(new Request('http://x/api/licence', { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'x-vendor,content-type' } }));
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && /x-vendor/.test(pre.headers.get('access-control-allow-headers')), 'CORS preflight allowed for the licence address');
const gl = await h4(new Request('http://x/api/licence'));
ok(gl.headers.get('access-control-allow-origin') === '*', 'licence GET readable from the console');
const bad403 = await h4(new Request('http://x/api/licence', { method: 'PUT', body: '{}', headers: { 'x-vendor': 'nope' } }));
ok(bad403.status === 403 && bad403.headers.get('access-control-allow-origin') === '*', 'a refused change is still readable by the console');
const noCors = await h4(new Request('http://x/api/results'));
ok(!noCors.headers.get('access-control-allow-origin'), 'other addresses are NOT opened to other sites');


// ---------- marks (teacher marks with a change record)
mem.clear();
await call4('PUT', '/api/setup', { setup: setupR, baseStamp: 0 }, { 'x-admin': A });
await call4('POST', '/api/result', { results: [rs('mark0001')] });
const mk = (m, at, h = []) => ({ rid: 'mark0001', qi: 2, rec: { m, by: 'Mrs Ade', at, h } });
r = await call4('POST', '/api/marks', { marks: [mk(3, 1000, [{ m: 3, from: 1, by: 'Mrs Ade', at: 1000 }])] });
ok(r.s === 401, 'marks cannot be saved without the passcode');
r = await call4('POST', '/api/marks', { marks: [mk(3, 1000, [{ m: 3, from: 1, by: 'Mrs Ade', at: 1000 }])] }, { 'x-admin': A });
ok(r.s === 200 && r.j.accepted.length === 1 && !r.j.rejected.length, 'a mark is accepted with the passcode');
r = await call4('POST', '/api/marks', { marks: [mk(4, 2000, [{ m: 4, from: 3, by: 'Mr Bako', at: 2000 }])] }, { 'x-admin': A });
let gm = await call4('GET', '/api/marks?since=0', null, { 'x-admin': A });
ok(gm.s === 200 && gm.j.marks.length === 1 && gm.j.marks[0].rec.m === 4, 'the newer mark wins');
ok(gm.j.marks[0].rec.h.length === 2, 'the change record from both edits is kept');
r = await call4('POST', '/api/marks', { marks: [mk(3, 1000, [{ m: 3, from: 1, by: 'Mrs Ade', at: 1000 }])] }, { 'x-admin': A });
gm = await call4('GET', '/api/marks?since=0', null, { 'x-admin': A });
ok(gm.j.marks[0].rec.m === 4 && gm.j.marks[0].rec.h.length === 2, 'an older copy arriving late changes nothing');
const upM = gm.j.upTo;
gm = await call4('GET', '/api/marks?since=' + upM, null, { 'x-admin': A });
ok(gm.j.marks.length === 0, 'asking since the last pull returns nothing new');
gm = await call4('GET', '/api/marks');
ok(gm.s === 401, 'marks cannot be read without the passcode');
r = await call4('POST', '/api/marks', { marks: [{ rid: 'nope0000', qi: 0, rec: { m: 1, by: 'x', at: 5, h: [] } }, { rid: 'mark0001', qi: 1, rec: { m: -2, by: 'x', at: 5, h: [] } }] }, { 'x-admin': A });
ok(r.j.rejected.length === 2 && !r.j.accepted.length, 'a mark for an unknown result or a negative mark is refused');
await call4('PUT', '/api/licence', { plan: 'core', paidUntil: Date.now() + 86400000, state: 'suspended' }, V);
r = await call4('POST', '/api/marks', { marks: [mk(5, 3000)] }, { 'x-admin': A });
ok(r.s === 402 && /licence_/.test(r.j.error), 'marks cannot be saved while the licence is suspended');
gm = await call4('GET', '/api/marks?since=0', null, { 'x-admin': A });
ok(gm.s === 200 && gm.j.marks.length === 1, 'marks can still be read while suspended');
r = await call4('DELETE', '/api/results', null, { 'x-admin': A });
gm = await call4('GET', '/api/marks?since=0', null, { 'x-admin': A });
ok(gm.j.marks.length === 0, 'clearing results also clears marks');


// ---------- Growth: teacher accounts
mem.clear();
const TA = sha('xd-auth:adepass1'), TB = sha('xd-auth:bakopass'), TX = sha('xd-auth:wrong');
const setupG = { v: 2, stamp: 0, school: 'S', adminHash: 'x', classes: [{ id: 'b1', name: 'Basic 1', roster: ['Okafor Ngozi', 'Bello Amina'], armOf: { 'Okafor Ngozi': 'A', 'Bello Amina': 'B' }, arms: ['A', 'B'], exams: [{ id: 'e1', subject: 'Maths' }, { id: 'e2', subject: 'English' }] }] };
await call4('PUT', '/api/setup', { setup: setupG, baseStamp: 0 }, { 'x-admin': A });
await call4('PUT', '/api/licence', { plan: 'growth', paidUntil: Date.now() + 86400000 * 30, state: 'on' }, V);
await call4('POST', '/api/result', { results: [rs('g0000001', { eid: 'e1' }), rs('g0000002', { eid: 'e1', name: 'Bello Amina' }), rs('g0000003', { eid: 'e2', name: 'Bello Amina' })] });
r = await call4('GET', '/api/teachers');
ok(r.s === 401, 'teacher list needs the administrator passcode');
r = await call4('PUT', '/api/teachers', { teachers: [{ name: 'Mrs Ade', h2: TA, form: [{ cid: 'b1', arm: 'A' }] }, { name: 'Mr Bako', h2: TB, subj: [{ cid: 'b1', subject: 'English' }] }, { name: 'Mrs Lock', h2: sha('xd-auth:lockpass') }] }, { 'x-admin': A });
ok(r.s === 200 && r.j.teachers.length === 3 && !JSON.stringify(r.j).includes(TA), 'administrator saves three teachers (passcodes never come back)');
const idAde = r.j.teachers[0].id, idBako = r.j.teachers[1].id;
r = await call4('PUT', '/api/teachers', { teachers: [{ name: 'Mrs Ade', h2: TA }, { name: 'mrs  ade', h2: TA }] }, { 'x-admin': A });
ok(r.s === 400 && r.j.error === 'duplicate_name', 'two teachers cannot share a name');
r = await call4('PUT', '/api/teachers', { teachers: [{ name: 'Mrs Clone', h2: A }] }, { 'x-admin': A });
ok(r.s === 400 && r.j.error === 'same_as_admin', 'a teacher cannot use the administrator passcode');
r = await call4('PUT', '/api/teachers', { teachers: [{ name: 'No Passcode' }] }, { 'x-admin': A });
ok(r.s === 400 && r.j.error === 'passcode_needed', 'a new teacher needs a passcode');
r = await call4('POST', '/api/login', { h2: TA, user: 'mrs ade' });
ok(r.s === 200 && r.j.role === 'teacher' && r.j.teacher.form[0].arm === 'A', 'teacher signs in by name (case and spacing forgiven)');
r = await call4('POST', '/api/login', { h2: TX, user: 'Mrs Ade' });
ok(r.s === 401, 'wrong teacher passcode refused');
r = await call4('POST', '/api/login', { h2: TA, user: 'Nobody' });
ok(r.s === 401, 'unknown teacher name refused');
r = await call4('POST', '/api/login', { h2: TA });
ok(r.s === 401, 'a teacher passcode does not open the administrator account');
r = await call4('POST', '/api/login', { h2: A });
ok(r.s === 200 && r.j.role === 'admin', 'administrator login still works');
for (let i = 0; i < 12; i++) await call4('POST', '/api/login', { h2: TX, user: 'Mrs Lock' });
r = await call4('POST', '/api/login', { h2: sha('xd-auth:lockpass'), user: 'Mrs Lock' });
ok(r.s === 429, 'a teacher who keeps guessing is locked out');
r = await call4('POST', '/api/login', { h2: A });
ok(r.j.ok, 'the administrator is not locked by a teacher’s wrong guesses');
r = await call4('POST', '/api/login', { h2: TA, user: 'Mrs Ade' });
ok(r.j.ok, 'other teachers are not locked either');
let gr = await call4('GET', '/api/results?since=0', null, { 'x-admin': A });
ok(gr.j.results.length === 3, 'administrator sees all 3 results');
gr = await call4('GET', '/api/results?since=0', null, { 'x-admin': TA, 'x-user': idAde });

ok(gr.j.results.length === 1 && nk(gr.j.results[0].name) === 'okafor ngozi', 'form teacher of arm A gets exactly Okafor Ngozi’s result');
gr = await call4('GET', '/api/results?since=0', null, { 'x-admin': TB, 'x-user': idBako });
ok(gr.s === 200 && gr.j.results.length === 1 && gr.j.results[0].eid === 'e2', 'subject teacher (English) gets only the English paper');
gr = await call4('GET', '/api/results?since=0', null, { 'x-admin': TA, 'x-user': idBako });
ok(gr.s === 401, 'a teacher’s passcode under another teacher’s id is refused');
const mkr = (rid, who, m, at, from = 0) => ({ rid, qi: 1, rec: { m, by: who, at, h: [{ m, from, by: who, at }] } });
r = await call4('POST', '/api/marks', { marks: [mkr('g0000001', 'Mrs Ade', 2, 5000)] }, { 'x-admin': TA, 'x-user': idAde });
ok(r.s === 200 && r.j.accepted.length === 1, 'form teacher marks a child in her arm');
r = await call4('POST', '/api/marks', { marks: [mkr('g0000002', 'Mrs Ade', 2, 5000)] }, { 'x-admin': TA, 'x-user': idAde });
ok(r.j.rejected.length === 1 && r.j.rejected[0].reason === 'not_allowed', 'form teacher cannot mark a child in another arm');
r = await call4('POST', '/api/marks', { marks: [mkr('g0000001', 'Mr Bako', 2, 6000)] }, { 'x-admin': TB, 'x-user': idBako });
ok(r.j.rejected[0].reason === 'not_allowed', 'English teacher cannot mark a Maths paper');
r = await call4('POST', '/api/marks', { marks: [mkr('g0000003', 'Mr Bako', 3, 6000)] }, { 'x-admin': TB, 'x-user': idBako });
ok(r.j.accepted.length === 1, 'English teacher marks an English paper');
r = await call4('POST', '/api/marks', { marks: [mkr('g0000003', 'Mrs Ade', 1, 7000)] }, { 'x-admin': TB, 'x-user': idBako });
ok(r.j.rejected[0].reason === 'wrong_name', 'a teacher cannot record a change under someone else’s name');
gm = await call4('GET', '/api/marks?since=0', null, { 'x-admin': TB, 'x-user': idBako });
ok(gm.j.marks.length === 1 && gm.j.marks[0].rid === 'g0000003', 'a teacher only reads marks on results they may see');
gm = await call4('GET', '/api/marks?since=0', null, { 'x-admin': A });
ok(gm.j.marks.length === 2, 'administrator reads all marks');
r = await call4('POST', '/api/marks', { marks: [mkr('g0000003', 'Head', 4, 8000, 3)] }, { 'x-admin': A });
gm = await call4('GET', '/api/marks?since=0', null, { 'x-admin': TB, 'x-user': idBako });
ok(gm.j.marks[0].rec.m === 4 && gm.j.marks[0].rec.h.length === 2, 'administrator can override a teacher and both changes stay in the record');
r = await call4('PUT', '/api/teachers', { teachers: [] }, { 'x-admin': TA, 'x-user': idAde });
ok(r.s === 401, 'a teacher cannot manage teachers');
r = await call4('DELETE', '/api/results', null, { 'x-admin': TA, 'x-user': idAde });
ok(r.s === 200 || true, 'delete check runs');
gr = await call4('GET', '/api/results?since=0', null, { 'x-admin': A });
ok(gr.j.results.length === 3, 'a teacher sending x-user cannot clear results with their own passcode');
r = await call4('GET', '/api/me', null, { 'x-admin': TA, 'x-user': idAde });
ok(r.j.role === 'teacher' && r.j.teacher.name === 'Mrs Ade', 'a signed-in teacher can read their own assignments');
r = await call4('PUT', '/api/teachers', { teachers: [{ id: idAde, name: 'Mrs Ade', form: [{ cid: 'b1', arm: 'B' }] }, { id: idBako, name: 'Mr Bako' }] }, { 'x-admin': A });
ok(r.s === 200, 'administrator changes assignments without re-entering passcodes');
r = await call4('POST', '/api/login', { h2: TA, user: 'Mrs Ade' });
ok(r.j.ok && r.j.teacher.form[0].arm === 'B', 'old passcode still works and the new arm applies');
gr = await call4('GET', '/api/results?since=0', null, { 'x-admin': TA, 'x-user': idAde });
ok(gr.j.results.length === 2 && gr.j.results.every((x) => nk(x.name) === 'bello amina'), 'the new arm takes effect at once on the server');
r = await call4('PUT', '/api/teachers', { teachers: [{ id: idAde, name: 'Mrs Ade' }] }, { 'x-admin': A });
r = await call4('POST', '/api/login', { h2: TB, user: 'Mr Bako' });
ok(r.s === 401, 'a removed teacher can no longer sign in');
await call4('PUT', '/api/licence', { plan: 'core', paidUntil: Date.now() + 86400000 * 30, state: 'on' }, V);
r = await call4('PUT', '/api/teachers', { teachers: [] }, { 'x-admin': A });
ok(r.s === 403 && r.j.error === 'plan', 'teacher accounts are refused on the Core plan');
r = await call4('POST', '/api/login', { h2: TA, user: 'Mrs Ade' });
ok(r.s === 401, 'teacher sign-in is refused on the Core plan');

// ---- class lists are private until a class code unlocks them; the vendor can reset the administrator passcode
mem.clear();
const hU = makeHandler(store, { failDelayMs: 1, vendorKey: VK, unlockFails: 4 });
const cU = async (method, path, body, headers = {}) => {
  const r = await hU(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', ...headers } }));
  return { s: r.status, j: await r.json() };
};
const IP = (n) => ({ 'x-nf-client-connection-ip': '10.0.0.' + n });
const ex1 = { id: 'e1', subject: 'Maths', title: 'T', open: true, questions: [{ q: 'x' }] }, ex2 = { id: 'e2', subject: 'Eng', title: 'T2', open: false, questions: [{ q: 'y' }] };
const setupU = { v: 2, stamp: 0, school: 'S', adminHash: 'x', classes: [
  { id: 'b1', name: 'Basic 1', hue: 1, code: 'K7M-2Q', prevCodes: ['OLDCODE'], roster: ['Okafor Ngozi', 'Bello Amina'], armOf: { 'Bello Amina': 'A' }, exams: [ex1, ex2] },
  { id: 'b2', name: 'Basic 2', hue: 2, code: '', roster: ['Ade Tunde'], exams: [] },
] };
r = await cU('PUT', '/api/setup', { setup: setupU, baseStamp: 0 }, { 'x-admin': A });
ok(r.s === 200, 'U: setup with class codes saves');
r = await cU('GET', '/api/setup');
const pj = JSON.stringify(r.j);
ok(r.j.setup.pub === true && r.j.setup.classes.length === 2 && r.j.setup.classes.every((c) => c.locked && c.roster.length === 0 && c.exams.length === 0), 'U: the public page gets class names only');
ok(!/Okafor|Bello|Ade Tunde|K7M|OLDCODE|Maths|Eng\b/.test(pj), 'U: no names, codes, subjects or papers in the public copy');
ok(r.j.setup.classes[0].hasOpen === true && r.j.setup.classes[1].hasOpen === false, 'U: the public copy says only whether a paper is open');
r = await cU('GET', '/api/setup', null, { 'x-admin': B });
ok(r.j.setup.pub === true && r.j.authFailed === true, 'U: a wrong passcode gets the public copy and is told it failed');
r = await cU('GET', '/api/setup', null, { 'x-admin': A });
ok(!r.j.setup.pub && r.j.setup.classes[0].code === 'K7M-2Q' && r.j.setup.classes[0].roster.length === 2 && !r.j.authFailed, 'U: the administrator gets the full setup');
r = await cU('PUT', '/api/setup', { setup: { ...setupU, pub: true, classes: setupU.classes.map((c) => ({ ...c, locked: true, roster: [] })) }, baseStamp: 0, force: true }, { 'x-admin': A });
ok(r.s === 400 && r.j.error === 'public_copy', 'U: a public copy can never overwrite the real setup');

r = await cU('POST', '/api/unlock', { cid: 'b1', code: 'wrong' }, IP(1));
ok(r.s === 401 && !JSON.stringify(r.j).includes('Okafor'), 'U: a wrong class code gets nothing');
r = await cU('POST', '/api/unlock', { cid: 'b2', code: '' }, IP(1));
ok(r.s === 401 && r.j.error === 'no_code', 'U: a class with no code cannot be opened');
r = await cU('POST', '/api/unlock', { cid: 'b1', code: ' k7m-2q ' }, IP(2));
const tokU = r.j.tok;
ok(r.s === 200 && r.j.cls.roster.length === 2 && r.j.cls.exams.length === 1 && r.j.cls.exams[0].id === 'e1', 'U: the right code (any case) opens the class with its open papers only');
ok(r.j.cls.code === undefined && r.j.cls.prevCodes === undefined && r.j.cls.armOf === undefined, 'U: the opened class carries no codes or arm data');
for (let i = 0; i < 4; i++) await cU('POST', '/api/unlock', { cid: 'b1', code: 'g' + i }, IP(3));
r = await cU('POST', '/api/unlock', { cid: 'b1', code: 'K7M-2Q' }, IP(3));
ok(r.s === 429, 'U: too many wrong codes from one address locks that address, even for the right code');
r = await cU('POST', '/api/unlock', { cid: 'b1', code: 'K7M-2Q' }, IP(4));
ok(r.s === 200, 'U: other addresses are not affected');

const rsU = (id, over = {}) => ({ id, cid: 'b1', eid: 'e1', name: 'Okafor Ngozi', subject: 'Maths', title: 'T', score: 3, total: 5, pct: 60, submittedAt: 1000, startedAt: 500, usedSec: 500, ...over });
r = await cU('POST', '/api/result', { results: [rsU('u0000001')] }, IP(5));
ok(r.j.rejected.length === 1 && r.j.rejected[0].reason === 'bad_token', 'U: a result with no token is refused');
r = await cU('POST', '/api/result', { results: [rsU('u0000002', { tok: 'a'.repeat(64) })] }, IP(5));
ok(r.j.rejected.length === 1 && r.j.rejected[0].reason === 'bad_token', 'U: a result with a made-up token is refused');
r = await cU('POST', '/api/result', { results: [rsU('u0000003', { tok: tokU })] }, IP(5));
ok(r.j.accepted.length === 1, 'U: a result with the class token is accepted');
const oldTok = createHash('sha256').update('xd-tok:b1:oldcode').digest('hex');
r = await cU('POST', '/api/result', { results: [rsU('u0000004', { tok: oldTok, name: 'Bello Amina' })] }, IP(5));
ok(r.j.accepted.length === 1, 'U: a token from a previous code still lands (a code change never loses results)');
let gU = await cU('GET', '/api/results?since=0', null, { 'x-admin': A });
ok(gU.j.results.length === 2 && gU.j.results.every((x) => x.tok === undefined), 'U: the token is not kept with the stored result');
for (let i = 0; i < 4; i++) await cU('POST', '/api/result', { results: [rsU('u00000' + (10 + i), { tok: 'b'.repeat(64) })] }, IP(6));
r = await cU('POST', '/api/result', { results: [rsU('u0000020', { tok: tokU })] }, IP(6));
ok(r.s === 429, 'U: guessing result tokens locks that address too');

r = await cU('POST', '/api/reset-admin', { h2: C }, {});
ok(r.s === 403, 'U: reset needs the vendor key');
r = await cU('POST', '/api/reset-admin', { h2: C }, { 'x-vendor': 'wrong-key-wrong-key' });
ok(r.s === 403, 'U: reset refuses a wrong vendor key');
r = await cU('POST', '/api/reset-admin', { h2: 'nothex' }, V);
ok(r.s === 400, 'U: reset refuses a malformed passcode');
r = await cU('POST', '/api/reset-admin', { h2: C }, V);
ok(r.s === 200 && r.j.ok, 'U: the vendor key resets the administrator passcode');
r = await cU('POST', '/api/login', { h2: A });
ok(r.s === 401, 'U: the old passcode stops working');
r = await cU('POST', '/api/login', { h2: C });
ok(r.s === 200 && r.j.role === 'admin', 'U: the new temporary passcode works');
r = await cU('GET', '/api/setup', null, { 'x-admin': C });
ok(!r.j.setup.pub && r.j.setup.classes[0].roster.length === 2, 'U: setup and results survive a reset');
const o = await hU(new Request('http://x/api/reset-admin', { method: 'OPTIONS' }));
ok(o.status === 204 && /POST/.test(o.headers.get('access-control-allow-methods')), 'U: the console can call reset from a browser');
mem.clear();
r = await cU('POST', '/api/reset-admin', { h2: C }, V);
ok(r.s === 409 && r.j.error === 'not_claimed', 'U: an unclaimed site cannot be claimed by a reset');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
