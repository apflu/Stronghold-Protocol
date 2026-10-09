// server/sim/content/loadFailures.js — the content modules that failed to load (wjx).
//
// The content loaders (content/index.js, bonds.js, bands.js, kits/index.js) replace a module that fails to load with an
// empty one, so the server keeps running. A browser must not simulate that way: a tablet reloading on a flaky network
// lost bonds/core.js, the enemies and half the kits — 炎 without 炎佑, generic skills, everything leaked — and its
// results were accepted (2026-10-09). public/js/battle/runner.js loadBrowserSim refuses a sim with any entry here.

const FAILED = [];

/** Record a content module (path relative to the module that imported it) that runs as an empty module. */
export function noteLoadFailure(path) { FAILED.push(String(path)); }

/** The content modules that failed to load; [] when everything loaded. */
export function loadFailures() { return FAILED.slice(); }
