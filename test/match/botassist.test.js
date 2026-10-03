// SP_BOT_ASSIST (Match BOT_ASSIST: extra coins, a luckier shop, late tier weight for AI teammates) and SP_BOT_PREFER_BOND
// (bots build one bond to its top threshold first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { Match, BOT_ASSIST, parseFlag } from '../../server/match/Match.js';
import { makeMatch, checkInvariants, give, chessOfTier, DATA } from './harness.js';

const coop = (o = {}) => makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, fake: true, ...o });

test('bot assist applies only to co-op 绝境 / 终极 matches with a human seat', () => {
  const on = (o) => { const h = makeMatch({ fake: true, botAssist: true, ...o }); const v = h.m.botAssist; h.m.dispose(); return v; };
  assert.equal(on({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3 }), BOT_ASSIST);
  assert.equal(on({ mode: 'coop', difficulty: 'HARD', humans: 3, bots: 1 }), BOT_ASSIST);
  assert.equal(on({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3 }), null);
  assert.equal(on({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 3 }), null);
  assert.equal(on({ mode: 'solo', difficulty: 'ABYSS' }), null);
  assert.equal(on({ mode: 'coop', difficulty: 'ABYSS', humans: 0, bots: 4 }), null, 'all-bot runs (tools) are left alone');
  const h = coop();
  assert.equal(h.m.botAssist, null, 'off by default');
  h.m.dispose();
  for (const v of ['1', 'on', 'TRUE', ' yes ']) assert.equal(parseFlag(v), true);
  for (const v of [undefined, '', '0', 'off', 'no']) assert.equal(parseFlag(v), false);
});

test('bot assist: AI teammates take the extra coins at every round start, humans and the result stats do not', () => {
  const funds = (o) => {
    const h = coop({ seed: 5, ...o }).start().toPrep(1);
    const out = [...h.m.players.values()].map((ps) => ({ id: ps.playerId, funds: ps.funds, gained: ps.stats.fundsGained }));
    h.m.dispose();
    return out;
  };
  const off = funds({});
  const on = funds({ botAssist: true });
  for (let i = 0; i < off.length; i++) {
    const bot = off[i].id.startsWith('ai_');
    assert.equal(on[i].funds, off[i].funds + (bot ? BOT_ASSIST.funds : 0), off[i].id);
    assert.equal(on[i].gained, off[i].gained, `${off[i].id}: not counted as gained funds`);
  }
});

test('bot assist: a lucky slot is a base the bot owns unmerged and no teammate holds a pair of', () => {
  const h = coop({ seed: 3, botAssist: true }).start().toPrep(1);
  const m = h.m;
  const bot = h.ps('ai_0');
  const human = h.ps('p_0');
  const [mine, theirs] = chessOfTier(1).filter((id) => m.pool.left(id) > 3);
  for (const p of bot.allChess()) bot.sell(p.uid);
  give(m, bot, mine, 'hand');
  give(m, bot, theirs, 'hand');
  give(m, human, theirs, 'hand');
  give(m, human, theirs, 'hand');
  m.rngBots = () => 0; // every slot lucky
  bot.rollShop();
  const chess = bot.shop.slots.filter((s) => s && s.kind === 'chess');
  assert.ok(chess.length > 0);
  for (const s of chess) assert.equal(m.gd.baseIdOf(s.id), mine, 'only the base the human is not merging');
  m.rngBots = () => 0.999; // never lucky
  assert.equal(bot._assistChessSlot(), null);
  // a human's shop never takes a lucky slot
  m.rngBots = () => 0;
  assert.equal(human._assistChessSlot(), null);
  checkInvariants(m);
  m.dispose();
});

test('bot assist: the shop rng stream is unchanged (the normal roll is drawn before a lucky one)', () => {
  const h = coop({ seed: 11, botAssist: true }).start().toPrep(1);
  const m = h.m;
  const bot = h.ps('ai_0');
  const base = chessOfTier(1).find((id) => m.pool.left(id) > 2);
  give(m, bot, base, 'hand');
  const draws = (luck) => {
    const shop = m.rngShop;
    let n = 0;
    m.rngShop = () => { n++; return shop(); };
    m.rngBots = () => luck;
    bot.rollShop();
    m.rngShop = shop;
    return n;
  };
  const always = draws(0);
  assert.ok(bot.shop.slots.some((s) => s && s.kind === 'chess' && m.gd.baseIdOf(s.id) === base), 'lucky slots came up');
  assert.equal(always, draws(0.999), 'as many shop rng draws with every slot lucky as with none');
  m.dispose();
});

test('bot assist + preferred bond: whole matches keep the engine invariants', () => {
  for (const seed of [1, 2]) {
    const h = coop({ seed, botAssist: true, botPreferBond: 'steadShip' });
    h.ps('p_0').autoplay = true;
    h.start();
    h.runToEnd();
    checkInvariants(h.m);
    h.m.dispose();
  }
});

test('preferred bond: bots field the top threshold of 坚守 far more often', () => {
  const rate = (prefer) => {
    let hit = 0;
    let n = 0;
    for (const seed of [1, 2, 3, 4]) {
      const h = coop({ seed, botPreferBond: prefer });
      h.ps('p_0').autoplay = true;
      h.start();
      for (let r = 6; r <= 9; r++) {
        h.runToPhase(PHASE.COMBAT, r);
        if (h.ended) break;
        for (const ps of h.m.players.values()) {
          if (!ps.isBot || !ps.alive) continue;
          const members = new Set([...ps.board.values()].filter((p) => p.kind === 'chess' && (h.m.gd.chess(p.id)?.bonds || []).includes('steadShip')).map((p) => h.m.gd.baseIdOf(p.id)));
          n++;
          if (members.size >= 3) hit++;
        }
      }
      h.m.dispose();
    }
    return hit / Math.max(1, n);
  };
  const off = rate('');
  const on = rate('steadShip');
  assert.ok(on > off + 0.2, `3 坚守 in ${(on * 100).toFixed(0)} % of bot boards with the preference vs ${(off * 100).toFixed(0)} % without`);
});

test('preferred bond: an unknown bond id is ignored', () => {
  const h = coop({ botPreferBond: 'noSuchBond' });
  assert.equal(h.m.botPreferBond, null);
  h.m.dispose();
  assert.ok(DATA.bonds.steadShip, 'the 坚守 bond the players asked for exists');
  assert.ok(Match);
});

test('SP_BONUS_FUNDS: the solo human takes the extra coins at every round start (named players only when listed)', () => {
  const funds = (o) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', fake: true, seed: 5, ...o }).start().toPrep(1);
    const ps = h.ps('p_0');
    const out = { funds: ps.funds, gained: ps.stats.fundsGained, bonus: h.m.bonusFunds };
    h.m.dispose();
    return out;
  };
  const off = funds({});
  assert.equal(off.bonus, 0);
  const on = funds({ bonusFunds: 3 });
  assert.equal(on.funds, off.funds + 3);
  assert.equal(on.gained, off.gained, 'not counted as gained funds');
  assert.equal(funds({ bonusFunds: 3, bonusFundsFor: 'P0, someone' }).funds, off.funds + 3, 'listed nickname');
  assert.equal(funds({ bonusFunds: 3, bonusFundsFor: 'someone' }).funds, off.funds, 'not listed');
  assert.equal(funds({ bonusFunds: 999 }).bonus, 50, 'capped');
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, fake: true, bonusFunds: 3 });
  assert.equal(h.m.bonusFunds, 0, 'solo only');
  h.m.dispose();
});

test('SP_BOSS_HP_MUL: the host multiplies every leader pool (per mode overrides); default the official pool', async () => {
  const { bossPoolHp } = await import('../../server/match/finalAssault.js');
  const pool = (o) => { const h = makeMatch({ fake: true, ...o }); const v = bossPoolHp(h.m.gd, 'boss_5', 4); h.m.dispose(); return v; };
  const soloBase = pool({ mode: 'solo', difficulty: 'ABYSS' });
  const coopBase = pool({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3 });
  assert.equal(soloBase, 750000, '卢西恩 终极 solo = bloodPoint × 0.25');
  assert.equal(coopBase, 3000000);
  assert.equal(pool({ mode: 'solo', difficulty: 'ABYSS', bossHpMul: 4 }), 4 * soloBase);
  assert.equal(pool({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, bossHpMul: 10 }), 10 * coopBase);
  const env = process.env;
  const saved = { a: env.SP_BOSS_HP_MUL, s: env.SP_BOSS_HP_MUL_SOLO, c: env.SP_BOSS_HP_MUL_COOP };
  try {
    env.SP_BOSS_HP_MUL = '2'; env.SP_BOSS_HP_MUL_SOLO = '4'; delete env.SP_BOSS_HP_MUL_COOP;
    assert.equal(pool({ mode: 'solo', difficulty: 'ABYSS', bossHpMul: undefined }), 4 * soloBase, 'the solo override');
    assert.equal(pool({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, bossHpMul: undefined }), 2 * coopBase, 'the shared value');
    env.SP_BOSS_HP_MUL = 'x';
    assert.equal(pool({ mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, bossHpMul: undefined }), coopBase, 'junk ⇒ official');
  } finally {
    for (const [k, v] of [['SP_BOSS_HP_MUL', saved.a], ['SP_BOSS_HP_MUL_SOLO', saved.s], ['SP_BOSS_HP_MUL_COOP', saved.c]]) { if (v == null) delete env[k]; else env[k] = v; }
  }
});
