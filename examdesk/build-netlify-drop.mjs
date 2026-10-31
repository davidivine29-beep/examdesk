// Makes netlify-upload/: a folder you can drag onto Netlify (no Git, no build) with the site and a single bundled server function.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
rmSync('netlify-upload', { recursive: true, force: true });
mkdirSync('netlify-upload/netlify/functions', { recursive: true });
for (const f of readdirSync('public')) cpSync('public/' + f, 'netlify-upload/' + f, { recursive: true });
await build({ entryPoints: ['netlify/functions/api.mjs'], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: 'netlify-upload/netlify/functions/api.mjs', logLevel: 'error' });
writeFileSync('netlify-upload/netlify.toml', '[build]\n  publish = "."\n  functions = "netlify/functions"\n\n[[headers]]\n  for = "/sw.js"\n  [headers.values]\n    Cache-Control = "no-cache"\n\n[[headers]]\n  for = "/index.html"\n  [headers.values]\n    Cache-Control = "no-cache"\n');
console.log('netlify-upload/ ready:', readdirSync('netlify-upload').join(', '));
