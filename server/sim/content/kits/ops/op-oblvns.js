// server/sim/content/kits/ops/op-oblvns.js — 丰川祥子 (char_4182_oblvns) 自选 operator kit: 6★ 领主 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots on the wjx instance only (a collab operator upstream leaves out: tools/build-data.mjs
// DIY_INCLUDED_COLLAB, owner's decision 2026-10-07); every skill, both talents, the trait and her module (LOR-Y “无言的约定”)
// at every form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Ported from the wjx kit of deploy-2026-10-03 (server/sim/content/kits/picks.js `sakiko`) to the upstream 0.2.0 contract.
// Forms (data/backups.json units.char_4182_oblvns): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// LOR-Y at stage 1 (tier 5) or 3 (tier 6). Potential 0 [ASSUMED: no account]. Sources: character_table / skill_table /
// battle_equip_table (zh_CN, as built into backups.json). She is the only Ave Mujica member of the remake, so "Ave Mujica
// 成员" is she herself, and 毋畏遗忘's "其他Ave Mujica成员的攻击范围…视作攻击范围的延伸" never applies.
// - Trait (领主) "可以进行远程攻击，但此时攻击力降低至80%": the lord profile (professions.js: ×atk_scale unless the target stands
//   on her tile / the tile in front or she blocks it), range 3-12, hits air units, blocks 2. LOR-Y adds "攻击范围内存在2名
//   及以上敌人时攻击速度+12" (trait attack_speed; the count from the module text, else CROWD_CNT): ASPD + while that many
//   targetable enemies stand on her current range.
// - T1 颂乐音符 "可以持续攻击且攻击会演奏追踪敌人的音符，音符飘出攻击范围一段时间后消失。每存在一个音符，Ave Mujica成员无视敌人
//   N%的防御力和M%法术抗性（最多叠加至max_cnt层）" (bb def_penetrate_ratio / magic_resist_penetrate_ratio / max_cnt / delay):
//   every damage instance of hers is a note (her attack hits, S1's and S3's notes, the Fever double hits); a note exists
//   from its hit until `delay` s + NOTE_HOLD s later [ASSUMED: no free-flying / homing model — the note is taken to leave
//   her range NOTE_HOLD s after its hit, then fade in `delay` s]; each of her hits counts the live notes, its own included
//   (≤ max_cnt), and ignores n × N of the DEF and n × M of the RES (defIgnorePct / resIgnorePct). 持续攻击 without a
//   target is not modelled (the old kit's simplification). LOR-Y stage 2+ (the tier-6 elite: stage 3) changes the
//   numbers (5 % / 2.5 %, 12 layers) and adds "技能期间远程攻击不再降低攻击力" — read from the composed talent text: S3's
//   attack profile drops the lord's ×0.8 (`attack.dmgMul` 1, as 棘刺 S3 / 领主·Sharp S1 — the old kit divided dmg.mul
//   instead, and lifted it at every form). At stage 1 the talent is unchanged (no talent part in phase 1). S1 / S2 are
//   instant: "技能期间" never holds an attack of theirs.
// - T2 毋畏遗忘 "对敌人造成伤害时使Fever+cnt；…；攻击范围内干员攻击速度+N" (bb cnt / attack_speed / enable): every damage
//   instance of hers on an enemy that lands (`damaged`: a dodged note deals no damage — the old kit counted dodges too)
//   adds cnt to her Fever gauge; the operators standing on her current range (herself included) get ASPD +N (an aura, the
//   strongest 丰川祥子 holds — installAura).
// - Fever (the collab's 术语; FEVER_MAX / FEVER_TIME are the old kit's numbers [ASSUMED: not in the cached tables]): the
//   gauge fills to FEVER_MAX; a skill cast that finds it full empties it and starts Fever for FEVER_TIME s:
//   S1 "8 notes on every attack" (the old kit's reading [ASSUMED]: her S1 text names no Fever effect), S2 the current
//   tone's 二连击, S3 the 不撤退 below.
// - S1 新月的苏醒 (MANUAL, 2 charges, data DEFAULT) "演奏出8个音符。每个音符造成的法术伤害依次从攻击力的atk_scale逐渐降低至
//   atk_scale_8": eight arts notes, ATK × atk_scale … atk_scale_8, on the targetable enemies of her range nearest first,
//   round-robin [ASSUMED: the 15° fan and the homing are not modelled]; skill damage, not attacks (no ×0.8).
//   "充能至最大层数时自动释放一次" changes nothing here: every skill auto-casts on its trigger.
// - S2 满月的舞会 (MANUAL, data DEFAULT) "可以切换钢琴（初始）或风琴音色演奏": piano (initial, again at every deployment) ATK
//   +attack@atk, physical notes; organ ASPD +attack@attack_speed, "音符造成法术伤害" — her attack hits turn arts. Each cast
//   switches the tone [ASSUMED: no manual switch], but the cast that starts Fever only starts it (the old kit's PRTS
//   reading). "命中目标后穿过敌人" (piano piercing) and the note speeds are not modelled [ASSUMED]. Fever: every attack hits
//   twice in the current tone (`hitsFn`).
// - S3 残月的余响 (MANUAL, 25 s, data ACTIVE_RANGE on its 3-21) "攻击范围扩大，攻击同时使用钢琴和风琴音色演奏，各自演奏2个造成相当
//   于攻击力attack@atk_scale物理和法术伤害的音符，且分别追踪法术抗性和防御力最高的敌人": range 3-21; every attack = two physical
//   hits at attack@atk_scale on the highest-RES targetable enemy of the range (the attack's target) and two arts notes at
//   attack@atk_scale on the highest-DEF one (skill damage after the attack lands, under the same lord ×0.8 as the attack
//   unless LOR-Y stage 2+ lifts it [ASSUMED: the arts notes belong to the attack]). "Fever期间Ave Mujica成员受到致命伤害时不撤退，
//   Fever结束后退场": with S3 picked, a fatal hit during Fever leaves her at 1 HP; when Fever ends she leaves the field as a
//   knock-out (a forced exit with the death animation, as 史尔特尔's 余烬). S3 outlasts Fever (25 s ≥ 20 s), so no extension.

import { num, talentBb, traitBb, skillRec, up, enemiesInGrid, installAura, toggleBuff } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_oblvns_1';
const S2 = 'skchr_oblvns_2';
const S3 = 'skchr_oblvns_3';
/** 颂乐音符: how long a note stays in her range after its hit before its `delay` s fade starts [ASSUMED]. */
export const NOTE_HOLD = 0.5;
/** Fever gauge size and Fever length (s) [ASSUMED: the old wjx kit's numbers]. */
export const FEVER_MAX = 450;
export const FEVER_TIME = 20;
/** LOR-Y "攻击范围内存在2名及以上敌人" when the text cannot be read. */
const CROWD_CNT = 2;
/** S3's fallback range 3-21 when a record carries none. */
const R3_21 = Object.freeze([[2, 0], [2, 1], [1, 0], [1, 1], [1, 2], [1, 3], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3], [-2, 0], [-2, 1]]);
const TONE_KEY = 'skill:oblvns:tone';
const NOTE_TAG = 'oblvns:note';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const kindOf = (rec) => (num(rec?.maxChargeTime, 1) > 1 ? 'charges' : 'instant');
const feverOn = (battle, unit) => (unit.mem.oblvnsFeverUntil ?? -Infinity) > battle.time;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export default {
  char_4182_oblvns: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const t0Rec = (chess?.talents ?? []).find((t) => t && t.index === 0);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const grid3 = skillRec(chess, S3)?.rangeGrid ?? R3_21;
    const selected = chess?.skill?.skillId ?? null;

    const defPen = num(t0.def_penetrate_ratio), resPen = num(t0.magic_resist_penetrate_ratio);
    const noteCap = Math.max(1, Math.floor(num(t0.max_cnt, 10)));
    const noteLife = num(t0.delay, 1) + NOTE_HOLD;
    // LOR-Y stage 2+: "技能期间远程攻击不再降低攻击力"
    const liftRanged = /远程攻击不再降低攻击力/.test(String(t0Rec?.desc ?? ''));
    const feverCnt = num(t1.cnt);
    const auraAspd = num(t1.enable, 1) ? num(t1.attack_speed) : 0;
    const crowdAspd = num(tb.attack_speed);
    const crowdCnt = num(+(/存在(\d+)名及以上敌人/.exec(String(chess?.trait?.moduleDesc ?? ''))?.[1]), CROWD_CNT) || CROWD_CNT;
    const s1Scales = ['atk_scale', 'atk_scale_2', 'atk_scale_3', 'atk_scale_4', 'atk_scale_5', 'atk_scale_6', 'atk_scale_7', 'atk_scale_8']
      .map((k) => num(b1[k])).filter((v) => v > 0);
    const s3Scale = num(b3['attack@atk_scale'], 1);

    /** The lord's ranged ×atk_scale on target `e` (1 when LOR-Y stage 2+ lifts it during a skill). */
    const lordMul = (battle, unit, e) => {
      if (liftRanged && unit.skill?.active) return 1;
      const f = unit.profile?.dmgMul;
      const m = typeof f === 'function' ? f(battle, unit, e) : 1;
      return Number.isFinite(m) ? m : 1;
    };
    /** One note of skill damage (S1, S3's organ notes). */
    const note = (battle, unit, e, amount, type) => {
      if (e && e.alive) battle.dealDamage(unit, e, { amount, type, isSkill: true, tags: ['skill', NOTE_TAG] });
    };
    /** S1: eight arts notes, the enemies of her range nearest first, round-robin. */
    const burst = (battle, unit) => {
      const foes = enemiesInGrid(battle, unit, null).sort((a, b) => dist(a, unit) - dist(b, unit) || a.id - b.id);
      if (!foes.length) return;
      battle.fx('splash', { x: foes[0].x, y: foes[0].y, id: foes[0].id });
      s1Scales.forEach((sc, i) => note(battle, unit, foes[i % foes.length], unit.s.atk * sc * unit.s.atkScaleMul, 'arts'));
    };
    const toneMods = (tone) => (tone === 'organ' ? { aspd: num(b2['attack@attack_speed']) } : { atkPct: num(b2['attack@atk']) });
    const setTone = (battle, unit, tone) => {
      unit.mem.oblvnsTone = tone;
      battle.addBuff(unit, { key: TONE_KEY, mods: toneMods(tone), persist: true, allowDead: true, tags: ['skill'], visible: true });
    };

    const kit = {
      skills: {
        [S1]: {
          kind: kindOf(skillRec(chess, S1)),
          onStart({ battle, unit }) { burst(battle, unit); },
        },
        [S2]: {
          kind: kindOf(skillRec(chess, S2)),
          onStart({ battle, unit }) {
            if (num(unit.mem.oblvnsFever) >= FEVER_MAX) return;   // the cast that starts Fever only starts it
            setTone(battle, unit, unit.mem.oblvnsTone === 'organ' ? 'piano' : 'organ');
          },
        },
        [S3]: {
          kind: 'duration',
          targeting: { rangeGrid: grid3 },
          attack: {
            atkScale: s3Scale,
            hits: 2,
            ...(liftRanged ? { dmgMul: () => 1 } : {}),   // LOR-Y stage 2+: 远程攻击不再降低攻击力
            onHit({ battle, unit }) {                      // the organ's two arts notes on the highest-DEF enemy
              const e = enemiesInGrid(battle, unit, null).sort((a, b) => num(b.s.def) - num(a.s.def) || a.id - b.id)[0];
              if (!e) return;
              const amount = unit.s.atk * s3Scale * unit.s.atkScaleMul * lordMul(battle, unit, e);
              for (let i = 0; i < 2; i++) note(battle, unit, e, amount, 'arts');
            },
          },
          onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
        },
      },
      talents: [
        { install(battle, unit) { // 颂乐音符: every damage instance of hers is a note; the live notes ignore DEF / RES
          unit.mem.oblvnsNotes = [];
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.oblvnsNotes = []; }, { owner: unit });
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.target || c.target.side !== 'enemy' || !c.dmg) return;
            if (c.dmg.type !== 'phys' && c.dmg.type !== 'arts') return;
            const now = battle.time;
            const live = unit.mem.oblvnsNotes.filter((t) => t > now);
            live.push(now + noteLife);
            unit.mem.oblvnsNotes = live;
            const n = Math.min(noteCap, live.length);
            c.dmg.defIgnorePct += n * defPen;
            c.dmg.resIgnorePct += n * resPen;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 毋畏遗忘: Fever +cnt per damage dealt to an enemy; ASPD + for the operators of her range
          unit.mem.oblvnsFever = 0;
          if (feverCnt > 0) {
            battle.on('damaged', (c) => {
              if (c.source !== unit || !c.target || c.target.side !== 'enemy' || c.type === 'element') return;
              unit.mem.oblvnsFever = Math.min(FEVER_MAX, num(unit.mem.oblvnsFever) + feverCnt);
            }, { owner: unit });
          }
          if (auraAspd) {
            installAura(battle, unit, {
              key: 'talent:oblvns:aspd', value: auraAspd, mods: { aspd: auraAspd },
              select: (a) => a.kind === 'op' && a.alive && a.deployed && (unit.rangeKeySet || new Set(unit.rangeKeys || [])).has(a.tileR * COLS + a.tileC),
            });
          }
        } },
      ],
      install(battle, unit) {
        // Fever: a cast with a full gauge empties it and starts FEVER_TIME s of Fever
        battle.on('skillStart', (c) => {
          if (c.unit !== unit || num(unit.mem.oblvnsFever) < FEVER_MAX) return;
          unit.mem.oblvnsFever = 0;
          unit.mem.oblvnsFeverUntil = battle.time + FEVER_TIME;
          battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id });
          const seq = unit.deploySeq;
          battle.after(FEVER_TIME, () => {
            if (!unit.mem.oblvnsDoomed) return;
            unit.mem.oblvnsDoomed = false;
            if (unit.alive && unit.deployed && unit.deploySeq === seq) battle.retreat(unit, { reason: 'retreat', dying: true });
          }, { owner: unit });
        }, { owner: unit, priority: 10 });
        // LOR-Y trait: ASPD + while `crowdCnt` enemies stand on her range
        if (crowdAspd) toggleBuff(battle, unit, 'trait:oblvns:crowd', () => enemiesInGrid(battle, unit, null).length >= crowdCnt, { aspd: crowdAspd });

        if (selected === S1) { // Fever: every attack plays the eight notes
          battle.on('attack', (c) => { if (c.attacker === unit && up(unit) && feverOn(battle, unit)) burst(battle, unit); }, { owner: unit });
        }
        if (selected === S2) { // piano at every deployment; organ notes deal arts damage
          setTone(battle, unit, 'piano');
          battle.on('deploy', (c) => { if (c.unit === unit) setTone(battle, unit, 'piano'); }, { owner: unit });
          battle.on('hit', (c) => {
            if (c.source === unit && c.dmg?.isAttack && unit.mem.oblvnsTone === 'organ' && c.dmg.type === 'phys') c.dmg.type = 'arts';
          }, { owner: unit, priority: 10 });
        }
        if (selected === S3) {
          // the piano notes (the attack) go to the highest-RES enemy of her range
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || unit.skill?.id !== S3 || !unit.skill.active) return;
            const e = enemiesInGrid(battle, unit, null).sort((a, b) => num(b.s.res) - num(a.s.res) || a.id - b.id)[0];
            if (e) c.targets = [e];
          }, { owner: unit });
          // Fever: no retreat on a fatal hit; she leaves when Fever ends
          battle.on('fatal', (c) => {
            if (c.unit !== unit || !feverOn(battle, unit)) return;
            c.prevented = true;
            unit.mem.oblvnsDoomed = true;
          }, { owner: unit, priority: 10 });
        }
      },
    };
    // S2 Fever: the current tone's 二连击
    if (selected === S2) kit.trait = { hitsFn: (battle, unit) => (feverOn(battle, unit) ? 2 : 1) };
    return kit;
  },
};
