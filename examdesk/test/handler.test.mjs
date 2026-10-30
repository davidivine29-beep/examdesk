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
r = await call4('GET', '/api/setup');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
