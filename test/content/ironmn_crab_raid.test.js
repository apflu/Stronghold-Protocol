// test/content/ironmn_crab_raid.test.js — 白铁's 铁钳号·原型机 (token_10027_ironmn_pile3, an enemy-camp summon our operators attack:
// Battle.setAllyTarget, kits/ops/op-ironmn.js) together with 突袭 (bonds/addon/battle.js raidPoll) and the basic strategy of a
// ready skill (skills.js onAboutToAttack); and an elite 白铁 with his module keeping two 铁钳号. 白铁 is fielded the production
// way (a DIY slot + its `diy` pick), as in test/content/op_ironmn.test.js.
// Run: node --test test/content/ironmn_crab_raid.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const IRON = 'char_4072_ironmn';
const CRAB = 'token_10027_ironmn_pile3';
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const Y = 'uniequip_003_ironmn';
const RAID = { raidShip: { count: 2, active: true, tier: 1, layers: 10 } };
const STATS = { maxHp: 3000, atk: 500, def: 0, blockCnt: 1, bat: 1 };
const ENEMIES = { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, mass: 0 }) };
const iron = (o = {}) => ({ uid: 1, diy: { slot: SLOT[o.tier ?? 5], charId: IRON, skillIndex: 2, uniEquipId: o.mod ?? null }, elite: !!o.elite, row: 10, col: 2, dir: 'RIGHT' });
const crab = (uid, row, col, dir = 'RIGHT') => ({ uid, kind: 'token', tokenId: CRAB, ownerUid: 1, row, col, dir });
const crabsOf = (h) => h.b.allyUnits.filter((a) => a.kind === 'token' && a.defId === CRAB).sort((a, b) => a.uid - b.uid);
const cheb = (u, r, c) => Math.max(Math.abs(u.tileR - r), Math.abs(u.tileC - c));
const atkOn = (h, u, t) => h.events.filter((e) => e[0] === 'atk' && e[1] === u.id && e[2] === t.id).length;
function clean(h) {
  assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []);
  checkInvariants(h.b);
}

test('突袭 + 铁钳号: with no enemy to reach an idle member jumps beside its player\'s 铁钳号 and hits it (real attacks, no damage), stays there while it is the only one; a real enemy wins — the idle timer counts attacks on enemies only', () => {
  const h = makeBattle({
    defs: { chess: { r_m: chessRec({ id: 'r_m', bonds: ['raidShip'], skill: null, stats: STATS }) }, enemies: ENEMIES },
    units: [iron(), crab(3, 11, 8), { uid: 2, chessId: 'r_m', row: 12, col: 2 }],
    bonds: RAID, hooks: ['deploy', 'damaged'], autoFinish: false, timeLimit: 120,
  });
  h.run(0.5);
  const r = h.unit('r_m');
  const [c] = crabsOf(h);
  assert.ok(h.runUntil(() => r.tileR !== 12 || r.tileC !== 2, 15), 'the 突袭 member jumps');
  assert.ok(cheb(r, 11, 8) <= 2, `beside the 铁钳号 (${r.tileR},${r.tileC})`);
  const at = [r.tileR, r.tileC];
  h.run(25);
  assert.ok(atkOn(h, r, c) > 5, `it attacks the 铁钳号 (${atkOn(h, r, c)} attacks)`);
  assert.equal(h.hooksOf('damaged').filter((x) => x.target === c).length, 0, 'which takes no damage');
  assert.deepEqual([r.tileR, r.tileC], at, 'the only 铁钳号, no enemy anywhere: it stays');
  // a real enemy shows up elsewhere: the member leaves the 铁钳号 for it within the idle time (hitting the 铁钳号 is no fight)
  const e = h.spawn('enemy_dummy', { pos: [9, 4] });
  assert.ok(h.runUntil(() => cheb(r, 9, 4) <= 2, 11), `it jumps to the enemy (${r.tileR},${r.tileC})`);
  h.run(2);
  assert.ok(atkOn(h, r, e) > 0, 'and fights it');
  clean(h);
});

test('突袭 + 铁钳号: with two 铁钳号 and no enemy a member alternates between them (every jump a new deployment); a ready skill hops at once, an idle member once per idle period', () => {
  const run = (skill) => {
    const h = makeBattle({
      defs: { chess: { r_m: chessRec({ id: 'r_m', bonds: ['raidShip'], skill, stats: STATS }) }, enemies: ENEMIES },
      units: [iron(), crab(3, 12, 8), crab(4, 9, 4), { uid: 2, chessId: 'r_m', row: 11, col: 2 }],
      bonds: RAID, hooks: ['deploy'], autoFinish: false, timeLimit: 120,
    });
    h.run(0.5);
    const r = h.unit('r_m');
    const cs = crabsOf(h);
    assert.equal(cs.length, 2);
    const near = () => cs.findIndex((c) => cheb(r, c.tileR, c.tileC) <= 2);
    const visits = [];
    h.b.on('deploy', (c) => { if (c.unit === r) visits.push(near()); });
    h.run(60);
    assert.ok(visits.length >= 3 && visits.every((i) => i >= 0), `lands beside a 铁钳号 each time (${visits.slice(0, 8).join(' → ')})`);
    for (let i = 1; i < visits.length; i++) assert.notEqual(visits[i], visits[i - 1], 'never the one it stood by');
    clean(h);
    return visits.length;
  };
  const ready = run({ spCost: 10, initSp: 10 });
  assert.ok(ready > 20, `a ready skill hops at once (${ready} jumps in 60 s) — the official trick (owner's decision)`);
  const idle = run(null);
  assert.ok(idle >= 4 && idle <= 7, `no skill: once per idle period (${idle} jumps in 60 s)`);
});

test('铁钳号: a ready skill casts on it (basic strategy "技能就绪，且即将进行普通攻击") — 圣约送葬人\'s S2 starts and spends ammo on it; a 突袭 member keeps its SP and hops instead', () => {
  const h = makeBattle({
    defs: { enemies: ENEMIES },
    units: [iron(), crab(3, 10, 5), { uid: 2, chessId: 'chess_char_5_01_b', row: 10, col: 4, dir: 'RIGHT' }],
    hooks: ['skillStart', 'ammoUsed', 'attack'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_01_b');
  const [c] = crabsOf(h);
  h.run(0.2);
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 6), 'S2 starts on the 铁钳号');
  h.run(3);
  assert.ok(h.hooksOf('attack').some((x) => x.attacker === u && x.targets.includes(c)), 'it attacks the 铁钳号');
  assert.ok(h.hooksOf('ammoUsed').some((x) => x.unit === u), 'and spends ammo on it');
  clean(h);

  // a 突袭 member with a ready skill next to the only 铁钳号: no cast (it would hop, keeping its SP, were there another)
  const h2 = makeBattle({
    defs: { chess: { r_m: chessRec({ id: 'r_m', bonds: ['raidShip'], skill: { spCost: 10, initSp: 10 }, stats: STATS }) }, enemies: ENEMIES },
    units: [iron(), crab(3, 10, 5), { uid: 2, chessId: 'r_m', row: 10, col: 4, dir: 'RIGHT' }],
    bonds: RAID, hooks: ['skillStart', 'attack'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  h2.run(5);
  const m = h2.unit('r_m');
  assert.ok(h2.hooksOf('attack').some((x) => x.attacker === m && x.targets.includes(crabsOf(h2)[0])), 'it hits the 铁钳号');
  assert.equal(h2.hooksOf('skillStart').filter((x) => x.unit === m).length, 0, 'no cast on it');
  assert.ok(m.skill.ready, 'SP kept');
  clean(h2);
});

test('白铁 elite with his module (CRA-Y uniequip_003_ironmn, tiers 5 / 6): two 铁钳号 both stay — neither withdraws the other at the battle start', () => {
  for (const tier of [5, 6]) {
    const h = makeBattle({
      defs: { enemies: ENEMIES },
      units: [iron({ tier, elite: true, mod: Y }), crab(3, 12, 6), crab(4, 10, 8, 'LEFT')],
      hooks: ['death'], autoFinish: false, timeLimit: 60,
    });
    h.run(1);
    const cs = crabsOf(h);
    assert.equal(cs.length, 2, `T${tier}`);
    assert.ok(cs.every((t) => t.alive && t.deployed), `T${tier}: both on the field`);
    assert.equal(h.hooksOf('death').filter((x) => cs.includes(x.unit)).length, 0, `T${tier}: no withdrawal`);
    clean(h);
  }
});
