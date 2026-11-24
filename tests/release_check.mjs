// Release guard (added after s1-0.9.0 shipped an empty sw.js): the offline file must be complete and in step.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sw = readFileSync('sw.js', 'utf8');
const app = readFileSync('js/app.js', 'utf8');
const ver = app.match(/APP_VERSION = '([^']+)'/)?.[1];
ok(sw.length > 1000, `sw.js is not empty (${sw.length} bytes)`);
ok(sw.includes(`const CACHE = 'smg-${ver}'`), `sw.js cache name matches APP_VERSION ${ver}`);
ok(/addEventListener\('fetch'/.test(sw), 'sw.js handles fetch (offline)');
const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
ok(shell.every(f => existsSync(f)), `every offline file exists (${shell.filter(f => !existsSync(f)).join(', ') || 'all'})`);
const js = readdirSync('js').filter(f => f.endsWith('.js'));
ok(js.every(f => shell.includes(`js/${f}`)), `every js file is cached for offline (${js.filter(f => !shell.includes(`js/${f}`)).join(', ') || 'all'})`);
for (const f of ['index.html', 'css/app.css', ...js.map(f => `js/${f}`)]) ok(readFileSync(f, 'utf8').length > 100, `${f} is not empty`);
console.log(fails ? `${fails} release checks FAILED` : 'All release checks passed');
process.exit(fails ? 1 : 0);
