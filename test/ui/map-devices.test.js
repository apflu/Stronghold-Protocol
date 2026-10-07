// test/ui/map-devices.test.js — the briefing's 地图特性 and the card of a tapped map device (gameLogic/terrain.js
// stageFeatures / deviceInfo / tileTapTarget), next to the special terrain tip of GitHub #184 (terrainInfo, which goes
// first); a tap on plain ground — or off the board — closes the open card and the selection (screens/game.js 'tileClick').
// Run: node --test test/ui/map-devices.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { stageFeatures, deviceInfo, tileTapTarget, terrainInfo, closesOnFieldPress } = await import('../../public/js/ui/gameLogic.js');
const { resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data', 'stages.json'), 'utf8'));
const src = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const on = (d) => (d.raw && typeof d.raw.active === 'boolean' ? d.raw.active : !d.hidden && d.active !== false);
/** The first (row, col) whose legend entry has `tileKey`. */
function tileOf(st, key) {
  for (let r = 0; r < st.rows.length; r++) for (let c = 0; c < st.rows[r].length; c++) if (st.tiles[st.rows[r][c]]?.tileKey === key) return [r, c];
  return null;
}

test('地图特性: every stage lists its special terrain (the tip\'s own lines) and its map devices once; devices that start off are optional', () => {
  const names = (id) => stageFeatures(stages[id]).filter((f) => !f.optional).map((f) => f.name);
  assert.deepEqual(names('act1autochess_m01'), ['阻隔工事']);
  assert.deepEqual(names('act1autochess_m02'), [], '战场#02: crates / 射击台 only through a map card');
  assert.deepEqual(names('act1autochess_m03'), ['射击台', '阻隔工事']);
  assert.deepEqual(names('act1autochess_m04'), ['活性源石', '阻隔工事']);
  assert.deepEqual(names('act1autochess_m06'), ['土石结构', '射击台']);
  assert.deepEqual(names('act2autochess_m01'), ['源石流发生装置']);
  assert.deepEqual(names('act2autochess_m02'), ['沼泽', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m03'), ['排气格栅', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m04'), ['深水区', '阻隔工事']);
  assert.ok(stageFeatures(stages.act1autochess_m01).find((f) => f.name === '“双眼皮”').optional, 'the turrets start off');
  // the terrain lines are the tap tip's (one wording, the stage's numbers)
  const m04 = stages.act1autochess_m04;
  const [r, c] = tileOf(m04, 'tile_infection');
  assert.deepEqual(stageFeatures(m04).find((f) => f.key === 'infection').lines, terrainInfo(m04, r, c).lines);
  assert.match(stageFeatures(stages.act2autochess_m01).find((f) => f.key === 'device:blower').lines[0], /相同时攻击力 \+30%，相反时 −30%，垂直时不变/);
  for (const st of Object.values(stages)) {
    for (const f of stageFeatures(st)) assert.ok(f.name && f.lines.length && f.lines.every((l) => !/undefined|NaN/.test(l)), `${st.id} ${f.key}`);
  }
  assert.deepEqual(stageFeatures(null), []);
  assert.deepEqual(stageFeatures(stages.act1autochess_escaped_single), [], '联防: nothing');
});

test('a tapped tile: the terrain tip first, else a device on it (射击台, 阻隔工事, 源石流 and its airflow); plain ground → nothing', () => {
  const m03 = stages.act1autochess_m03;
  const plat = m03.devices.find((d) => d.role === 'platform' && on(d));
  const crate = m03.devices.find((d) => d.role === 'crate' && on(d));
  const p = tileTapTarget(m03, plat.pos[0], plat.pos[1]);
  assert.equal(p.kind, 'terrain');
  assert.deepEqual([p.terrain.name, p.terrain.tag, p.terrain.device], ['射击台', '地图装置', true]);
  assert.deepEqual(p.terrain.lines, ['地面单位无法通过', '只能部署远程位干员；站在上面的干员不阻挡敌人']);
  assert.match(deviceInfo(m03, crate.pos[0], crate.pos[1]).lines.join(' '), /敌人会尽量绕开它.*摧毁它（\d+ 生命值）/);
  // the panel shows it as the terrain card; it closes on a field press like the terrain tip
  assert.deepEqual(resolveDetail(p, new Map()), { type: 'terrain', terrain: p.terrain });
  assert.equal(closesOnFieldPress(p), true);
  // a 源石流 tile: the generator's card, tagged as its airflow
  const m01 = stages.act2autochess_m01;
  const blower = m01.devices.find((d) => d.role === 'blower');
  const flow = deviceInfo(m01, blower.rangeTiles[1][0], blower.rangeTiles[1][1]);
  assert.deepEqual([flow.name, flow.tag], ['源石流发生装置', '源石流范围']);
  assert.match(flow.lines[2], /敌人顺风移动速度 \+50%，逆风 −50%/);
  // the terrain tip wins on a special tile; a device that starts off is not on the board; plain ground has nothing
  const m04 = stages.act1autochess_m04;
  const [ir, ic] = tileOf(m04, 'tile_infection');
  assert.equal(tileTapTarget(m04, ir, ic).terrain.name, '活性源石');
  const turret = m04.devices.find((d) => d.role === 'turret');
  assert.equal(deviceInfo(m04, turret.pos[0], turret.pos[1]), null, 'the “双眼皮” starts off');
  const m02 = stages.act1autochess_m02;
  const off = m02.devices.find((d) => d.role === 'platform');
  assert.equal(tileTapTarget(m02, off.pos[0], off.pos[1]), null, '战场#02\'s 射击台 is off at the start');
  const road = tileOf(m03, 'tile_road');
  assert.ok(!m03.devices.some((d) => on(d) && d.pos[0] === road[0] && d.pos[1] === road[1]));
  assert.equal(tileTapTarget(m03, road[0], road[1]), null, 'plain road');
  assert.equal(tileTapTarget(m03, null, null), null, 'off the board');
  assert.equal(tileTapTarget(null, 1, 1), null);
});

test('wiring: the tap resolves through tileTapTarget, plain ground / off the board clears the card and the selection; the view reports a press off the board; the briefing shows 地图特性', () => {
  const game = src('public/js/screens/game.js');
  const handler = game.slice(game.indexOf("view.on('tileClick'"), game.indexOf('}),', game.indexOf("view.on('tileClick'")));
  assert.match(handler, /tileTapTarget\(L\.terrainStage, \.\.\.L\.terrainTile\(t\.row, t\.col\)\)/);
  assert.match(handler, /setDetail\(target\)/);
  assert.match(handler, /if \(L\.facing\) return;\s*setDetail\(null\);\s*setSel\(null\);/, 'plain ground: close the card and the selection');
  const app = src('public/js/render/app.js');
  const emit = app.slice(app.indexOf('function emitTileClick'), app.indexOf('const onPointerDown'));
  assert.doesNotMatch(emit, /\) return;/, 'no early return off the board');
  assert.match(emit, /row: on \? t\.row : null, col: on \? t\.col : null/);
  const brief = src('public/js/screens/briefing.js');
  assert.match(brief, /stageFeatures\(stage\)\.filter\(\(f\) => !f\.optional\)/);
  assert.match(brief, /t\('地图特性'\)/);
});
