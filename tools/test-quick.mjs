#!/usr/bin/env node
// tools/test-quick.mjs — the test suite without its slowest files, for small changes (wjx instance).
//
//   node tools/test-quick.mjs [extra node --test flags]     (npm run test:quick)
//
// `npm test` (node --test) runs every .js / .mjs / .cjs under test/ (Node's default patterns); this runs the same set
// minus SLOW below — whole-match soaks (20 seeds × every difficulty), fuzzers, the facing-invariance sweep, client-combat
// replays, the timing benchmarks (they flake under load anyway), the real-websocket co-op run, the golden self-check and
// the boss-HP whole matches. Together they are about 60 % of the summed test time and the longest single tests, so the
// wall clock drops from ~7 min to ~2 min. Run the full `npm test` (and `npm run golden`) before a deploy or after a
// change to the match flow, the bots, the sim core or the data.

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SLOW = [
  /^test\/match\/fullmatch(-coop\d*)?\.test\.js$/,
  /^test\/match\/fuzz\.test\.js$/,
  /^test\/sim\/fuzz\.test\.js$/,
  /^test\/sim\/facing-invariance\.test\.js$/,
  /^test\/match\/clientCombat(-review)?\.test\.js$/,
  /^test\/sim\/perf\.test\.js$/,
  /^test\/sim\/robustness\.test\.js$/,
  /^test\/match\/realtime\.test\.js$/,
  /^test\/match\/bosshp\.test\.js$/,
  /^test\/golden\.test\.js$/,
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(c|m)?js$/.test(name)) out.push(relative(ROOT, p).split('\\').join('/'));
  }
  return out;
}

const all = walk(join(ROOT, 'test'), []).sort();
const files = all.filter((f) => !SLOW.some((re) => re.test(f)));
console.log(`test:quick — ${files.length} of ${all.length} files (skipped: ${all.length - files.length} slow ones; full run: npm test)`);
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
