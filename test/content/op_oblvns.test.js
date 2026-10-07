// test/content/op_oblvns.test.js — the 自选 operator kit of 丰川祥子 (char_4182_oblvns, 6★ 领主; kit
// server/sim/content/kits/ops/op-oblvns.js; a wjx addition — tools/build-data.mjs DIY_INCLUDED_COLLAB), fielded the
// production way (a DIY slot + its `diy` pick, simdata getDiy) in every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4,
// no module) and elite (E2 Lv60, rank 7) with no module or LOR-Y “无言的约定” at stage 1 (tier 5) / 3 (tier 6). Every
// number is read back from data/backups.json. Ported from the wjx tests of deploy-2026-10-03 (test/content/kits_picks.test.js).
// Run: node --test test/content/op_oblvns.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { FEVER_MAX, FEVER_TIME, NOTE_HOLD } from '../../server/sim/content/kits/ops/op-oblvns.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const SAKI = 'char_4182_oblvns';
const FORMS = BACKUPS.units[SAKI].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const LORY = 'uniequip_002_oblvns';
const S1 = 'skchr_oblvns_1', S2 = 'skchr_oblvns_2', S3 = 'skchr_oblvns_3';
const ALLY = 'chess_char_1_02_a';   // 角峰, an operator to stand in her range
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier) => formOf(tier, true).modules.find((m) => m.uniEquipId === LORY);
/** A talent's blackboard of a form with its module (the module talent change merged over the base). */
const tOf = (i, tier, elite, mod) => {
  const base = formOf(tier, elite).talents.find((t) => t.index === i).bb;
  const ch = elite && mod ? modOf(tier).talentChanges.find((t) => t.talentIndex === i) : null;
  return { ...base, ...(ch?.bb ?? {}) };
};
const num = (v) => (Number.isFinite(v) ? v : 0);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_armor: dummy('enemy_armor', { def: 500 }),
  enemy_res: dummy('enemy_res', { res: 60 }),
  enemy_def: dummy('enemy_def', { def: 900 }),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], [5, true, null], [5, true, LORY], [6, true, null], [6, true, LORY]];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** A battle with 丰川祥子 as uid 1 at (row, col) facing RIGHT. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, seed = 5, others = [], hooks = [] } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'attack', ...hooks], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: SAKI, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const from = (h, u, pred = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && pred(c));
const isNote = (c) => (c.dmg?.tags || []).includes('oblvns:note');
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('丰川祥子 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + LOR-Y attributes, 3-12, a 领主 hitting air, bonds from her faction (mujica ⇒ 协防干员)', () => {
  assert.equal(OPERATOR_KITS[SAKI], KITS[SAKI]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite && mod ? modOf(tier) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [SAKI, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.aspd], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), 100 + (m?.attr.aspd ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.sub, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.profile.rangedScale], [2, 'lord', 'ranged', true, 'phys', 0.8], `${label(f)}: 领主`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-12`);
      assert.deepEqual([u.def.bonds, form.tokens], [['emptyShip'], []], `${label(f)}: bonds / no summons`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN): LOR-Y +180 / +38 / +5 at stage 1, +300 / +63 / +7 at stage 3 (HP / ATK / ASPD)
  assert.deepEqual([modOf(5).attr, modOf(6).attr], [{ maxHp: 180, atk: 38, aspd: 5 }, { maxHp: 300, atk: 63, aspd: 7 }]);
  assert.deepEqual([skillOf(5, false, S3).rangeId, skillOf(5, false, S3).trigger.rule], ['3-21', 'ACTIVE_RANGE']);
});

test('a 自选 pick: 丰川祥子 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(SAKI));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(SAKI), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: SAKI, skillIndex: 2, uniEquipId: LORY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: SAKI, skillIndex: 2, uniEquipId: LORY } } });
});

test('颂乐音符: every hit of hers is a note — n live notes (≤ max_cnt) ignore n × def_penetrate_ratio of DEF and n × magic_resist_penetrate_ratio of RES', () => {
  for (const f of [[6, false, null], [6, true, LORY]]) {
    const [tier, elite, mod] = f;
    const t0 = tOf(0, tier, elite, mod);
    const { h, u } = field({ tier, elite, mod, skill: 0, hooks: ['hit'] });
    u.skill.sp = 0;
    u.skill.charges = 0;
    h.spawn('enemy_armor', { pos: [10, 6] });
    assert.ok(h.runUntil(() => h.hooksOf('hit').filter((c) => c.source === u).length >= 6, 30), label(f));
    const hits = h.hooksOf('hit').filter((c) => c.source === u);
    const life = num(t0.delay) + NOTE_HOLD;
    hits.forEach((c, i) => {   // the notes alive at this hit: the earlier ones younger than `life`, and itself
      const n = Math.min(t0.max_cnt, hits.slice(0, i + 1).filter((x) => x.t > c.t - life + 1e-9).length);
      approx(c.dmg.defIgnorePct, n * t0.def_penetrate_ratio, `${label(f)}: DEF ignore at ${c.t}`);
      approx(c.dmg.resIgnorePct, n * t0.magic_resist_penetrate_ratio, `${label(f)}: RES ignore at ${c.t}`);
    });
    assert.ok(hits[0].dmg.defIgnorePct > 0, `${label(f)}: the first hit is a note`);
    done(h);
  }
  // E2 3 % / 2 % (10 layers); LOR-Y stage 3 5 % / 2.5 % (12 layers)
  assert.deepEqual([tOf(0, 6, false, null), tOf(0, 6, true, LORY)].map((b) => [b.def_penetrate_ratio, b.magic_resist_penetrate_ratio, b.max_cnt]), [[0.03, 0.02, 10], [0.05, 0.025, 12]]);
});
test('毋畏遗忘: Fever +cnt per damage dealt to an enemy; the operators in her range ASPD +attack_speed, none outside it', () => {
  const t1 = tOf(1, 5, false, null);
  const { h, u } = field({ tier: 5, skill: 0, others: [{ uid: 2, chessId: ALLY, row: 10, col: 6 }, { uid: 3, chessId: ALLY, row: 8, col: 5 }] });
  u.skill.sp = 0;
  u.skill.charges = 0;
  const inRange = h.unit(2), outside = h.unit(3);
  h.run(0.6);
  assert.equal(inRange.findBuff('talent:oblvns:aspd')?.mods?.aspd, t1.attack_speed, 'ASPD on the operator in her range');
  assert.ok(u.findBuff('talent:oblvns:aspd'), 'her own tile is in her range');
  assert.equal(outside.findBuff('talent:oblvns:aspd'), null, 'none outside it');
  h.spawn('enemy_dummy', { pos: [10, 7] });
  assert.ok(h.runUntil(() => from(h, u).length >= 5, 30));
  h.run(0);
  assert.equal(u.mem.oblvnsFever, from(h, u).length * t1.cnt, 'Fever +cnt per damage instance');
  assert.deepEqual([t1.cnt, t1.attack_speed], [3, 12]);
  done(h);
});

test('S1 新月的苏醒: 8 arts notes from atk_scale down to atk_scale_8; a cast with a full Fever gauge starts Fever — every attack then plays the 8 notes', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const b1 = skillOf(tier, elite, S1).bb;
    const { h, u } = field({ tier, elite, skill: 0 });
    u.skill.sp = 0;
    u.skill.charges = 0;
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(0.05);
    assert.ok(u.skill.activate('test', { free: true }));
    const notes = () => from(h, u, isNote);
    assert.equal(notes().length, 8, `T${tier}: eight notes`);
    assert.ok(notes().every((c) => c.type === 'arts' && c.dmg.isSkill && !c.dmg.isAttack));
    approx(notes()[0].amount, u.s.atk * b1.atk_scale, `T${tier}: first note`);
    approx(notes()[7].amount, u.s.atk * b1.atk_scale_8, `T${tier}: last note`);
    assert.equal(u.mem.oblvnsFeverUntil, undefined, `T${tier}: no Fever yet`);
    u.mem.oblvnsFever = FEVER_MAX;
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.mem.oblvnsFeverUntil, h.b.time + FEVER_TIME, `T${tier}: Fever for 20 s`);
    assert.equal(u.mem.oblvnsFever, 0, `T${tier}: the gauge is spent`);
    const n0 = notes().length, a0 = h.hooksOf('attack').filter((c) => c.attacker === u).length;
    h.run(5);
    const attacks = h.hooksOf('attack').filter((c) => c.attacker === u).length - a0;
    assert.ok(attacks >= 2 && notes().length - n0 >= 8 * attacks, `T${tier}: 8 notes per attack in Fever (${notes().length - n0} for ${attacks})`);
    done(h);
  }
});

test('S2 满月的舞会: piano (initial) ATK +attack@atk physical; a cast switches to organ — ASPD +attack@attack_speed, arts hits — and back; in Fever every attack hits twice and the starting cast keeps the tone', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const b2 = skillOf(tier, elite, S2).bb;
    const { h, u } = field({ tier, elite, skill: 1 });
    u.skill.sp = 0;
    h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.equal(u.mem.oblvnsTone, 'piano', `T${tier}: piano first`);
    approx(u.s.atk, u.base.atk * (1 + b2['attack@atk']), `T${tier}: piano ATK`);
    assert.ok(h.runUntil(() => from(h, u, (c) => c.dmg.isAttack).length > 0, 5));
    assert.equal(from(h, u, (c) => c.dmg.isAttack).at(-1).type, 'phys', `T${tier}: piano notes are physical`);
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(u.mem.oblvnsTone, 'organ', `T${tier}: organ`);
    h.run(0);
    approx(u.s.atk, u.base.atk, `T${tier}: organ, no ATK`);
    // (+ 毋畏遗忘's aura: her own tile is in her range)
    assert.equal(u.s.aspd, u.base.aspd + b2['attack@attack_speed'] + tOf(1, tier, elite, null).attack_speed, `T${tier}: organ ASPD`);
    const k = from(h, u).length;
    assert.ok(h.runUntil(() => from(h, u, (c) => c.dmg.isAttack).length > k, 5));
    assert.equal(from(h, u, (c) => c.dmg.isAttack).at(-1).type, 'arts', `T${tier}: organ notes are arts`);
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(u.mem.oblvnsTone, 'piano', `T${tier}: back to piano`);
    // Fever: the starting cast does not switch; every attack hits twice
    u.mem.oblvnsFever = FEVER_MAX;
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(u.mem.oblvnsTone, 'piano', `T${tier}: the cast that starts Fever only starts it`);
    const t0 = h.b.time;
    h.run(4);
    const byAttack = new Map();
    for (const c of from(h, u, (x) => x.dmg.isAttack && x.t > t0)) byAttack.set(c.dmg.attackId, (byAttack.get(c.dmg.attackId) ?? 0) + 1);
    assert.ok(byAttack.size >= 2 && [...byAttack.values()].every((n) => n === 2), `T${tier}: 二连击 (${[...byAttack.values()]})`);
    done(h);
  }
});

test('S3 残月的余响: range 3-21; two physical hits on the highest-RES enemy, two arts notes on the highest-DEF one, attack@atk_scale each', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const b3 = skillOf(tier, elite, S3).bb;
    const { h, u } = field({ tier, elite, skill: 2 });
    u.skill.sp = 0;
    const res = h.spawn('enemy_res', { pos: [10, 7] }), dfn = h.spawn('enemy_def', { pos: [10, 8] });
    h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(u.skill.activate('test', { free: true }));
    assert.deepEqual(u.liveRangeGrid, skillOf(tier, elite, S3).rangeGrid, `T${tier}: 3-21`);
    const by = (e, type) => from(h, u, (c) => c.target === e && c.type === type);
    assert.ok(h.runUntil(() => by(res, 'phys').length >= 4 && by(dfn, 'arts').length >= 4, 10), `T${tier}`);
    assert.equal(by(res, 'arts').length, 0, `T${tier}: no arts on the high-RES one`);
    assert.equal(by(dfn, 'phys').length, 0, `T${tier}: no phys on the high-DEF one`);
    const atk = h.hooksOf('attack').filter((c) => c.attacker === u);
    assert.ok(atk.every((c) => c.targets.length === 1 && c.targets[0] === res), `T${tier}: every attack on the high-RES enemy`);
    // both two tiles away or more: the lord's ×0.8 (no module)
    approx(by(res, 'phys')[0].dmg.amount, u.s.atk * b3['attack@atk_scale'] * 0.8, `T${tier}: piano note`);
    approx(by(dfn, 'arts')[0].dmg.amount, u.s.atk * b3['attack@atk_scale'] * 0.8, `T${tier}: organ note`);
    assert.equal(by(res, 'phys').length % 2, 0, `T${tier}: two per attack`);
    done(h);
  }
});

test('颂乐音符 LOR-Y stage 3 (tier-6 elite): "技能期间远程攻击不再降低攻击力" — S3 at full ATK; stage 1 (tier-5 elite) keeps the ×0.8', () => {
  for (const [tier, lift] of [[6, true], [5, false]]) {
    const b3 = skillOf(tier, true, S3).bb;
    const { h, u } = field({ tier, elite: true, mod: LORY, skill: 2 });
    u.skill.sp = 0;
    const e = h.spawn('enemy_dummy', { pos: [10, 8] });
    const desc = u.def.raw.talents.find((t) => t.index === 0).desc;
    assert.equal(/远程攻击不再降低攻击力/.test(desc), lift, `T${tier}: talent text`);
    assert.ok(h.runUntil(() => from(h, u, (c) => c.dmg.isAttack && c.target === e).length > 0, 10));
    approx(from(h, u, (c) => c.dmg.isAttack && c.target === e)[0].dmg.amount, u.s.atk * 0.8, `T${tier}: outside the skill ×0.8`);
    assert.ok(u.skill.activate('test', { free: true }));
    const k = from(h, u).length;
    assert.ok(h.runUntil(() => from(h, u, (c) => c.dmg.isAttack).length > k + 1 && from(h, u, isNote).length >= 2, 10));
    const mul = lift ? 1 : 0.8;
    approx(from(h, u, (c) => c.dmg.isAttack).at(-1).dmg.amount, u.s.atk * b3['attack@atk_scale'] * mul, `T${tier}: S3 piano note`);
    approx(from(h, u, isNote).at(-1).dmg.amount, u.s.atk * b3['attack@atk_scale'] * mul, `T${tier}: S3 organ note`);
    done(h);
  }
});

test('S3 in Fever: a fatal hit leaves her at 1 HP; she leaves the field when Fever ends', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: LORY, skill: 2, hooks: ['death'] });
  u.skill.sp = 0;
  const e = h.spawn('enemy_dummy', { pos: [10, 7] });
  u.mem.oblvnsFever = FEVER_MAX;
  assert.ok(u.skill.activate('test', { free: true }));
  h.run(1);
  h.b.dealDamage(e, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.deployed && u.hp >= 1, 'not knocked out in Fever');
  h.run(FEVER_TIME - 1.5);
  assert.ok(u.deployed, 'still on the field while Fever lasts');
  h.run(1);
  assert.ok(!u.deployed, 'gone when Fever ended');
  assert.ok(h.hooksOf('death').some((c) => c.unit === u && c.dying), 'a forced exit with the death animation');
  done(h);
});

test('LOR-Y trait: ASPD +attack_speed while two or more enemies stand on her range', () => {
  const tb = modOf(5).traitOverride.bb;
  assert.equal(tb.attack_speed, 12);
  const { h, u } = field({ tier: 5, elite: true, mod: LORY, skill: 0 });
  u.skill.sp = 0;
  u.skill.charges = 0;
  h.spawn('enemy_dummy', { pos: [10, 7] });
  h.run(0.2);
  assert.equal(u.findBuff('trait:oblvns:crowd'), null, 'one enemy: no bonus');
  const base = u.s.aspd;
  h.spawn('enemy_dummy', { pos: [10, 8] });
  h.run(0.2);
  assert.ok(u.findBuff('trait:oblvns:crowd'), 'two enemies');
  assert.equal(u.s.aspd, base + tb.attack_speed);
  done(h);
});
