// Builds public/index.html: the app with its two libraries inside, so one file runs anywhere.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
// TIER decides which features are built in: core, growth, campus or max (set as an environment variable on each school's site).
// Code between /*@tier growth*/ and /*@end*/ is left out of any build below that tier.
const RANK = { core: 0, growth: 1, campus: 2, max: 3 };
const TIER = (process.env.TIER || 'core').trim().toLowerCase();
if (!(TIER in RANK)) throw new Error('TIER must be core, growth, campus or max (got "' + TIER + '")');
const srcRaw = readFileSync('src/examdesk.html', 'utf8');
const src = srcRaw
  .replace(/\/\*@tier (growth|campus|max)\*\/([\s\S]*?)\/\*@end\*\//g, (m, t, body) => (RANK[TIER] >= RANK[t] ? body : ''))
  .replace("'__TIER__'", "'" + TIER + "'");
if (src.includes('__TIER__')) throw new Error('tier marker not found in src/examdesk.html');
const zip = readFileSync('node_modules/jszip/dist/jszip.min.js', 'utf8');
const xlsx = readFileSync('node_modules/xlsx/dist/xlsx.full.min.js', 'utf8');
const RESET = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';
let b = src.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
const re = /<script src="https:\/\/cdnjs[^>]*jszip[^>]*><\/script>\s*<script src="https:\/\/cdnjs[^>]*xlsx[^>]*><\/script>/;
if (!re.test(b)) throw new Error('library tags not found in src/examdesk.html');
b = b.replace(re, () => '<script id="xd-lib-zip">' + zip + '</scr' + 'ipt>\n<script id="xd-lib-xlsx">' + xlsx + '</scr' + 'ipt>');
const i = b.indexOf('<style id="xd-style">');
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + RESET + '</style>\n' + b.slice(0, i) + '</head><body>\n' + b.slice(i) + '</body></html>\n';
mkdirSync('public', { recursive: true });
writeFileSync('public/index.html', html);
console.log('tier:', TIER, '-> public/index.html', Math.round(html.length / 1024) + ' KB');
