import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'index.html'), 'utf8');

const m = src.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no <script> block found'); process.exit(1); }
const js = m[1];

mkdirSync(join(here, 'tmp'), { recursive: true });
writeFileSync(join(here, 'tmp', 'full.js'), js);

const cut = js.indexOf('7. UI KERNEL');
if (cut < 0) { console.error('UI KERNEL marker not found'); process.exit(1); }
const head = js.lastIndexOf('/* ---', cut);
const backend = js.slice(0, head);

writeFileSync(join(here, 'tmp', 'backend.mjs'), backend + '\n\nexport { CONFIG, db, seed, server, api, totals, getCart, recomputeRatings, sha, makeToken, readToken, STATUSES };\n');

console.log('script bytes :', js.length);
console.log('backend bytes:', backend.length);
console.log('UI bytes     :', js.length - backend.length);