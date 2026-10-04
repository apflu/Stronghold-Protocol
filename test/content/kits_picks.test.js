// 甄选干员 kits (server/sim/content/kits/picks.js): each pick runs a real battle through the harness and its signature
// effects are asserted with numbers taken from its own blackboards (normal Lv4 / elite Lv7, the selected module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import KITS from '../../server/sim/content/kits/picks.js';

const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≉ ${b}`);
const dummy = (key = 'enemy_dummy', o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const bbOf = (u) => u.def.skill.bb;
const tal = (u, i) => u.def.talents?.[i]?.bb ?? {};
const tagged = (h, tag, target = null) => h.hooksOf('damaged').filter((c) => (c.dmg?.tags || []).includes(tag) && (!target || c.target === target));
const clean = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []); checkInvariants(h.b); };

const ASC = 'chess_pick6_char_4132_ascln_a';
const ASC_E = 'chess_pick6_char_4132_ascln_b';

test('registry: 阿斯卡纶 runs her own kit at V and VI', () => {
  for (const id of ['chess_pick5_char_4132_ascln_a', ASC]) {
    assert.ok(KITS[id], id);
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], autoFinish: false, timeLimit: 3 });
    h.step();
    assert.equal(h.unit(id).kit.generic, undefined, `${id} uses its own kit`);
    clean(h);
  }
});

test('阿斯卡纶 死亡拘审: attacks stack ≤3 marks — slow per stack, ATK × ratio arts per second per stack', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { speed: 1 }) } },
    units: [{ chessId: ASC, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit(ASC);
  const t0 = tal(u, 0);
  h.step();
  u.skill.sp = 0; // no 追袭 in the way
  const e = h.enemy('enemy_dummy');
  assert.ok(h.runUntil(() => (u.mem.marks.get(e.id) || []).length >= t0.max_stack_cnt, 60), 'three stacks');
  h.run(2);
  assert.equal(u.mem.marks.get(e.id).length, t0.max_stack_cnt, 'never more than the cap');
  approx(e.s.moveMul ?? e.s.moveSpeed / e.base.moveSpeed, (1 + t0.move_speed) ** t0.max_stack_cnt, 1e-6, 'slow per stack');
  const dots = tagged(h, 'dot', e);
  assert.ok(dots.length > 0, 'the mark burns');
  const last = dots.at(-1);
  assert.equal(last.type, 'arts');
  approx(last.dmg.amount ?? last.dmg.base ?? last.amount, u.s.atk * t0.atk_ratio * t0.max_stack_cnt, 0.02, 'ATK × ratio × stacks (pre-mitigation)');
  clean(h);
});

test('阿斯卡纶 S1 追袭: the charged attack hits twice at atk_scale', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: ASC, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit(ASC);
  h.step();
  assert.equal(u.skill.id, 'skchr_ascln_1');
  const skillHits = () => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && c.dmg?.isSkill);
  const plainHits = () => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && !c.dmg?.isSkill);
  assert.ok(h.runUntil(() => plainHits().length > 0, 20), 'a plain attack first');
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => skillHits().length > 0, 20), 'a skill attack');
  h.step();
  const id = skillHits()[0].dmg.attackId;
  const same = skillHits().filter((c) => c.dmg.attackId === id);
  assert.equal(same.length, 2, 'attacks twice');
  const plain = plainHits()[0].dmg.amount ?? plainHits()[0].dmg.base;
  approx(same[0].dmg.amount ?? same[0].dmg.base, plain * bbOf(u).atk_scale, 1e-6, 'atk_scale × ATK');
  clean(h);
});

test('阿斯卡纶 S2 恩赐: ATK +90 %, ground enemies in range slowed; a knock-down in range spreads a mark around it', () => {
  // her range (facing right) reaches column 7 of her row: the frail enemy on (10,7) is inside, the dummy on (10,8) is not
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy(), enemy_frail: enemyRec({ key: 'enemy_frail', hp: 8000, speed: 0 }) } },
    units: [{ chessId: ASC, row: 10, col: 5, skillIndex: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 8] }, { key: 'enemy_frail', pos: [10, 7] }], hooks: ['damaged', 'death'], autoFinish: false, timeLimit: 90,
  });
  const u = h.unit(ASC);
  const bb = bbOf(u);
  h.step();
  const atk0 = u.s.atk;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  approx(u.s.atk, atk0 * (1 + bb.atk), 1e-6, 'ATK');
  const e = h.enemy('enemy_dummy'), f = h.enemy('enemy_frail');
  h.run(0.5);
  assert.ok(f.buffs.some((b) => b.key === `ascln:s2slow:${u.id}`), 'a ground enemy in range is slowed');
  assert.ok(!e.buffs.some((b) => b.key === `ascln:s2slow:${u.id}`), 'not outside it');
  assert.equal((u.mem.marks.get(e.id) || []).length, 0, 'out of her range: never attacked');
  assert.ok(h.runUntil(() => !f.alive, 30), 'the frail enemy falls');
  assert.ok(u.skill.active, 'during the skill');
  assert.equal((u.mem.marks.get(e.id) || []).length, 1, 'the spread marks the enemy beside it');
  clean(h);
});

test('阿斯卡纶 S3 降临: ATK +20 %, shorter BAT, taunt +2; blinded attackers miss ~30 % and a miss heals her 5 %', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_hitter: dummy('enemy_hitter', { atk: 200, bat: 0.3, range: 1 }) } },
    units: [{ chessId: ASC, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_hitter', pos: [10, 6] }], hooks: ['damaged', 'dodge', 'hit'], captureNoisy: true, seed: 3, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit(ASC);
  const bb = bbOf(u);
  assert.equal(u.def.skill.id, 'skchr_ascln_3', 'the default skill');
  h.step();
  const atk0 = u.s.atk, bat0 = u.s.bat, taunt0 = u.s.taunt ?? 0;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  approx(u.s.atk, atk0 * (1 + bb.atk), 1e-6, 'ATK');
  assert.ok(u.s.bat < bat0, 'shorter attack time');
  assert.equal((u.s.taunt ?? 0) - taunt0, bb.taunt_level, 'taunt');
  assert.ok(h.runUntil(() => !u.skill.active, 60));
  const hits = h.hooksOf('hit').filter((c) => c.source?.def?.key === 'enemy_hitter' || c.source?.defId === 'enemy_hitter');
  const cancelled = hits.filter((c) => c.dmg.cancel).length;
  assert.ok(hits.length > 20, `the hitter attacked (${hits.length})`);
  const rate = cancelled / hits.length;
  assert.ok(rate > 0.1 && rate < 0.5, `miss rate ${rate.toFixed(2)} ≈ 0.3`);
  clean(h);
});

test('阿斯卡纶 elite module AMB-Y: 65 % dodge; a marked enemy dying heals her 10 %', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_frail: enemyRec({ key: 'enemy_frail', hp: 3000, speed: 0 }) } },
    units: [{ chessId: ASC_E, row: 10, col: 5, skillIndex: 0, moduleId: 'uniequip_003_ascln' }],
    enemies: [{ key: 'enemy_frail', pos: [10, 6] }], hooks: ['damaged', 'death'], autoFinish: false, timeLimit: 60,
  });
  const u = h.unit(ASC_E);
  h.step();
  approx(u.s.dodgePhys, 0.65, 1e-6, 'AMB-Y trait');
  approx(tal(u, 0).hp_ratio, 0.1);
  u.hp = u.s.maxHp * 0.5;
  const e = h.enemy('enemy_frail');
  assert.ok(h.runUntil(() => !e.alive, 40), 'the marked enemy falls');
  assert.ok(u.hp >= u.s.maxHp * 0.6 - 1, `healed (${(u.hp / u.s.maxHp).toFixed(2)})`);
  clean(h);
});

// ---- 白铁 ------------------------------------------------------------------------------------------------------------

const IRON = 'chess_pick6_char_4072_ironmn_a';
const ALLY = 'chess_char_1_02_a'; // 角峰
const P1 = 'token_10027_ironmn_pile1', P2 = 'token_10027_ironmn_pile2', P3 = 'token_10027_ironmn_pile3';
/** 白铁 on (10,4) facing right, an ally in front of him on (10,5), a device on (9,5) facing up onto the ally (rows grow upward). */
const ironBattle = (skillIndex, device, o = {}) => makeBattle({
  defs: { enemies: { enemy_dummy: dummy(), ...(o.enemies || {}) } },
  units: [
    { chessId: o.chessId ?? IRON, row: 10, col: 4, uid: 1, skillIndex, ...(o.moduleId ? { moduleId: o.moduleId } : {}) },
    { chessId: ALLY, row: 10, col: 5, uid: 2 },
    { kind: 'token', tokenId: device, ownerUid: 1, row: 9, col: 5, uid: 3, dir: 'UP' },
    ...(o.units || []),
  ],
  enemies: o.spawn || [], hooks: ['damaged', 'death', 'deploy'], captureNoisy: true, autoFinish: false, timeLimit: o.timeLimit ?? 120,
});
const devicesOf = (h, id) => h.b.allyUnits.filter((t) => t.defId === id);

test('registry: 白铁 runs his own kit at V and VI; his S3 device is 铁钳号, S1/S2 the platforms', () => {
  for (const id of ['chess_pick5_char_4072_ironmn_a', IRON]) assert.ok(KITS[id], id);
  const h = ironBattle(undefined, P3);
  h.step();
  assert.equal(h.unit(IRON).kit.generic, undefined);
  clean(h);
});

test('白铁 S1 极致火力: the platform gives its operator ATK +12 %, ×fake_scale during S1; S1 ends ⇒ the devices are destroyed', () => {
  const h = ironBattle(0, P1);
  h.run(0.5);
  const u = h.unit(IRON), a = h.unit(ALLY);
  const [dev] = devicesOf(h, P1);
  assert.ok(dev && dev.alive && dev.deployed, 'the placed platform stands');
  assert.ok(dev.s.flags.untargetable && dev.s.flags.invulnerable, '不会受到攻击');
  const atk = h.b.data.getToken(P1, u.defId).talents[0].bb.atk;
  approx(a.s.atk, a.base.atk * (1 + atk), 1e-6, 'ATK +12 %');
  assert.ok(u.skill.activate('test', { free: true }), 'S1');
  h.run(0.3);
  approx(a.s.atk, a.base.atk * (1 + atk * bbOf(u).fake_scale), 1e-6, '×fake_scale');
  assert.ok(h.runUntil(() => !u.skill.active, 40));
  h.run(0.1);
  assert.ok(!dev.alive, 'destroyed at the end');
  assert.equal(dev.removeReason, 'destroyed');
  clean(h);
});

test('白铁 S2 高效补给: the platform gives +1 SP every 3.5 s and wears down; S2 ATK/DEF up, every blocked enemy, a device at the end', () => {
  const h = ironBattle(1, P2);
  h.run(0.2);
  const u = h.unit(IRON), a = h.unit(ALLY);
  const [dev] = devicesOf(h, P2);
  const tb = h.b.data.getToken(P2, u.defId).talents;
  const iv = tb.find((t) => t.bb['default.interval'] != null).bb['default.interval'];
  const loss = tb.find((t) => t.bb.hp_ratio != null).bb.hp_ratio;
  a.skill.sp = 0;
  const sp0 = a.skill.sp, hp0 = dev.hp, t0 = h.b.time;
  h.run(iv * 2 + 0.25);
  const natural = (h.b.time - t0) * (a.s.spRecovery ?? 1) * (a.skill.spType === 'time' ? 1 : 0);
  assert.ok(a.skill.sp - sp0 >= natural + 2 - 1e-6 || a.skill.active, `two device SP (${(a.skill.sp - sp0).toFixed(2)} vs natural ${natural.toFixed(2)})`);
  approx(hp0 - dev.hp, dev.s.maxHp * loss * (h.b.time - t0), 0.1, 'loses hp_ratio of its max HP per second');
  const atk0 = u.s.atk, def0 = u.s.def;
  assert.ok(u.skill.activate('test', { free: true }), 'S2');
  approx(u.s.atk, atk0 * (1 + bbOf(u).atk), 1e-6, 'ATK');
  approx(u.s.def, def0 * (1 + bbOf(u).def), 1e-6, 'DEF');
  // the device is gone (destroyed by hand): S2's end gives one back on its tile
  h.b.retreat(dev, { reason: 'destroyed' });
  assert.ok(h.runUntil(() => !u.skill.active, 40));
  assert.ok(h.runUntil(() => dev.alive && dev.deployed, 15), 'the platform takes its tile again');
  clean(h);
});

test('白铁 S3 铁钳号: allies with nothing to hit charge it; at full SP it strikes with 白铁 ATK × atk_scale; the operator behind takes −20 % phys', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [
      { chessId: IRON, row: 10, col: 4, uid: 1 },
      { kind: 'token', tokenId: P3, ownerUid: 1, row: 10, col: 5, uid: 3, dir: 'RIGHT' },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  h.run(0.3);
  const u = h.unit(IRON);
  const [claw] = devicesOf(h, P3);
  assert.ok(claw.alive && claw.deployed, '铁钳号 stands in front of him');
  assert.ok(claw.s.flags.untargetable && claw.s.flags.invulnerable);
  const sk = h.b.data.getToken(P3, u.defId).skill;
  approx(u.s.physTakenMul ?? 1, 1 - h.b.data.getToken(P3, u.defId).talents[0].bb.damage_resistance, 1e-6, '团结的力量 on the tile behind');
  assert.ok(h.runUntil(() => tagged(h, 'ironClaw').length > 0, 30), 'it strikes');
  assert.ok(h.eventsOf('atk').some((e) => e[1] === u.id && e[2] === claw.id), 'his hits on it show as attacks (atk events)');
  const main = tagged(h, 'ironClaw').find((c) => !c.dmg.isSplash);
  approx(main.dmg.amount, u.s.atk * sk.bb.atk_scale, 0.02, '白铁 ATK × atk_scale');
  assert.ok(claw.hp < claw.s.maxHp, 'firing costs it HP');
  clean(h);
});

test('白铁 节约经费 (elite, module CRA-X): +0.2 SP/s while a device of his stands beside him; a device leaving beside him comes back (prob)', () => {
  // the SP part is CRA-X's upgrade of the talent (PRTS 铁钳号·爬行者); without the module the elite only recovers devices
  const IRON_E = 'chess_pick6_char_4072_ironmn_b';
  const h = ironBattle(0, P1, { chessId: IRON_E });
  h.run(0.5);
  const u = h.unit(IRON_E);
  const regen = u.buffs.find((b) => b.key === 'ironmn:t2');
  assert.ok(regen, 'SP regen buff');
  approx(regen.mods.spRecoveryFlat, 0.2, 1e-6, '+0.2/s (talent text)');
  const plain = ironBattle(0, P1, { chessId: IRON_E, moduleId: 'none' });
  plain.run(0.5);
  assert.ok(!plain.unit(IRON_E).buffs.some((b) => b.key === 'ironmn:t2'), 'no module: no SP regen');
  const [dev] = devicesOf(h, P1);
  // destroy it a few times: with prob 0.9 (plus the third device in stock) it keeps coming back on its tile
  let back = 0;
  for (let i = 0; i < 4; i++) {
    if (!dev.alive) break;
    h.b.retreat(dev, { reason: 'destroyed' });
    if (h.runUntil(() => dev.alive, 15)) back++;
  }
  assert.ok(back >= 2, `came back ${back}×`);
  clean(h);
});

// ---- 贝洛内 ----------------------------------------------------------------------------------------------------------

const BEL = 'chess_pick6_char_4037_demetr_a', BEL_E = 'chess_pick6_char_4037_demetr_b';

test('贝洛内 家族手段: each attack stacks 【手段】 (≤5, DEF × (1 − 8 % × n)); lower target HP ⇒ more damage (+42 % at ≤20 %)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { def: 500 }) } },
    units: [{ chessId: BEL, row: 10, col: 5, skillIndex: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], hooks: ['hit'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit(BEL), t0 = tal(u, 0);
  h.step();
  u.skill.sp = 0;
  const e = h.enemy('enemy_dummy');
  assert.ok(h.runUntil(() => (u.mem.means.get(e.id)?.n ?? 0) >= t0['attack@limited_stack_cnt'], 30));
  h.run(2);
  assert.equal(u.mem.means.get(e.id).n, t0['attack@limited_stack_cnt'], 'capped outside S2');
  approx(e.s.def, e.base.def * (1 + t0['attack@def'] * t0['attack@limited_stack_cnt']), 1e-6, 'DEF × (1 − 8 % × 5)');
  // damage bonus by the target's HP ratio
  const mulAt = (ratio) => { e.hp = e.s.maxHp * ratio; const before = h.hooksOf('hit').length; h.runUntil(() => h.hooksOf('hit').slice(before).some((c) => c.source === u), 5); return h.hooksOf('hit').slice(before).find((c) => c.source === u).dmg.mul; };
  const full = mulAt(1), low = mulAt(0.1), mid = mulAt(0.6);
  approx(low / full, 1 + t0.max_add_on_scale, 1e-6, '+42 % at ≤ 20 %');
  approx(mid / full, 1 + t0.max_add_on_scale * 0.5, 1e-6, 'linear: half way at 60 %');
  clean(h);
});

test('贝洛内 S2 军师的手段: 3 targets, marks up to 8 and a full mark keeps the target 停顿; back to 5 after the skill', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: BEL, row: 10, col: 5, skillIndex: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_dummy', pos: [11, 6] }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit(BEL), t0 = tal(u, 0);
  h.step();
  assert.ok(u.skill.activate('test', { free: true }));
  const [a] = h.b.enemies;
  assert.ok(h.runUntil(() => (u.mem.means.get(a.id)?.n ?? 0) >= t0['attack@s2_limited_stack_cnt'], 15), 'eight stacks in S2');
  assert.ok(a.findBuff('sluggish'), '停顿 at a full mark');
  const hit = new Set(h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack).map((c) => c.target.id));
  assert.equal(hit.size, 3, 'three targets');
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  h.run(0.2);
  assert.equal(u.mem.means.get(a.id).n, t0['attack@limited_stack_cnt'], 'back to the normal cap');
  assert.ok(!a.findBuff('sluggish') || a.findBuff('sluggish').source !== u, 'the 停顿 ends with it');
  clean(h);
});

test('贝洛内 街头直觉: 80 % dodge on deploy, −2 % per second, 40 % after 20 s', () => {
  const h = makeBattle({ units: [{ chessId: BEL, row: 10, col: 5 }], autoFinish: false, timeLimit: 60 });
  const u = h.unit(BEL), t1 = tal(u, 1);
  h.step();
  approx(u.s.dodgePhys, t1.init_prob, 1e-6);
  h.run(5.05);
  approx(u.s.dodgeArts, t1.init_prob - t1.dec_prob * 5, 1e-6);
  h.run(20);
  approx(u.s.dodgePhys, t1.init_prob - t1.dec_prob * t1.trig_cnt, 1e-6);
  clean(h);
});

test('贝洛内 S3 清算: moves onto a nearby ground enemy, ATK up; a fatal hit ends the skill; home at the end', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: BEL_E, row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], hooks: ['skillEnd'], autoFinish: false, timeLimit: 90,
  });
  const u = h.unit(BEL_E);
  h.step();
  const atk0 = u.s.atk;
  assert.ok(u.skill.activate('test', { free: true }));
  assert.deepEqual([u.tileR, u.tileC], [10, 6], 'on the enemy tile');
  approx(u.s.atk, atk0 * (1 + bbOf(u)['attack@demetr_s3[bonus].atk']), 1e-6, 'ATK');
  h.b.dealDamage(null, u, { amount: u.s.maxHp * 5, type: 'true' });
  assert.ok(u.alive, 'not knocked out');
  assert.ok(!u.skill.active, 'the skill ended instead');
  assert.deepEqual([u.tileR, u.tileC], [10, 4], 'back home');
  clean(h);
});

// ---- 丰川祥子 ----------------------------------------------------------------------------------------------------------

const SAKI = 'chess_pick6_char_4182_oblvns_a', SAKI_E = 'chess_pick6_char_4182_oblvns_b';

test('丰川祥子 颂乐音符: her notes ignore DEF / RES per note (≤ max_cnt); 毋畏遗忘: Fever per damage, operators in range ASPD +', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { def: 500 }) } },
    units: [{ chessId: SAKI, row: 10, col: 4, skillIndex: 1 }, { chessId: ALLY, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], hooks: ['hit'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit(SAKI), a = h.unit(ALLY), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  h.run(0.3);
  assert.ok(a.buffs.some((b) => b.key === `oblvns:t2:${u.id}`), 'ASPD aura on the operator in her range');
  assert.ok(h.runUntil(() => h.hooksOf('hit').filter((c) => c.source === u).length >= 6, 30));
  const hits = h.hooksOf('hit').filter((c) => c.source === u);
  const last = hits.at(-1);
  assert.ok(last.dmg.defIgnorePct > t0.def_penetrate_ratio - 1e-9, 'at least one note');
  assert.ok(last.dmg.defIgnorePct <= t0.def_penetrate_ratio * t0.max_cnt + 1e-9, 'capped');
  approx(last.dmg.resIgnorePct / last.dmg.defIgnorePct, t0.magic_resist_penetrate_ratio / t0.def_penetrate_ratio, 1e-6);
  assert.equal(u.mem.fever, hits.length * t1.cnt, 'Fever +cnt per damage instance');
  clean(h);
});

test('丰川祥子 S1 新月的苏醒: 8 arts notes descending; a cast at 450 Fever starts Fever — every attack then plays the 8 notes', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: SAKI, row: 10, col: 4, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit(SAKI);
  h.step();
  const notes = () => h.hooksOf('damaged').filter((c) => c.source === u && (c.dmg?.tags || []).includes('note'));
  u.mem.fever = 0;
  assert.ok(u.skill.activate('test', { free: true }));
  assert.equal(notes().length, 8, 'eight notes');
  assert.ok(notes().every((c) => c.type === 'arts'));
  approx(notes()[0].dmg.amount, u.s.atk * bbOf(u).atk_scale, 1e-6, 'first note');
  approx(notes()[7].dmg.amount, u.s.atk * bbOf(u).atk_scale_8, 1e-6, 'last note');
  u.mem.fever = 450;
  assert.ok(u.skill.activate('test', { free: true }));
  assert.ok(u.mem.feverUntil > h.b.time + 19, 'Fever for 20 s');
  assert.equal(u.mem.fever, 0, 'the gauge is spent');
  const n0 = notes().length;
  h.run(5);
  assert.ok(notes().length >= n0 + 16, `notes on every attack in Fever (${notes().length - n0})`);
  clean(h);
});

test('丰川祥子 S3 残月的余响: two phys notes on the highest-RES enemy, two arts notes on the highest-DEF one', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_res: dummy('enemy_res', { res: 60, def: 0 }), enemy_def: dummy('enemy_def', { def: 900, res: 0 }) } },
    units: [{ chessId: SAKI_E, row: 10, col: 4 }],
    enemies: [{ key: 'enemy_res', pos: [10, 6] }, { key: 'enemy_def', pos: [10, 7] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit(SAKI_E);
  h.step();
  assert.ok(u.skill.activate('test', { free: true }));
  const res = h.enemy('enemy_res'), dfn = h.enemy('enemy_def');
  const by = (e, type) => h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && c.type === type && c.dmg?.isSkill);
  assert.ok(h.runUntil(() => by(res, 'phys').length >= 2 && by(dfn, 'arts').length >= 2, 10));
  assert.equal(by(res, 'arts').length, 0, 'no arts on the high-RES one');
  assert.equal(by(dfn, 'phys').length, 0, 'no phys on the high-DEF one');
  clean(h);
});

test('白铁 铁钳号 and 突袭: with no enemy to reach, an idle 突袭 member jumps beside the 铁钳号, charges it and stays', () => {
  const h = makeBattle({
    defs: { chess: { r_m: chessRec({ id: 'r_m', bonds: ['raidShip'], stats: { maxHp: 3000, atk: 500, def: 0, blockCnt: 1, bat: 1 } }) } },
    units: [
      { chessId: IRON, row: 10, col: 2, uid: 1 },
      { kind: 'token', tokenId: P3, ownerUid: 1, row: 12, col: 7, uid: 3, dir: 'RIGHT' },
      { chessId: 'r_m', row: 9, col: 2, uid: 2 },
    ],
    bonds: { raidShip: { count: 2, active: true, tier: 1, layers: 10 } }, hooks: ['deploy'], autoFinish: false, timeLimit: 60,
  });
  h.run(0.5);
  const r = h.unit('r_m');
  const [claw] = devicesOf(h, P3);
  assert.equal(claw.mem.clawSp, 0, 'nobody reaches it yet');
  assert.ok(h.runUntil(() => r.tileR !== 9 || r.tileC !== 2, 15), 'the 突袭 member jumps');
  assert.ok(Math.max(Math.abs(r.tileR - 12), Math.abs(r.tileC - 7)) <= 2, `beside the 铁钳号 (${r.tileR},${r.tileC})`);
  const at = [r.tileR, r.tileC];
  h.run(12);
  assert.ok(claw.mem.clawSp > 0, `it charges the 铁钳号 (SP ${claw.mem.clawSp})`);
  assert.deepEqual([r.tileR, r.tileC], at, 'busy on it: no further jump');
  clean(h);
});
