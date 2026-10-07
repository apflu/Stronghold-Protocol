// server/match/hostOptions.js — the host's own match knobs: a private instance's house rules, each off by default (the
// official game) and read from the Match option, else from its environment variable (README「房主选项」). Match's
// constructor calls applyHostOptions before the seats are made (PlayerState reads m.boost / m.bonusFunds) and before
// the per-match setup (waves.js reads gd.excludedFactions).
//
//   opts.factionExclude 'enemyKey,…' (env SP_FACTION_EXCLUDE): special-enemy entries (factions.json `entries`, the
//                      SPECIAL key with its attached normal / elite) a round never draws — the host's ban of a wave
//                      group its players find unfair (→ gd.excludedFactions; waves.js pickRoundEntry draws another entry)
//   opts.botAssist     boolean (env SP_BOT_ASSIST=1|on): quiet help for AI teammates — see BOT_ASSIST; only co-op matches
//                      with ≥ 1 human seat on BOT_ASSIST_DIFFICULTIES (m.botAssist = the parameters, or null)
//   opts.botPreferBond bond id (env SP_BOT_PREFER_BOND): every AI seat builds this bond to its top threshold first
//                      (bot.js; an unknown id is ignored — m.botPreferBond = the id, or null)
//   opts.botHelpLast   boolean (env SP_BOT_HELP_LAST=1): 联防 helpers are humans first, AI seats only for a slot left
//                      (unite.js helperOrder — the helpers collect the kill bounties of the leaks they beat)
//   opts.botPreferBand band id (env SP_BOT_PREFER_BAND, e.g. band_amiya): an AI seat takes it in the strategy draft
//                      whenever it is still free (bot.js botPickBand; AI 托管 seats keep the plain pick)
//   opts.bountyCoins   'effectId=coins,…' (env SP_BOUNTY_COINS): the host's reward for bounty cards (→ gd.bountyCoins;
//                      choices.js bountyCoinOf: the draft card and its text, and every bounty added — addBounty)
//   opts.bossHpMul     leader pool multiplier of both boss rounds (env SP_BOSS_HP_MUL; SP_BOSS_HP_MUL_SOLO / _COOP
//                      override it per mode; 0.1–100, default 1 = the official pool) → gd.hostBossHpMul, applied on top
//                      of the official pool (GameData.bossPoolShare: bloodPoint × the players alive at the fight start)
//   opts.bonusFunds    extra coins per round start for the human of a solo match (env SP_BONUS_FUNDS, 0–50, default 0)
//   opts.bonusFundsFor nicknames that get them (env SP_BONUS_FUNDS_FOR, comma-separated; empty = every player)
//                      — a host's practice aid; m.bonusFunds = the coins for this match's human, or 0
//   opts.uniteRoundMap boolean (env SP_UNITE_ROUND_MAP=1): the 联防 field is the round's own stage — its water, crates and
//                      devices — as up to 0.1.4, not the escaped template's flat map (GitHub #41 → 0.2.0; players
//                      reported the tournament footage of #244 showing 联防 on the round's map) — m.uniteRoundMap
//   opts.boost         the 轮回之终末 numbers (env SP_BOOST, parseBoost; the lobby passes its own): the seats that ticked
//                      the room's box (seats[].boost → PlayerState.boost) take BOOST_DEFAULT.funds extra coins per round
//                      start, and the last prep's end eliminates one without a bond at 999 (match/prep.js
//                      _boostReckoning) — m.boost, or null
// The extra coins (assist, bonus, box) stay outside stats.fundsGained (the result screen).

import { createRng, deriveSeed } from '../sim/rng.js';
import { parseBountyCoins } from './choices.js';

/**
 * SP_BOT_ASSIST (co-op 绝境 / 终极 with humans): parameters of the quiet help for AI teammates, nothing a teammate sees
 * directly (no LP, HP or stats) — bots take `funds` extra coins at every round start (PlayerState.startRound), the
 * first chess slot of each shop roll is, with probability `shopLuck`, drawn among the bases the bot owns but has not
 * merged that no other alive player holds a pair of (PlayerState._assistChessSlot, on the bots' rng stream), and from
 * round `lateTierFrom` the bot weighs operator power × `lateTier` (bot.js lateTierMul). Measured with tools/matchrun-style
 * runs (同盟 终极, 3 stronger seats + 1 AI, 60 seeds; then with the lucky draw on every slot): the AI reaches the Final
 * Assault 19/60 instead of 2/60, leaks per late round 14.6 → 7.3, the other seats' elites unchanged.
 */
export const BOT_ASSIST = Object.freeze({ funds: 2, shopLuck: 0.4, lateTierFrom: 8, lateTier: 1.5 });
export const BOT_ASSIST_DIFFICULTIES = Object.freeze(['HARD', 'ABYSS']);
/** SP_BOOST (the per-player 轮回之终末 box of the room, seats[].boost): its numbers (PlayerState). */
export const BOOST_DEFAULT = Object.freeze({ funds: 4, shopLuck: 0.4 });

/** SP_BOOST → null (off) | { funds, shopLuck }: "1" / "on" = BOOST_DEFAULT, "<funds>,<luck>" (e.g. "4,0.4") = custom. */
export function parseBoost(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s || ['0', 'off', 'false', 'no'].includes(s)) return null;
  if (['1', 'on', 'true', 'yes'].includes(s)) return BOOST_DEFAULT;
  const [f, l] = s.split(',').map((x) => Number(x.trim()));
  const funds = Number.isFinite(f) ? Math.min(50, Math.max(0, Math.trunc(f))) : BOOST_DEFAULT.funds;
  const shopLuck = Number.isFinite(l) ? Math.min(1, Math.max(0, l)) : BOOST_DEFAULT.shopLuck;
  return Object.freeze({ funds, shopLuck });
}

/** '1' / 'on' / 'true' / 'yes' (any case) → true. */
export const parseFlag = (v) => ['1', 'on', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());
/** 'a, b,c' (or an array) → Set of non-empty trimmed ids. */
export const parseKeyList = (v) => new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean));
/** A leader pool multiplier → 0.1–100, or null for a missing / junk / non-positive value. */
const mulOf = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n > 0 ? Math.min(100, Math.max(0.1, n)) : null; };

/**
 * Set the host's knobs on a match under construction (m.gd, m.isSolo, m.difficulty and m.seed are set; no seat yet).
 * @param {import('./Match.js').Match} m
 * @param {object} opts the Match options
 * @param {(k: string) => string|undefined} env
 */
export function applyHostOptions(m, opts, env) {
  const gd = m.gd;
  gd.excludedFactions = parseKeyList(opts.factionExclude ?? env('SP_FACTION_EXCLUDE'));
  const seats = opts.seats.filter(Boolean);
  const assist = opts.botAssist != null ? !!opts.botAssist : parseFlag(env('SP_BOT_ASSIST'));
  /** BOT_ASSIST parameters when the quiet help for AI teammates applies to this match, else null */
  m.botAssist = assist && !m.isSolo && BOT_ASSIST_DIFFICULTIES.includes(String(m.difficulty).toUpperCase()) && seats.some((s) => !s.isBot) ? BOT_ASSIST : null;
  const prefer = String(opts.botPreferBond ?? env('SP_BOT_PREFER_BOND') ?? '').trim();
  /** bond every AI seat builds to its top threshold first (bot.js), or null */
  m.botPreferBond = prefer && gd.bond(prefer) ? prefer : null;
  /** SP_BOT_HELP_LAST: humans before AI seats among the 联防 helpers */
  m.botHelpLast = opts.botHelpLast != null ? !!opts.botHelpLast : parseFlag(env('SP_BOT_HELP_LAST'));
  const preferBand = String(opts.botPreferBand ?? env('SP_BOT_PREFER_BAND') ?? '').trim();
  /** SP_BOT_PREFER_BAND: the strategy an AI seat takes when it is still free, or null */
  m.botPreferBand = preferBand && gd.band(preferBand) && gd.bandAllowed(preferBand) ? preferBand : null;
  /** SP_BOSS_HP_MUL*: the host's leader pool multiplier for this match (1 = official) */
  m.bossHpMul = mulOf(opts.bossHpMul) ?? mulOf(env(m.isSolo ? 'SP_BOSS_HP_MUL_SOLO' : 'SP_BOSS_HP_MUL_COOP')) ?? mulOf(env('SP_BOSS_HP_MUL')) ?? 1;
  gd.hostBossHpMul = m.bossHpMul;
  /** SP_BOUNTY_COINS: effect id → coins (choices.js bountyCoinOf) */
  gd.bountyCoins = parseBountyCoins(opts.bountyCoins ?? env('SP_BOUNTY_COINS'));
  const bonus = Math.trunc(Number(opts.bonusFunds ?? env('SP_BONUS_FUNDS') ?? 0));
  const bonusFor = String(opts.bonusFundsFor ?? env('SP_BONUS_FUNDS_FOR') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const human = seats.find((s) => !s.isBot);
  /** SP_BONUS_FUNDS: extra coins per round start for the solo human (PlayerState.startRound), or 0 */
  m.bonusFunds = m.isSolo && human && Number.isFinite(bonus) && bonus > 0 && (!bonusFor.length || bonusFor.includes(String(human.name ?? '').trim()))
    ? Math.min(bonus, 50) : 0;
  /** SP_UNITE_ROUND_MAP: 联防 on the round's stage instead of the escaped template's map (match/unitePhase.js) */
  m.uniteRoundMap = opts.uniteRoundMap != null ? !!opts.uniteRoundMap : parseFlag(env('SP_UNITE_ROUND_MAP'));
  /** SP_BOOST: the 轮回之终末 numbers for the seats that ticked the box (seats[].boost → PlayerState.boost), or null */
  m.boost = opts.boost !== undefined
    ? (opts.boost && typeof opts.boost === 'object' ? Object.freeze({ ...BOOST_DEFAULT, ...opts.boost }) : parseBoost(opts.boost))
    : parseBoost(env('SP_BOOST'));
  // the box's own rng stream: every other stream draws the same with or without it
  m.rngBoost = createRng(deriveSeed(m.seed, 'boost'));
}
