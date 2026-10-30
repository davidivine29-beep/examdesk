// Makes one ready-to-upload repo folder per plan from this master repo.
//   node tools/make-tier-repos.mjs            -> ../tier-repos/examdesk-core, -growth, -campus, -campus-max (+ .zip each)
//   node tools/make-tier-repos.mjs growth     -> only that plan
// Each folder has its plan fixed in the build (no TIER variable to set), no higher-plan code in the source,
// a finished public/index.html and cloudflare-upload/, and none of the vendor tools (console, set-licence).
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const master = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = resolve(master, '..', 'tier-repos');
const RANK = { core: 0, growth: 1, campus: 2, max: 3 };
const PLANS = [
  ['core', 'examdesk-core', 'Core'],
  ['growth', 'examdesk-growth', 'Growth'],
  ['campus', 'examdesk-campus', 'Campus'],
  ['max', 'examdesk-campus-max', 'Campus Max'],
];
const only = process.argv[2];
const todo = PLANS.filter((p) => !only || p[0] === only || p[1] === only);
if (!todo.length) { console.error('Unknown plan. Use core, growth, campus or max.'); process.exit(1); }

const SKIP = new Set(['node_modules', '.git', '.netlify', 'tools', 'cloudflare-upload', 'public']);
mkdirSync(outRoot, { recursive: true });

for (const [tier, name, label] of todo) {
  const dir = join(outRoot, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(master, dir, { recursive: true, filter: (src) => !SKIP.has(src.slice(master.length + 1).split(/[\\/]/)[0]) });
  // keep the static assets (icons, service worker) but not the old built page
  cpSync(join(master, 'public'), join(dir, 'public'), { recursive: true });
  rmSync(join(dir, 'public', 'index.html'), { force: true });

  // 1. source: drop code for higher plans, bake the plan in
  const sp = join(dir, 'src', 'examdesk.html');
  let src = readFileSync(sp, 'utf8')
    .replace(/\/\*@tier (growth|campus|max)\*\/([\s\S]*?)\/\*@end\*\//g, (m, t, body) => (RANK[tier] >= RANK[t] ? body : ''))
    .replace("'__TIER__'", "'" + tier + "'");
  if (src.includes('__TIER__')) throw new Error('tier marker missing in src/examdesk.html');
  writeFileSync(sp, src);

  // 2. build: the plan is fixed, so a school cannot switch it with an environment variable
  const bp = join(dir, 'build.mjs');
  let b = readFileSync(bp, 'utf8');
  const before = b;
  b = b.replace(/const TIER = .*;/, "const TIER = '" + tier + "';");
  if (b === before) throw new Error('could not fix the plan in build.mjs');
  writeFileSync(bp, b);

  // 3. package and README
  const pp = join(dir, 'package.json');
  const pj = JSON.parse(readFileSync(pp, 'utf8'));
  pj.name = name;
  pj.description = 'ExamDesk ' + label + ': a class-based computer-based test app for schools.';
  writeFileSync(pp, JSON.stringify(pj, null, 2) + '\n');
  const rp = join(dir, 'README.md');
  let rd = readFileSync(rp, 'utf8');
  const cut = rd.indexOf('## Licensing a school (vendor)');
  if (cut > 0) rd = rd.slice(0, cut).trimEnd() + '\n';
  writeFileSync(rp, '> **ExamDesk ' + label + '** repo. Generated from the ExamDesk master repo. Do not edit here: change the master and generate again.\n\n' + rd);
  writeFileSync(join(dir, 'PLAN.txt'), 'ExamDesk ' + label + ' (' + tier + ')\nGenerated ' + new Date().toISOString() + '\n');

  // 4. build the finished site and the Cloudflare upload folder
  const nm = join(dir, 'node_modules');
  symlinkSync(join(master, 'node_modules'), nm, 'dir');
  try {
    execFileSync('node', ['build.mjs'], { cwd: dir, stdio: 'inherit' });
    execFileSync('node', ['build-cloudflare.mjs'], { cwd: dir, stdio: 'inherit' });
  } finally { unlinkSync(nm); }
  if (!existsSync(join(dir, 'public', 'index.html'))) throw new Error('build produced no page for ' + name);

  // 5. zip (files at the top level, ready to upload to a new GitHub repo)
  const zip = join(outRoot, name + '.zip');
  rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', zip, '.'], { cwd: dir });
  console.log('made', name, '->', zip, Math.round(statSync(zip).size / 1024) + ' KB');
}
