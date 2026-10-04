// ui/terrainInfo.js: the briefing's 地图特性 and the card of a tapped special tile, from the stages' own data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageFeatures, tileFeatures, terrainFeature } from '../../public/js/ui/terrainInfo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data', 'stages.json'), 'utf8'));
const tileOf = (st, key) => { for (let r = 0; r < st.rows.length; r++) for (let c = 0; c < st.rows[r].length; c++) if (st.tiles[st.rows[r][c]]?.tileKey === key) return [r, c]; return null; };

test('every stage in the rotation lists its special tiles with the stage\'s numbers', () => {
  const names = (id) => stageFeatures(stages[id]).filter((f) => !f.optional).map((f) => f.name);
  assert.deepEqual(names('act1autochess_m04'), ['活性源石', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m03'), ['排气格栅', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m04'), ['深水', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m02'), ['沼泽', '阻隔工事']);
  assert.deepEqual(names('act2autochess_m01'), ['源石流发生装置']);
  assert.deepEqual(names('act1autochess_m03'), ['射击台', '阻隔工事']);
  // devices that start off are flagged (the briefing leaves them out)
  assert.ok(stageFeatures(stages.act1autochess_m01).find((f) => f.id === 'turret').optional);
  const inf = stageFeatures(stages.act1autochess_m04).find((f) => f.id === 'infection');
  assert.match(inf.text, /攻击力 \+20%、攻击速度 \+20，但每秒受到 70 点真实伤害/);
  assert.match(terrainFeature('mire', stages.act2autochess_m02).text, /每 1 秒再叠 1 层（最多 10 层），每层攻击速度 -5、移动速度 -5%/);
  assert.match(terrainFeature('deepsea', stages.act2autochess_m04).text, /每秒受到 40 点真实伤害，攻击速度 -60，移动速度降为 60%/);
  for (const st of Object.values(stages)) for (const f of stageFeatures(st)) assert.ok(f.name && f.text && !/undefined|NaN/.test(f.text), `${st.id} ${f.id}`);
});

test('a tapped tile: its terrain, a device on it, the airflow it lies in; plain tiles have nothing', () => {
  const m04 = stages.act1autochess_m04;
  const [r, c] = tileOf(m04, 'tile_infection');
  assert.deepEqual(tileFeatures(m04, r, c).map((f) => f.id), ['infection']);
  const road = tileOf(m04, 'tile_road');
  const crate = m04.devices.find((d) => d.role === 'crate' && d.active !== false);
  assert.deepEqual(tileFeatures(m04, crate.pos[0], crate.pos[1]).map((f) => f.id), ['crate']);
  assert.ok(tileFeatures(m04, road[0], road[1]).every((f) => f.id === 'crate'), 'a road tile without a device: nothing (or the crate standing on it)');
  const turret = m04.devices.find((d) => d.role === 'turret');
  assert.ok(!tileFeatures(m04, turret.pos[0], turret.pos[1]).some((f) => f.id === 'turret'), 'a device that is off is not on the board');
  const b = stages.act2autochess_m01;
  const blower = b.devices.find((d) => d.role === 'blower');
  const [fr, fc] = blower.rangeTiles[1];
  const flow = tileFeatures(b, fr, fc);
  assert.equal(flow[0].id, 'blower');
  assert.match(flow[0].text, /朝向与风向相同时攻击力 \+30%，相反时 -30%/);
  assert.deepEqual(tileFeatures(null, 1, 1), []);
  assert.deepEqual(tileFeatures(m04, -1, 99), []);
});
