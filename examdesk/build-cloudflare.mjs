// Makes the git-free Cloudflare upload folder: the finished site plus one bundled _worker.js.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
rmSync('cloudflare-upload', { recursive: true, force: true });
mkdirSync('cloudflare-upload', { recursive: true });
for (const f of readdirSync('public')) cpSync('public/' + f, 'cloudflare-upload/' + f);
await build({ entryPoints: ['cloudflare/worker.mjs'], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: 'cloudflare-upload/_worker.js', minify: false, logLevel: 'warning' });
console.log('cloudflare-upload/ ready:', readdirSync('cloudflare-upload').join(', '));
