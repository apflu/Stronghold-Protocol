// The host's knobs (server/match/hostOptions.js): SP_BOT_ASSIST (BOT_ASSIST: extra coins, a luckier shop, late tier
// weight for AI teammates), SP_BOT_PREFER_BOND (bots build one bond to its top threshold first), SP_BONUS_FUNDS,
// SP_BOSS_HP_MUL*, SP_BOT_HELP_LAST, SP_BOT_PREFER_BAND, SP_BOUNTY_COINS and the 轮回之终末 box (SP_BOOST).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { Match, BOT_ASSIST, BOOST_DEFAULT, parseBoost, parseFlag } from '../../server/match/Match.js';
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
  m.rngBots = () => 0; // the lucky slot always comes up
  bot.rollShop();
  const chess = bot.shop.slots.filter((s) => s && s.kind === 'chess');
  assert.ok(chess.length > 1);
  assert.equal(m.gd.baseIdOf(chess[0].id), mine, 'the first slot: only the base the human is not merging');
  for (let k = 0; k < 5; k++) assert.equal(bot._assistChessSlot() && m.gd.baseIdOf(bot._assistChessSlot().id), mine);
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
  // the official pool since 0.2.0: bloodPoint × the players alive at the fight start (solo × 1)
  assert.equal(soloBase, 3000000, '卢西恩 终极 solo = bloodPoint');
  assert.equal(coopBase, 12000000, '4 alive = bloodPoint × 4');
  const h3 = makeMatch({ fake: true, mode: 'coop', difficulty: 'ABYSS', humans: 1, bots: 3, bossHpMul: 2 });
  assert.equal(bossPoolHp(h3.m.gd, 'boss_5', 3), 2 * 9000000, 'the multiplier applies to the alive-scaled pool');
  h3.m.dispose();
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

test('SP_BOT_HELP_LAST: humans before AI seats among the 联防 helpers (AI only for a slot left)', async () => {
  const { helperOrder } = await import('../../server/match/unite.js');
  const seats = [
    { seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true },
    { seat: 1, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
    { seat: 2, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
  ];
  const order = (o) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, fake: true, ...o });
    const perfects = [...h.m.players.values()];
    const ids = helperOrder(h.m, perfects, new Map()).map((p) => p.playerId);
    h.m.dispose();
    return ids;
  };
  assert.ok(order({}).includes('ai_0'), 'without it the seat order may pick the AI');
  assert.deepEqual(order({ botHelpLast: true }).sort(), ['p_0', 'p_1'], 'two humans fill both slots');
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, fake: true, botHelpLast: true });
  const ai = h.m.players.get('ai_0');
  assert.deepEqual(helperOrder(h.m, [ai, h.m.players.get('p_0')], new Map()).map((p) => p.playerId), ['p_0', 'ai_0'], 'the AI still helps when a slot is left — behind the human (the first helper meets the enemies first)');
  h.m.dispose();
});

test('SP_BOT_PREFER_BAND: an AI seat takes the strategy while it is free; 阿米娅 makes a bot build wide', async () => {
  const { botPickBand } = await import('../../server/match/bot.js');
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, fake: true, botPreferBand: 'band_amiya' });
  const m = h.m;
  const bot = m.players.get('ai_0');
  const human = m.players.get('p_0');
  assert.equal(botPickBand(m, bot), 'band_amiya');
  const draws = new Set(Array.from({ length: 30 }, () => botPickBand(m, human)));
  assert.ok(draws.size > 1, 'AI 托管 on a human seat keeps the plain weighted pick');
  const taken = m.bandTaken;
  m.bandTaken = (id) => id === 'band_amiya';
  assert.notEqual(botPickBand(m, bot), 'band_amiya', 'a teammate took it: the plain pick');
  m.bandTaken = taken;
  assert.equal(makeMatch({ fake: true, botPreferBand: 'no_such_band' }).m.botPreferBand, null);
  m.dispose();
});

test('SP_BOUNTY_COINS: the host reward for a bounty card — on the draft card, its text and every bounty added', async () => {
  const { bountyCard } = await import('../../server/match/choices.js');
  const raw = DATA.choices.cards.bounty.find((c) => c.effectId === 'enemyeffect_b_1'); // 碎骨·悬赏, officially 1
  assert.equal(raw.coin, 1);
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', fake: true, bountyCoins: 'enemyeffect_b_1=3' });
  const m = h.m;
  const card = bountyCard(m.gd, raw);
  assert.equal(card.coin, 3);
  assert.match(card.desc, /获得3资金/);
  assert.match(card.descRaw, /获得<@ba\.vup>3<\/>资金/);
  const ps = h.ps('p_0');
  m.addBounty(ps, card);
  m.addBounty(ps, { ...raw, effectId: 'enemyeffect_b_1', desc: raw.desc }); // the official text (神秘顾客 / 教鞭 path)
  assert.deepEqual(ps.bounties.map((b) => b.card.coin), [3, 3]);
  assert.ok(ps.bounties.every((b) => /获得3资金/.test(b.card.desc)));
  const off = makeMatch({ mode: 'solo', difficulty: 'HARD', fake: true });
  assert.equal(bountyCard(off.m.gd, raw).coin, 1, 'default: the official reward');
  off.m.dispose();
  m.dispose();
});

test('SP_BOOST parsing: on = 4 coins and a 40% lucky first slot; "<funds>,<luck>" custom; off = null', () => {
  assert.equal(parseBoost(''), null);
  assert.equal(parseBoost('0'), null);
  assert.deepEqual(parseBoost('1'), BOOST_DEFAULT);
  assert.deepEqual({ ...BOOST_DEFAULT }, { funds: 4, shopLuck: 0.4 });
  assert.deepEqual(parseBoost('6,0.25'), { funds: 6, shopLuck: 0.25 });
  assert.deepEqual(parseBoost('999,7'), { funds: 50, shopLuck: 1 });
});

test('轮回之终末 box: only the seats that ticked it get the coins (outside stats) and a lucky slot', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, bots: 0, fake: true, boost: '1', boostSeats: ['p_0'] }).start().toPrep(1);
  const m = h.m;
  const [on, off] = [h.ps('p_0'), h.ps('p_1')];
  assert.ok(on.boost && !off.boost);
  assert.equal(on.funds - off.funds, 4, 'four more coins at the round start');
  assert.equal(on.stats.fundsGained, off.stats.fundsGained, 'not in the result stats');
  const [mine, theirs] = chessOfTier(1).filter((id) => m.pool.left(id) > 3);
  for (const p of on.allChess()) on.sell(p.uid);
  give(m, on, mine, 'hand');
  give(m, on, theirs, 'hand');
  give(m, off, theirs, 'hand');
  give(m, off, theirs, 'hand');
  m.rngBoost = () => 0;
  on.rollShop();
  const chess = on.shop.slots.filter((s) => s && s.kind === 'chess');
  assert.equal(m.gd.baseIdOf(chess[0].id), mine, 'the lucky slot (rng 0: the first): an own unmerged operator nobody else holds a pair of');
  assert.equal(off._boostChessSlot(), null, 'no box, no lucky slot');
  m.rngBoost = () => 0.999;
  assert.equal(on._boostChessSlot(), null);
  checkInvariants(m);
  m.dispose();
  const plain = makeMatch({ mode: 'coop', humans: 1, fake: true, boost: null, boostSeats: ['p_0'] });
  assert.equal(plain.ps('p_0').boost, null, 'SP_BOOST off: the box does nothing');
  plain.m.dispose();
});

test('轮回之终末 box: the lucky slot is a random rerolled chess slot, not always the first; a frozen slot kept is never it', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, bots: 0, fake: true, boost: '1', boostSeats: ['p_0'] }).start().toPrep(1);
  const m = h.m;
  const on = h.ps('p_0');
  const [mine] = chessOfTier(1).filter((id) => m.pool.left(id) > 3);
  for (const p of on.allChess()) on.sell(p.uid);
  give(m, on, mine, 'hand');
  /** the box's rng: the slot pick, then the luck check (0 < shopLuck), then 0 for the draw itself */
  const seq = (...v) => { const q = [...v]; m.rngBoost = () => (q.length ? q.shift() : 0); };
  const n = on.shop.slots.filter((s) => s && s.kind === 'chess').length;
  assert.ok(n >= 3);
  const seen = new Set();
  for (const r of [0, 0.5, 0.99]) {
    seq(r, 0);
    on.rollShop();
    const at = Math.floor(r * n);
    const chess = on.shop.slots.slice(0, n);
    assert.equal(m.gd.baseIdOf(chess[at].id), mine, `rng ${r}: the lucky draw is slot ${at}`);
    seen.add(at);
  }
  assert.ok(seen.size >= 3, 'different positions');
  // every slot but the last frozen and kept: the lucky slot can only be the one rerolled
  seq(0, 0);
  on.shop.slots.forEach((s, i) => { if (s && i < n - 1) s.frozen = true; });
  const before = on.shop.slots.slice(0, n - 1).map((s) => s.id);
  on.rollShop({ keepFrozen: true });
  assert.deepEqual(on.shop.slots.slice(0, n - 1).map((s) => s.id), before, 'the frozen slots kept');
  assert.equal(m.gd.baseIdOf(on.shop.slots[n - 1].id), mine, 'the lucky draw on the rerolled slot');
  checkInvariants(m);
  m.dispose();
});

test('轮回之终末: at the end of the last prep a boxed seat with no bond at 999 is eliminated; 999 or no box survives', () => {
  for (const capped of [false, true]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, bots: 0, fake: true, boost: '1', boostSeats: ['p_0', 'p_1'] }).autoHumans();
    h.start().toPrep(h.m.gd.bossRound);
    const m = h.m;
    const [a, b, c] = ['p_0', 'p_1', 'p_2'].map((id) => h.ps(id));
    for (const ps of [a, b, c]) assert.ok(ps.alive, `${ps.playerId} reached the last prep`);
    a.layers = { ...a.layers, siracusaShip: capped ? 999 : 998 };
    b.layers = { ...b.layers, siracusaShip: 999 };
    a.recompute(); b.recompute();
    m.endPrep();
    assert.equal(a.alive, capped, capped ? 'a bond at 999: survives' : '998 is not enough');
    assert.ok(b.alive, 'a bond at 999');
    assert.ok(c.alive, 'no box, no reckoning');
    if (!capped) assert.equal(a.eliminatedRound, m.gd.bossRound);
    checkInvariants(m);
    m.dispose();
  }
});

test('轮回之终末: a solo boxed player without 999 ends the run before the Final Assault', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, fake: true, boost: '1', boostSeats: ['p_0'] }).autoHumans();
  h.start().toPrep(h.m.gd.bossRound);
  h.m.endPrep();
  assert.equal(h.ps('p_0').alive, false);
  assert.ok(h.ended, 'the match ended');
  h.m.dispose();
});
