import { makeHandler } from '../lib/handler.mjs';
import { createHash } from 'node:crypto';
const mem = new Map();
const store = {
  get: async (k) => mem.get(k) ?? null,
  set: async (k, v) => void mem.set(k, v),
  delete: async (k) => void mem.delete(k),
  list: async (p) => [...mem.keys()].filter((k) => k.startsWith(p)).sort(),
};
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
