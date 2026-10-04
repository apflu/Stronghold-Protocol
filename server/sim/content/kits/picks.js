// server/sim/content/kits/picks.js — hand-authored kits of the 甄选干员 (DIY picks, tools/build-data.mjs DIY_PICKS) that
// are not season chess. A pick exists once per tier it may fill (chess_pick5_… / chess_pick6_…, the status of the
// official DIY slot of that tier); both ids run the same kit. `export default { [baseChessId]: (bb, chess, def) => Kit }`
// (docs/SIM.md §7.2). The 原型干员 and 预备干员 have no kit here: the generic kit runs them from their blackboards.
//
// Every number comes from the blackboards (skill bb of the selected skill at the chess level, talents from
// `def.talents[i].bb` with the selected module's changes, module-only parts as unnamed talents).
//
// Simplifications (one line per operator):
//  阿斯卡纶  死亡拘审 stacks are independent (each lasts its own 30 s; a 4th refreshes the oldest); each stack slows by
//            18 % (multiplicative) and burns 11 % of her CURRENT ATK as arts per second; 恩赐's spread hits the enemies
//            within 1.3 tiles of a ground enemy knocked down inside her range while the skill runs; 降临's 命中率 −30 % =
//            an attack of a ground enemy in her range misses (is cancelled) with that chance — whoever it targets; a miss
//            on her or one of her dodges heals 5 % max HP; 高台 = a HIGH tile among the 4 orthogonal neighbours.
//  白铁      his devices are the player's hand pieces (two deployed of three carried — 战地工程师), docked on their tiles like a
//            skill's summon (tokens.js dockSkillSummons): "获得一个装置" puts one in stock and a docked piece takes its own
//            tile again (releaseSkillSummon; stock ≤ the carried devices not standing); the third device starts in stock;
//            节约经费's recovery puts a device that leaves within his 8 surrounding tiles back in stock (prob); S1's end
//            destroys every S1 device on the field (they may come back the same way). The devices' own rules are
//            tokens.js (白铁™多功能平台 / 铁钳号·原型机).

import { bodyInKeys } from '../../body.js';
import { releaseSkillSummon, TOKEN_IDS } from '../tokens.js';

const AURA = 0.2;          // aura refresh period (s)
const AURA_DUR = 0.25;     // aura buff lifetime (s): lapses ~1 tick after the source stops refreshing it

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : d));
const tbb = (def, i) => (def && def.talents && def.talents[i] && def.talents[i].bb) || {};
/** Module-only talent parts (unnamed talents) merged. */
const moduleBb = (def) => (def?.talents || []).filter((t) => !t.name && t.bb && Object.keys(t.bb).length).reduce((o, t) => Object.assign(o, t.bb), {});
const grid = (g) => (Array.isArray(g) && g.length ? g.map((p) => [p[0], p[1]]) : null);
/** base_attack_time −x s as the engine's batPct of the unit's own attack time (the tier kits' convention). */
const batFlat = (def, v) => { const b = num(def?.stats?.bat, 1) || 1; return Math.max(-0.9, num(v, 0) / b); };
const keySet = (unit) => unit.rangeKeySet || new Set(unit.rangeKeys || []);
const skillActive = (u) => !!(u.skill && u.skill.active && u.skill.kind !== 'passive');
const whileDeployed = (battle, unit, iv, fn) => battle.every(iv, () => { if (unit.alive && unit.deployed) fn(); }, { owner: unit });
const pulse = (battle, target, key, mods, extra = {}) => battle.addBuff(target, { key, mods, duration: AURA_DUR, ...extra });
/** Enemies whose body touches the unit's current range tiles (the tier kits' rule). */
function enemiesOnRange(battle, unit) {
  const set = keySet(unit);
  const out = [];
  for (const e of battle.enemies) if (e.alive && !e.hidden && bodyInKeys(e, set)) out.push(e);
  return out;
}
const selId = (def) => def?.skill?.id ?? def?.raw?.skill?.skillId ?? null;
const isSel = (def, id) => selId(def) === id;
function alt(def, builders) {
  const id = selId(def);
  return id && typeof builders[id] === 'function' ? { [id]: builders[id]() } : {};
}
const instantKind = (def) => ((def?.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');

// ===== 阿斯卡纶 (stalker) S3 降临 — wider range, ATK +20 %, BAT −1.5 s, taunt +2; ground enemies in range miss 30 % of
//       their attacks; a miss on her / a dodge of hers heals 5 % max HP
//       S1 追袭 (charges: the next attack at 170 %, twice); S2 恩赐 (ATK +90 %, ground enemies in range −40 % move speed,
//       a ground enemy knocked down in range spreads one 死亡拘审 stack to the enemies around it)
//       talents 死亡拘审 (attacks stack slow + arts DoT ≤ 3; module AMB-Y: 10 %, 25 s, a marked enemy's death heals her
//       10 %) / 噬光残影 (ASPD +8, +6 more next to 高台); module AMB-X: every enemy in range −20 % move speed (trait part)
const MARK = 'ascln:mark';
function ascalon(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
  const S2 = isSel(def, 'skchr_ascln_2'), S3 = isSel(def, 'skchr_ascln_3');
  const g = grid(def.skill?.rangeGrid);
  const maxStacks = Math.max(1, Math.floor(num(t0.max_stack_cnt, 3)));
  const markDur = num(t0.debuff_duration, 30);
  const markSlow = num(t0.move_speed, -0.18);
  const markRatio = num(t0.atk_ratio, 0.11);
  const markIv = Math.max(0.1, num(t0.interval, 1));
  const markHeal = num(t0.hp_ratio, 0); // module AMB-Y
  /** Add one 死亡拘审 stack on `e` (unit.mem.marks: enemy id → expiry times). */
  const addMark = (battle, unit, e) => {
    if (!e || !e.alive || e.side !== 'enemy') return;
    const now = battle.time;
    const list = (unit.mem.marks.get(e.id) || []).filter((t) => t > now);
    if (list.length >= maxStacks) list.sort((a, b) => a - b).shift();
    list.push(now + markDur);
    unit.mem.marks.set(e.id, list);
    battle.addBuff(e, { key: `${MARK}:${unit.id}`, source: unit, duration: Math.max(...list) - now, mods: { moveMul: Math.max(0, (1 + markSlow) ** list.length) } });
  };
  const hasMark = (unit, e, now) => (unit.mem.marks.get(e.id) || []).some((t) => t > now);
  const heal = (battle, unit, ratio) => { if (ratio > 0 && unit.alive && unit.deployed) battle.heal(unit, unit, unit.s.maxHp * ratio); };
  const groundIn = (battle, unit) => enemiesOnRange(battle, unit).filter((e) => !e.isFlying);
  return {
    skills: alt(def, {
      skchr_ascln_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 1.7), hits: 2 } }),
      skchr_ascln_2: () => ({
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
        onTick({ battle, unit }) {
          for (const e of groundIn(battle, unit)) pulse(battle, e, `ascln:s2slow:${unit.id}`, { moveMul: Math.max(0, 1 + num(bb.move_speed, -0.4)) });
        },
      }),
    }),
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batFlat(def, bb.base_attack_time), taunt: num(bb.taunt_level, 2) },
      targeting: g ? { rangeGrid: g } : undefined,
      onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
    },
    talents: [
      { install(battle, unit) { // 死亡拘审: every attack hit stacks the mark; each live stack burns markRatio × ATK arts / s
        unit.mem.marks = new Map();
        battle.on('damaged', (c) => {
          if (c.source !== unit || !c.dmg?.isAttack || c.type === 'element') return;
          addMark(battle, unit, c.target);
        }, { owner: unit });
        battle.every(markIv, () => {
          const now = battle.time;
          for (const [id, list] of unit.mem.marks) {
            const live = list.filter((t) => t > now);
            const e = battle.unitById(id);
            if (!live.length || !e || !e.alive) { unit.mem.marks.delete(id); continue; }
            unit.mem.marks.set(id, live);
            if (!unit.alive) continue;
            battle.dealDamage(unit, e, { amount: unit.s.atk * markRatio * live.length, type: 'arts', tags: ['talent', 'dot'] });
          }
        }, { owner: unit });
        battle.on('death', (c) => { // AMB-Y heal; 恩赐's spread (S2 running, a ground enemy down inside her range)
          const e = c.unit;
          if (!e || e.side !== 'enemy') return;
          if (markHeal > 0 && hasMark(unit, e, battle.time)) heal(battle, unit, markHeal);
          if (S2 && skillActive(unit) && unit.alive && !e.isFlying && bodyInKeys(e, keySet(unit))) {
            const r = num(bb.range_radius, 1.3);
            for (const o of battle.foesInRadius(e.x, e.y, r)) if (o !== e) addMark(battle, unit, o);
          }
          unit.mem.marks.delete(e.id);
        }, { owner: unit });
      } },
      { install(battle, unit) { // 噬光残影: ASPD +8, +6 when a 高台 tile is among her 4 neighbours
        const apply = () => {
          const high = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => {
            const r = unit.tileR + dr, c = unit.tileC + dc;
            return battle.grid.inBounds(r, c) && battle.grid.tile(r, c).height === 'HIGH';
          });
          battle.addBuff(unit, { key: 'ascln:t2', mods: { aspd: num(t1.attack_speed, 8) + (high ? num(t1.attack_speed_add, 6) : 0) }, persist: true });
        };
        battle.on('deploy', (c) => { if (c.unit === unit) apply(); }, { owner: unit });
        if (unit.deployed) apply();
      } },
    ],
    install(battle, unit) {
      // module AMB-X: every enemy in her range −20 % move speed
      const ms = num(mb.move_speed, 0);
      if (ms) whileDeployed(battle, unit, AURA, () => { for (const e of enemiesOnRange(battle, unit)) pulse(battle, e, `ascln:modslow:${unit.id}`, { moveMul: Math.max(0, 1 + ms) }); });
      if (!S3) return;
      // 降临: ground enemies in range miss 30 % of their attacks; a miss on her or her dodge heals 5 %
      const blinded = new Set();
      whileDeployed(battle, unit, AURA, () => {
        blinded.clear();
        if (skillActive(unit)) for (const e of groundIn(battle, unit)) blinded.add(e.id);
      });
      const miss = Math.max(0, -num(bb['attack@damage_hitrate_physical'], -0.3));
      const missArts = Math.max(0, -num(bb['attack@damage_hitrate_magical'], -0.3));
      const healRatio = num(bb['attack@hp_ratio'], 0.05);
      battle.on('hit', (c) => {
        const src = c.source;
        if (!src || src.side !== 'enemy' || !blinded.has(src.id) || !c.dmg.isAttack || c.dmg.cancel) return;
        const p = c.dmg.type === 'phys' ? miss : c.dmg.type === 'arts' ? missArts : 0;
        if (!(p > 0) || battle.rng() >= p) return;
        c.dmg.cancel = true;
        battle.fx('dodge', { x: c.target.x, y: c.target.y, id: c.target.id });
        if (c.target === unit && skillActive(unit)) heal(battle, unit, healRatio);
      }, { owner: unit });
      battle.on('dodge', (c) => { if (c.target === unit && skillActive(unit)) heal(battle, unit, healRatio); }, { owner: unit });
    },
  };
}

// ===== 白铁 (craftsman) S3 铁钳号·原型机 — a device now, ATK +40 %, ASPD +40 (devices: 铁钳号·原型机)
//       S1 极致火力 (a device now, attacks at attack@atk_scale, device effect ×fake_scale; at the end every device on the
//       field is destroyed — devices: ATK platforms); S2 高效补给 (ATK/DEF +40 %, hits every blocked enemy, devices faster
//       SP; a device at the end — devices: SP platforms); talents 战地工程师 (carry cnt, deploy 2 — data) / 节约经费 (SP
//       regen +0.2/s while a device of his stands on his 8 surrounding tiles; such a device leaving comes back to stock
//       with prob); module CRA-X carries one device more
const IRON_DEVICE = Object.freeze({ skchr_ironmn_1: TOKEN_IDS.ironAtk, skchr_ironmn_2: TOKEN_IDS.ironSp, skchr_ironmn_3: TOKEN_IDS.ironClaw });
const IRON_DEVICES = new Set(Object.values(IRON_DEVICE));
function ironmn(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1);
  const device = IRON_DEVICE[selId(def)] || TOKEN_IDS.ironClaw;
  const craX = !!(def?.raw?.module?.active && def.raw.module.id === 'uniequip_002_ironmn');
  const carry = Math.max(1, Math.floor(num(t0.cnt, 3))) + (craX ? 1 : 0);
  const recoverP = num(t1.prob, 0);
  // the SP part of 节约经费 exists in the talent text only ("技力回复速度+0.2/秒")
  const spMatch = (def?.raw?.talents ?? []).map((t) => /技力回复速度\+(\d+(?:\.\d+)?)/.exec(String(t?.desc ?? ''))).find(Boolean);
  const spRegen = spMatch ? +spMatch[1] : 0;
  const mine = (battle, unit) => battle.allyUnits.filter((t) => t.kind === 'token' && t.ownerUnit === unit && IRON_DEVICES.has(t.defId));
  const near = (unit, t) => Math.abs(t.tileR - unit.tileR) <= 1 && Math.abs(t.tileC - unit.tileC) <= 1 && t !== unit;
  /** "获得一个装置": one more in stock (≤ the carried ones not standing) and a docked piece takes the field. */
  const gain = (battle, unit) => {
    const standing = mine(battle, unit).filter((t) => t.alive && t.defId === device).length;
    return releaseSkillSummon(battle, unit, device, { cap: Math.max(1, carry - standing) });
  };
  return {
    skills: alt(def, {
      skchr_ironmn_1: () => ({
        kind: 'duration',
        attack: { atkScale: num(bb['attack@atk_scale'], 1.4) },
        onStart({ battle, unit }) { gain(battle, unit); battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
        onEnd({ battle, unit }) {
          for (const t of mine(battle, unit)) if (t.alive && t.defId === TOKEN_IDS.ironAtk) battle.retreat(t, { reason: 'destroyed' });
        },
      }),
      skchr_ironmn_2: () => ({
        kind: 'duration',
        mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
        attack: { hitAllBlocked: true },
        onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
        onEnd({ battle, unit }) { if (unit.alive) gain(battle, unit); },
      }),
    }),
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      onStart({ battle, unit }) { gain(battle, unit); battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
    },
    talents: [
      { install(battle, unit) { // 战地工程师: the carried device that is not on the board starts in stock
        battle.on('deploy', (c) => {
          if (c.unit !== unit || unit.mem.ironStocked) return;
          unit.mem.ironStocked = true;
          const placed = mine(battle, unit).filter((t) => t.defId === device && t.mem.docked).length;
          if (!placed) return; // no piece placed: the devices never appear
          const stock = unit.mem.summonStock || (unit.mem.summonStock = {});
          stock[device] = Math.max(stock[device] || 0, carry - placed);
        }, { owner: unit });
      } },
      { install(battle, unit) { // 节约经费
        if (spRegen > 0) {
          whileDeployed(battle, unit, AURA, () => {
            if (mine(battle, unit).some((t) => t.alive && t.deployed && near(unit, t))) pulse(battle, unit, 'ironmn:t2', { spRecoveryFlat: spRegen });
          });
        }
        battle.on('death', (c) => {
          const t = c.unit;
          if (!t || t.ownerUnit !== unit || !IRON_DEVICES.has(t.defId) || !unit.alive || !unit.deployed || !near(unit, t)) return;
          if (!(recoverP > 0) || battle.rng() >= recoverP) return;
          battle.fx('summon', { x: unit.x, y: unit.y, id: unit.id, token: t.defId });
          // after the removal bookkeeping (the dock's own death handler sets the redeploy time first)
          battle.after(0, () => { if (unit.alive) gain(battle, unit); }, { owner: unit });
        }, { owner: unit });
      } },
    ],
  };
}

const KITS = {};
for (const tier of [5, 6]) {
  KITS[`chess_pick${tier}_char_4132_ascln_a`] = ascalon;
  KITS[`chess_pick${tier}_char_4072_ironmn_a`] = ironmn;
}
export default KITS;
