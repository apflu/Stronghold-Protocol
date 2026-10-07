// test/ui/map-devices.test.js — the briefing's 地图特性 (gameLogic/terrain.js stageFeatures, built on the special terrain
// tip of GitHub #184 and the stage device cards of GitHub #228 / PR #229), and a tap on plain ground — or off the board —
// closing the open card and the selection (screens/game.js 'tileClick'). wjx instance.
// Run: node --test test/ui/map-devices.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { stageFeatures, deviceInfo, terrainInfo } = await import('../../public/js/ui/gameLogic.js');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data', 'stages.json'), 'utf8'));
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
/** The first (row, col) whose legend entry has `tileKey`. */
function tileOf(st, key) {
  for (let r = 0; r < st.rows.length; r++) for (let c = 0; c < st.rows[r].length; c++) if (st.tiles[st.rows[r][c]]?.tileKey === key) return [r, c];
  return null;
}

test('地图特性: every stage lists its special terrain (the tip\'s own lines) and its stage devices once; devices that start off are optional', () => {
  const names = (id) => stageFeatures(stages[id]).filter((f) => !f.optional).map((f) => f.name);
  assert.deepEqual(names('act1autochess_m01'), ['阻隔工事']);
  assert.deepEqual(names('act1autochess_m02'), [], '战场#02: crates / 射击台 only through a map card');
  assert.deepEqual(names('act1autochess_m03'), ['射击台', '阻隔工事']);
  assert.deepEqual(names('act1autochess_m04'), ['活性源石', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m01'), ['源石流发生装置']);
  assert.deepEqual(names('act2autochess_m02'), ['沼泽', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m03'), ['排气格栅', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m04'), ['深水区', '阻隔工事']);
  assert.ok(stageFeatures(stages.act1autochess_m01).find((f) => f.name === '“双眼皮”').optional, 'the turrets start off');
  // the lines are the tap cards' (one wording, the stage's numbers)
  const m04 = stages.act1autochess_m04;
  const [r, c] = tileOf(m04, 'tile_infection');
  assert.deepEqual(stageFeatures(m04).find((f) => f.key === 'infection').lines, terrainInfo(m04, r, c).lines);
  const crate = m04.devices.find((d) => d.role === 'crate' && !d.hidden && d.active !== false);
  assert.deepEqual(stageFeatures(m04).find((f) => f.key === 'device:crate').lines, deviceInfo(m04, crate.pos[0], crate.pos[1]).lines);
  for (const st of Object.values(stages)) {
    for (const f of stageFeatures(st)) assert.ok(f.name && f.lines.length && f.lines.every((l) => !/undefined|NaN/.test(l)), `${st.id} ${f.key}`);
  }
  assert.deepEqual(stageFeatures(null), []);
});

test('wiring: plain ground / off the board clears the card and the selection; the view reports a press off the board; the briefing shows 地图特性', () => {
  const game = src('public/js/screens/game.js');
  const handler = game.slice(game.indexOf("view.on('tileClick'"), game.indexOf('}),', game.indexOf("view.on('tileClick'")));
  assert.match(handler, /deviceTipAt\(/, 'upstream\'s device card first');
  assert.equal((handler.match(/if \(L\.facing\) return;\s*setDetail\(null\);\s*setSel\(null\);/g) || []).length, 2, 'off the board and plain ground: close the card and the selection');
  assert.match(handler, /setDetail\(\{ kind: 'terrain', terrain: info \}\)/);
  const app = src('public/js/render/app.js');
  const emit = app.slice(app.indexOf('function emitTileClick'), app.indexOf('const onPointerDown'));
  assert.doesNotMatch(emit, /\) return;/, 'no early return off the board');
  assert.match(emit, /row: on \? t\.row : null, col: on \? t\.col : null/);
  const brief = src('public/js/screens/briefing.js');
  assert.match(brief, /stageFeatures\(stage\)\.filter\(\(f\) => !f\.optional\)/);
  assert.match(brief, /t\('地图特性'\)/);
});
