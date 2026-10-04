// 甄选干员 kits (server/sim/content/kits/picks.js): each pick runs a real battle through the harness and its signature
// effects are asserted with numbers taken from its own blackboards (normal Lv4 / elite Lv7, the selected module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
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
