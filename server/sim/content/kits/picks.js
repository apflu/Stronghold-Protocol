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
//  贝洛内    【手段】: one mark per enemy for every 贝洛内 (the strongest DEF cut wins: a shared buff key keeping the highest),
//            stacks refreshed by each of her attack hits (before the damage), DEF × (1 − 8 % × stacks) (final); outside her
//            S2 the stacks fall back to the normal cap at once (the 0.1 s "natural update"); the HP-based damage bonus is on
//            every damage she deals. 清算: the target is a ground enemy within DEMETR_DASH_RADIUS tiles [ASSUMED "自身周围
//            一定范围"] standing on deployable ground nobody else holds; she 移动s onto its tile (moveRedeploy) and back home at
//            the end (stays where she is when home is taken) — no 牵绊 marker [ASSUMED: nothing else redeploys there
//            mid-battle]; the 40 % proc raises that attack to prob_atk_scale × ATK.
//  丰川祥子  音符 are her attacks (no free flight / homing model): every attack adds a note living SAKIKO_NOTE_LIFE s
//            [ASSUMED], at most max_cnt count for 颂乐音符's DEF / RES ignore on her own damage (the only Ave Mujica member
//            in the remake); no 持续攻击 without a target. Fever (term: 450 points, a skill cast then runs the skill for 20 s):
//            +cnt per damage instance on an enemy (dodged ones too); the cast that finds 450 starts Fever — S1 then fires its
//            8 notes on every attack, S2 hits twice, S3 stays up while it lasts; a fatal hit during Fever leaves her at 1 HP and
//            she leaves when Fever ends. S1's 8 notes go to the enemies in range nearest first, round-robin; S2 switches tone
//            at every cast (piano first) [ASSUMED: no manual switch], piano notes do not pierce; S3: two phys notes on the
//            highest-RES enemy in range, two arts notes on the highest-DEF one.

import { bodyInKeys, bodyOnTile } from '../../body.js';
import { frontOf } from '../../dir.js';
import { COLS } from '../../constants.js';
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

// ===== 贝洛内 (fighter) S3 清算 — ATK / ASPD up, 40 % of attacks at 150 %; dashes onto a ground enemy's tile (re-targets
//       when an elite / leader she hit falls or after 1 s without attacking), a fatal hit ends the skill instead, home at
//       the end. S1 家主的余裕 (next attack twice at atk_scale; both hits mark); S2 军师的手段 (skill range, ASPD, 3 targets at
//       attack@atk_scale; marks up to 8, a full mark keeps the target 停顿). Trait (elite): ASPD +10 above 50 % HP.
//       Talents 家族手段 / 街头直觉 (80 % dodge on deploy, −2 % per second for 20 s, then 40 %).
const DEMETR_MARK = 'demetr:means';
/** 清算's search radius around her (tiles) [ASSUMED: "自身周围一定范围"]. */
export const DEMETR_DASH_RADIUS = 2.5;
function bellone(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def.traitBb || {};
  const S2 = isSel(def, 'skchr_demetr_2'), S3 = isSel(def, 'skchr_demetr_3');
  const g = grid(def.skill?.rangeGrid);
  const cut = Math.abs(num(t0['attack@def'], -0.08));
  const cap = Math.max(1, Math.floor(num(t0['attack@limited_stack_cnt'], 5)));
  const capS2 = Math.max(cap, Math.floor(num(t0['attack@s2_limited_stack_cnt'], 8)));
  const markDur = num(t0['attack@def_dec_duration'], 10);
  const hiR = num(t0.min_hp_ratio, 1), loR = num(t0.max_hp_ratio, 0.2), maxAdd = num(t0.max_add_on_scale, 0.42);
  const s3 = (k, d) => num(bb[`attack@demetr_s3[bonus].${k}`], d);
  /** Her 【手段】 on an enemy: stacks n until t (unit.mem.means: enemy id → { n, until }). */
  const applyMark = (battle, unit, e, n, until) => {
    const mods = { defMul: Math.max(0, 1 - cut * n) };
    const cur = e.findBuff(DEMETR_MARK);
    if (cur && cur.source !== unit && (cur.mods?.defMul ?? 1) < mods.defMul) return; // a stronger 贝洛内 mark wins
    battle.addBuff(e, { key: DEMETR_MARK, mods, duration: Math.max(0.05, until - battle.time), source: unit, visible: true });
  };
  const freeGround = (battle, unit, r, c) => battle.grid.inRect(r, c) && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c)
    && !battle.isReservedTile(r, c) && (!battle.unitAt(r, c) || battle.unitAt(r, c) === unit);
  /** 清算: move onto a ground enemy within the radius standing on free deployable ground (nearest first). */
  const dash = (battle, unit) => {
    const foes = battle.foesInRadius(unit.x, unit.y, DEMETR_DASH_RADIUS)
      .filter((e) => e.alive && !e.isFlying && freeGround(battle, unit, Math.round(e.y), Math.round(e.x)))
      .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y) || a.id - b.id);
    const t = foes[0];
    unit.mem.dashAt = battle.time;
    if (!t) return false;
    const r = Math.round(t.y), c = Math.round(t.x);
    if (r === unit.tileR && c === unit.tileC) return true;
    const fromX = unit.x, fromY = unit.y;
    if (!battle.moveRedeploy(unit, r, c)) return false;
    unit.mem.dashTarget = t;
    battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
    return true;
  };
  const goHome = (battle, unit) => {
    const h = unit.mem.home;
    unit.mem.home = null;
    if (!h || !unit.alive || !unit.deployed || (unit.tileR === h[0] && unit.tileC === h[1])) return;
    const fromX = unit.x, fromY = unit.y;
    if (freeGround(battle, unit, h[0], h[1]) && battle.moveRedeploy(unit, h[0], h[1])) battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
  };
  return {
    skills: alt(def, {
      skchr_demetr_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 2.1), hits: 2 } }),
      skchr_demetr_2: () => ({
        kind: 'duration',
        mods: { aspd: num(bb.attack_speed) },
        targeting: { ...(g ? { rangeGrid: g } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 3))) },
        attack: { atkScale: num(bb['attack@atk_scale'], 1.7) },
        onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
      }),
    }),
    skill: {
      kind: 'duration',
      mods: { atkPct: s3('atk', 1.4), aspd: s3('attack_speed', 40) },
      onStart({ battle, unit }) {
        unit.mem.home = [unit.tileR, unit.tileC];
        unit.mem.lastHitAt = battle.time;
        dash(battle, unit);
      },
      onTick({ battle, unit }) {
        const t = unit.mem.dashTarget;
        const idle = battle.time - Math.max(unit.lastAttackAt ?? -Infinity, unit.mem.dashAt ?? -Infinity) >= 1 - 1e-9;
        const eliteDown = t && !t.alive && (t.isBoss || t.def?.rank === 'ELITE' || t.def?.rank === 'BOSS');
        if (idle || eliteDown) { unit.mem.dashTarget = null; dash(battle, unit); }
      },
      onEnd({ battle, unit }) { unit.mem.dashTarget = null; goHome(battle, unit); },
    },
    talents: [
      { install(battle, unit) { // 家族手段
        unit.mem.means = new Map();
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.target || c.target.side !== 'enemy') return;
          const e = c.target;
          if (c.dmg.isAttack) {
            const s2 = S2 && skillActive(unit);
            const m = unit.mem.means.get(e.id);
            const live = m && m.until > battle.time ? m.n : 0;
            const n = Math.min(s2 ? capS2 : cap, live + 1);
            const until = battle.time + markDur;
            unit.mem.means.set(e.id, { n, until });
            applyMark(battle, unit, e, n, until);
            if (s2 && n >= capS2) battle.applyStatus(e, 'sluggish', { duration: markDur, source: unit });
          }
          // the lower the target's HP ratio, the more damage (linear, +max_add_on_scale at ≤ max_hp_ratio)
          const r = Math.max(0, Math.min(1, e.hpRatio ?? 1));
          const k = r >= hiR ? 0 : r <= loR ? 1 : (hiR - r) / Math.max(1e-6, hiR - loR);
          if (k > 0) c.dmg.mul *= 1 + maxAdd * k;
          // 清算: the proc raises the attack to prob_atk_scale × ATK
          if (S3 && skillActive(unit) && c.dmg.isAttack && !c.dmg.isSplash && battle.rng() < s3('prob', 0.4)) c.dmg.mul *= s3('prob_atk_scale', 1.5);
        }, { owner: unit });
        battle.every(0.1, () => { // the "natural update": stacks above the cap fall back outside S2
          if (S2 && skillActive(unit)) return;
          for (const [id, m] of unit.mem.means) {
            const e = battle.unitById(id);
            if (!e || !e.alive || m.until <= battle.time) { unit.mem.means.delete(id); continue; }
            if (m.n > cap) {
              m.n = cap;
              applyMark(battle, unit, e, m.n, m.until);
              if (e.findBuff('sluggish')?.source === unit) battle.removeBuff(e, 'sluggish');
            }
          }
        }, { owner: unit });
      } },
      { install(battle, unit) { // 街头直觉: 80 % on deploy, −dec per second (trig_cnt times) to init − dec × cnt
        const init = num(t1.init_prob, 0.8), dec = num(t1.dec_prob, 0.02), cnt = Math.max(0, Math.floor(num(t1.trig_cnt, 20)));
        const set = (p) => battle.addBuff(unit, { key: 'demetr:t2', mods: { dodgePhys: p, dodgeArts: p }, persist: true });
        battle.on('deploy', (c) => {
          if (c.unit !== unit || c.move) return;
          unit.mem.dodgeSeq = (unit.mem.dodgeSeq || 0) + 1;
          const seq = unit.mem.dodgeSeq;
          set(init);
          for (let i = 1; i <= cnt; i++) battle.after(i, () => { if (unit.mem.dodgeSeq === seq) set(init - dec * i); }, { owner: unit });
        }, { owner: unit });
        if (unit.deployed) set(init - dec * cnt);
      } },
    ],
    install(battle, unit) {
      // trait (elite): ASPD up while HP is above the ratio
      if (num(tb.attack_speed, 0) > 0) whileDeployed(battle, unit, AURA, () => { if (unit.hpRatio > num(tb.hp_ratio, 0.5)) pulse(battle, unit, 'demetr:trait', { aspd: num(tb.attack_speed) }); });
      if (!S3) return;
      battle.on('fatal', (c) => { // 清算: a fatal hit ends the skill instead of a retreat
        if (c.unit !== unit || !skillActive(unit)) return;
        c.prevented = true;
        unit.skill.end('fatal');
      }, { owner: unit });
    },
  };
}

// ===== 丰川祥子 (lord) S3 残月的余响 — skill range; each attack: two phys notes on the highest-RES enemy, two arts notes
//       on the highest-DEF one, attack@atk_scale each. S1 新月的苏醒 (charges: 8 arts notes atk_scale … atk_scale_8);
//       S2 满月的舞会 (piano: ATK +, phys / organ: ASPD +, arts — switched at each cast). Talents 颂乐音符 (notes ⇒ DEF / RES
//       ignore; no ranged ATK cut while a skill runs) / 毋畏遗忘 (Fever +cnt per damage; operators in her range ASPD +).
/** How long a note counts for 颂乐音符 (s) [ASSUMED: notes fly on after their hit and fade]. */
export const SAKIKO_NOTE_LIFE = 1.5;
const FEVER_MAX = 450;
const FEVER_TIME = 20;
function sakiko(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def.traitBb || {};
  const S1 = isSel(def, 'skchr_oblvns_1'), S2 = isSel(def, 'skchr_oblvns_2'), S3 = isSel(def, 'skchr_oblvns_3');
  const g = grid(def.skill?.rangeGrid);
  const rangedScale = num(tb.atk_scale, 0.8);
  const noteCap = Math.max(1, Math.floor(num(t0.max_cnt, 12)));
  const feverOn = (battle, unit) => (unit.mem.feverUntil ?? -Infinity) > battle.time;
  const notes = (battle, unit) => (unit.mem.notes = (unit.mem.notes || []).filter((t) => t > battle.time)).length;
  const s1Scales = ['atk_scale', ...[2, 3, 4, 5, 6, 7, 8].map((i) => `atk_scale_${i}`)].map((k) => num(bb[k], 0)).filter((v) => v > 0);
  const ranged = (unit, e) => {
    if (e.blockedBy === unit) return false;
    const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir);
    return !(bodyOnTile(e, unit.tileR, unit.tileC) || bodyOnTile(e, fr, fc));
  };
  /** S1: 8 notes, nearest enemies in range first, round-robin. */
  const burst = (battle, unit) => {
    const foes = enemiesOnRange(battle, unit).filter((e) => e.alive).sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y) || a.id - b.id);
    if (!foes.length) return;
    s1Scales.forEach((sc, i) => {
      const e = foes[i % foes.length];
      if (!e.alive) return;
      unit.mem.notes.push(battle.time + SAKIKO_NOTE_LIFE);
      battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'arts', isSkill: true, tags: ['skill', 'note'] });
    });
    battle.fx('splash', { x: foes[0].x, y: foes[0].y, id: foes[0].id });
  };
  const toneMods = (tone) => (tone === 'organ' ? { aspd: num(bb['attack@attack_speed'], 110) } : { atkPct: num(bb['attack@atk'], 0.75) });
  return {
    skills: alt(def, {
      skchr_oblvns_1: () => ({ kind: instantKind(def), onStart({ battle, unit }) { burst(battle, unit); } }),
      skchr_oblvns_2: () => ({
        kind: 'instant',
        onStart({ battle, unit }) {
          if ((unit.mem.fever || 0) >= FEVER_MAX) return; // the cast that starts Fever only starts it (PRTS 备注)
          unit.mem.tone = unit.mem.tone === 'organ' ? 'piano' : 'organ';
          battle.addBuff(unit, { key: 'oblvns:tone', mods: toneMods(unit.mem.tone), persist: true });
        },
      }),
    }),
    skill: {
      kind: 'duration',
      targeting: g ? { rangeGrid: g } : undefined,
      attack: { atkScale: num(bb['attack@atk_scale'], 1.8), hits: 2 },
      onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
      onHit({ battle, unit }) { // the organ's two arts notes on the highest-DEF enemy in range
        const foes = enemiesOnRange(battle, unit).filter((e) => e.alive);
        if (!foes.length) return;
        const e = foes.sort((a, b) => (b.s.def ?? 0) - (a.s.def ?? 0) || a.id - b.id)[0];
        for (let i = 0; i < 2 && e.alive; i++) {
          unit.mem.notes.push(battle.time + SAKIKO_NOTE_LIFE);
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['attack@atk_scale'], 1.8), type: 'arts', isSkill: true, tags: ['skill', 'note'] });
        }
      },
      onTick({ unit, battle, skill }) { if (feverOn(battle, unit)) skill.timeLeft = Math.max(skill.timeLeft, unit.mem.feverUntil - battle.time); },
    },
    talents: [
      { install(battle, unit) { // 颂乐音符 + Fever points + the ranged cut lifted during a skill
        unit.mem.notes = [];
        battle.on('attack', (c) => {
          if (c.attacker !== unit) return;
          unit.mem.notes.push(battle.time + SAKIKO_NOTE_LIFE);
          if (S1 && feverOn(battle, unit)) burst(battle, unit);
        }, { owner: unit });
        battle.on('beforeAttack', (c) => { // S3: the piano notes go to the highest-RES enemy in range
          if (c.attacker !== unit || !S3 || !skillActive(unit)) return;
          const foes = enemiesOnRange(battle, unit).filter((e) => e.alive);
          if (foes.length) c.targets = [foes.sort((a, b) => (b.s.res ?? 0) - (a.s.res ?? 0) || a.id - b.id)[0]];
        }, { owner: unit });
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.target || c.target.side !== 'enemy') return;
          unit.mem.fever = Math.min(FEVER_MAX, (unit.mem.fever || 0) + num(t1.cnt, 3));
          const n = Math.min(noteCap, Math.max(1, notes(battle, unit)));
          c.dmg.defIgnorePct = (c.dmg.defIgnorePct || 0) + n * num(t0.def_penetrate_ratio, 0.05);
          c.dmg.resIgnorePct = (c.dmg.resIgnorePct || 0) + n * num(t0.magic_resist_penetrate_ratio, 0.025);
          if (c.dmg.isAttack && skillActive(unit) && ranged(unit, c.target) && rangedScale > 0) c.dmg.mul /= rangedScale;
        }, { owner: unit });
        battle.on('damaged', (c) => { // S2 in Fever: every attack hit twice
          if (c.source !== unit || !S2 || !c.dmg?.isAttack || (c.dmg.tags || []).includes('fever') || !feverOn(battle, unit) || !c.target.alive) return;
          battle.dealDamage(unit, c.target, { amount: c.dmg.amount, type: c.type, isAttack: true, tags: ['fever'] });
        }, { owner: unit });
        battle.on('skillStart', (c) => { // a cast with a full Fever gauge starts Fever
          if (c.unit !== unit || (unit.mem.fever || 0) < FEVER_MAX) return;
          unit.mem.fever = 0;
          unit.mem.feverStartedAt = battle.time;
          unit.mem.feverUntil = battle.time + FEVER_TIME;
          battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id });
          battle.after(FEVER_TIME, () => { if (unit.mem.feverDoomed && unit.alive) { unit.mem.feverDoomed = false; battle.kill(unit); } }, { owner: unit });
        }, { priority: 10, owner: unit });
        battle.on('fatal', (c) => { // S3 in Fever: no retreat until Fever ends
          if (c.unit !== unit || !S3 || !feverOn(battle, unit)) return;
          c.prevented = true;
          unit.mem.feverDoomed = true;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 毋畏遗忘: operators in her range ASPD +
        const v = num(t1.attack_speed, 12);
        if (v) whileDeployed(battle, unit, AURA, () => {
          const ks = keySet(unit);
          for (const a of battle.allies(unit.ownerId)) if (a.kind === 'op' && a.alive && a.deployed && ks.has(a.tileR * COLS + a.tileC)) pulse(battle, a, `oblvns:t2:${unit.id}`, { aspd: v });
        });
      } },
    ],
    install(battle, unit) {
      if (S2) { unit.mem.tone = 'piano'; battle.addBuff(unit, { key: 'oblvns:tone', mods: toneMods('piano'), persist: true }); }
    },
  };
}

const KITS = {};
for (const tier of [5, 6]) {
  KITS[`chess_pick${tier}_char_4132_ascln_a`] = ascalon;
  KITS[`chess_pick${tier}_char_4072_ironmn_a`] = ironmn;
  KITS[`chess_pick${tier}_char_4037_demetr_a`] = bellone;
  KITS[`chess_pick${tier}_char_4182_oblvns_a`] = sakiko;
}
export default KITS;
