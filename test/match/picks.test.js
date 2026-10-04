// 甄选干员 (DIY picks): the data (tools/build-data.mjs DIY_PICKS → `diyPick` chess), the shared check
// (shared/protocol.js checkPicks / room.loadout picks), the pool (server/match/pool.js pick entries: tier-gated, only in
// the rolls of the players who chose them) and the match (seats[].picks → PlayerState.picks → pool at the end of
// INFO_CHECK, Match.setLoadout picks during INFO_CHECK only, m.private `picks`). A pick on the board fights like any chess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { validateC2S, checkPicks, checkLoadout, PICK_LIMITS } from '../../shared/protocol.js';
import { SharedPool } from '../../server/match/pool.js';
import { createRng } from '../../server/sim/rng.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { DATA, makeMatch, checkInvariants, give, legalTileFor } from './harness.js';

const chess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const IRON5 = 'chess_pick5_char_4072_ironmn_a'; // 白铁 at V (an operator of the player's own)
const IRON6 = 'chess_pick6_char_4072_ironmn_a';
const ASC6 = 'chess_pick6_char_4132_ascln_a'; // 阿斯卡纶 at VI
const SHARP5 = 'chess_pick5_char_609_acguad_a'; // Sharp (原型干员)
const SHARP6 = 'chess_pick6_char_609_acguad_a';
const GUARD5 = 'chess_pick5_char_601_cguard_a'; // 预备干员-近卫 (V only)

function seats(picks, { humans = 1, bots = 0 } = {}) {
  const out = [];
  for (let i = 0; i < humans; i++) out.push({ seat: out.length, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true, picks: i === 0 ? picks : null });
  for (let i = 0; i < bots; i++) out.push({ seat: out.length, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true, picks });
  return out;
}

// ---- data ------------------------------------------------------------------------------------------------------------

test('data: every pick is a full chess at the official DIY slot status, hidden from the season pool', () => {
  const picks = Object.values(DATA.chess).filter((c) => c.diyPick);
  assert.equal(picks.length, 56);
  const slot = (tier, golden) => chess(`chess_char_${tier}_diy1_${golden ? 'b' : 'a'}`);
  for (const c of picks) {
    assert.ok(c.isDiy && !c.visible, `${c.chessId}: never a season chess`);
    assert.ok([5, 6].includes(c.tier));
    assert.deepEqual(c.status, slot(c.tier, c.isGolden).status, `${c.chessId}: DIY slot status`);
    assert.equal(c.price, slot(c.tier, c.isGolden).price);
    assert.ok(c.stats && c.skill && c.skills.length >= 1, `${c.chessId}: stats and skills`);
    assert.deepEqual(c.garrisonIds, [], `${c.chessId}: no 驻场`);
    assert.equal(c.skill.index, c.skills.at(-1).index, `${c.chessId}: the last skill is the default`);
    assert.ok(!DATA.visibleChess?.includes?.(c.chessId));
  }
  assert.deepEqual(chess(IRON5).bonds, ['victoriaShip'], '白铁: 维多利亚');
  assert.deepEqual(chess(ASC6).bonds, ['emptyShip'], '阿斯卡纶: no core faction ⇒ 协防干员');
  assert.deepEqual(chess(SHARP5).bonds, ['emptyShip'], '原型干员: no faction');
  assert.equal(chess(IRON5).diyPick, 'own');
  assert.equal(chess(SHARP5).diyPick, 'prototype');
  assert.equal(chess('chess_pick6_char_601_cguard_a'), null, '预备干员 only at V');
  assert.equal(chess('chess_pick5_char_600_cpione_a'), null, 'no 先锋 预备干员');
  // VI elites carry the module at level 3, V at level 1 (the official slots)
  assert.equal(chess(chess(IRON6).goldenId).status.equipLevel, 3);
  assert.equal(chess(chess(IRON5).goldenId).status.equipLevel, 1);
  // 白铁 carries his three devices; 战地工程师 deploys two of them
  assert.deepEqual(chess(IRON6).tokens, ['token_10027_ironmn_pile1', 'token_10027_ironmn_pile2', 'token_10027_ironmn_pile3']);
  assert.equal(DATA.tokens.token_10027_ironmn_pile3.deployLimit, 2);
});

// ---- shared check ----------------------------------------------------------------------------------------------------

test('checkPicks: ≤2 per tier, no id twice, an own operator once, a 原型干员 at V and VI; only normal pick ids', () => {
  const ok = (p) => checkPicks(p, chess);
  assert.deepEqual(ok([ASC6, IRON5]), { ok: true, picks: [IRON5, ASC6] }, 'sorted by tier');
  assert.deepEqual(ok(undefined), { ok: true, picks: [] });
  assert.deepEqual(ok([]), { ok: true, picks: [] });
  assert.ok(ok([SHARP5, SHARP6, GUARD5, ASC6]).ok, 'a 原型干员 fills a V and a VI slot');
  assert.equal(ok([IRON5, IRON6]).error, 'BAD_TARGET', 'an own operator fills one slot');
  assert.equal(ok([SHARP5, SHARP5]).error, 'BAD_TARGET', 'the same pick twice');
  assert.equal(ok([IRON5, SHARP5, GUARD5]).error, 'BAD_TARGET', 'three at V');
  assert.equal(ok([chess(IRON5).goldenId]).error, 'BAD_TARGET', 'an elite id');
  assert.equal(ok(['chess_char_6_01_a']).error, 'BAD_TARGET', 'a season chess');
  assert.equal(ok(['chess_char_6_diy1_a']).error, 'BAD_TARGET', 'the bare official slot');
  assert.equal(ok([1]).error, 'BAD_MSG');
  assert.equal(ok(new Array(PICK_LIMITS.perTier * 2 + 1).fill(SHARP5)).error, 'BAD_MSG', 'too many');
  // room.loadout: picks are optional
  assert.equal(validateC2S({ t: 'room.loadout', entries: {} }), null);
  assert.equal(validateC2S({ t: 'room.loadout', entries: {}, picks: [IRON5] }), null);
  assert.equal(validateC2S({ t: 'room.loadout', entries: {}, picks: 'x' }), 'bad field picks');
  // a pick's skill and module are chosen like any operator's
  const lo = checkLoadout({ [IRON6]: { skill: 0, module: 'none' } }, chess);
  assert.ok(lo.ok, JSON.stringify(lo));
  assert.deepEqual(lo.loadout[IRON6], { skill: 0, module: 'none' });
});

// ---- pool ------------------------------------------------------------------------------------------------------------

test('pool: a pick entry joins only the rolls of the players who chose it, and only from its tier on', () => {
  const gm = makeMatch({ mode: 'solo' }).m;
  const pool = new SharedPool(gm.gd, { picks: [ASC6] });
  gm.dispose();
  assert.ok(pool.has(ASC6));
  assert.equal(pool.cap(ASC6), 5, 'the tier-6 copies');
  const rng = createRng(7);
  const rolls = (opts, n = 4000) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(pool.roll(rng, opts)); return s; };
  assert.ok(!rolls({ maxTier: 6 }).has(ASC6), 'nobody else rolls it');
  assert.ok(!rolls({ maxTier: 5, picks: [ASC6] }).has(ASC6), 'not below 调度中心 VI');
  assert.ok(rolls({ maxTier: 6, picks: [ASC6] }).has(ASC6), 'its chooser at VI');
  assert.ok(!rolls({ tier: 6, filter: (id) => id !== ASC6, picks: [ASC6] }).has(ASC6), 'filters still apply');
  // the shares grow by the pick's copies only for its chooser
  const a = pool.tierShares(6), b = pool.tierShares(6, [ASC6]);
  assert.ok(b[6] > a[6]);
  pool.addPicks([ASC6, 'chess_char_6_01_a', chess(IRON5).goldenId]);
  assert.equal(pool.cap(ASC6), 5, 'adding twice keeps one entry');
  assert.ok(!pool.has(chess(IRON5).goldenId), 'elite ids are ignored');
});

// ---- match -----------------------------------------------------------------------------------------------------------

test('match: seat picks reach the pool when INFO_CHECK ends; the chooser rolls them at VI, a teammate and the AI never', () => {
  const h = makeMatch({ mode: 'coop', seats: seats([ASC6, IRON5], { humans: 2, bots: 1 }), seed: 3 }).start();
  const m = h.m;
  const ps = h.ps('p_0'), mate = h.ps('p_1'), bot = h.ps('ai_0');
  assert.deepEqual(ps.picks, [IRON5, ASC6]);
  assert.ok(Object.isFrozen(ps.picks));
  assert.deepEqual(mate.picks, []);
  assert.deepEqual(bot.picks, [], 'bots never pick (their seat picks are ignored)');
  assert.ok(!m.pool.has(ASC6), 'not before the loadout locks');
  h.flushAll();
  assert.deepEqual(h.lastTo('p_0', 'm.private').picks, [IRON5, ASC6]);
  h.toPrep(1);
  assert.ok(m.pool.has(ASC6) && m.pool.has(IRON5));
  for (const p of [ps, mate, bot]) p.shop.level = 6;
  const seen = new Map([[ps, new Set()], [mate, new Set()], [bot, new Set()]]);
  for (let i = 0; i < 400; i++) for (const p of seen.keys()) { const s = p._rollChessSlot(); if (s) seen.get(p).add(s.id); }
  assert.ok(seen.get(ps).has(ASC6) && seen.get(ps).has(IRON5), 'the chooser rolls both');
  for (const p of [mate, bot]) assert.ok(!seen.get(p).has(ASC6) && !seen.get(p).has(IRON5), `${p.playerId} never`);
  // buying and selling a pick keeps the copy books
  for (const p of [ps, mate, bot]) p.shop.level = 1;
  ps.funds = 50;
  ps.shop.slots[0] = { kind: 'chess', id: ASC6, basePrice: m.gd.chessPrice(ASC6), frozen: false, sold: false };
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.equal(m.pool.left(ASC6), 4);
  checkInvariants(m);
  const piece = [...ps.hand, ...ps.temp].find((p) => p && p.id === ASC6);
  assert.ok(piece, 'bought');
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: piece.uid }), { ok: true });
  assert.equal(m.pool.left(ASC6), 5);
  checkInvariants(m);
  m.dispose();
});

test('Match.setLoadout carries picks during INFO_CHECK only; illegal picks are refused', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 5 }).start();
  const m = h.m;
  const ps = h.ps('p_0');
  assert.deepEqual(m.setLoadout('p_0', {}, [SHARP5, SHARP6]), { ok: true });
  assert.deepEqual(ps.picks, [SHARP5, SHARP6]);
  assert.equal(m.setLoadout('p_0', {}, [IRON5, IRON6]).error, ERR.BAD_TARGET);
  assert.deepEqual(ps.picks, [SHARP5, SHARP6], 'unchanged after a refusal');
  assert.deepEqual(m.setLoadout('p_0', {}), { ok: true });
  assert.deepEqual(ps.picks, [SHARP5, SHARP6], 'absent picks keep the stored ones');
  for (const id of ['p_0', 'p_1']) m.handle(id, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
  assert.ok(m.pool.has(SHARP5) && m.pool.has(SHARP6));
  assert.equal(m.setLoadout('p_0', {}, []).error, ERR.WRONG_PHASE, 'locked after INFO_CHECK');
  m.dispose();
});

test('an illegal seat pick list (stale data) is dropped with a warning', () => {
  const h = makeMatch({ mode: 'solo', seats: seats([IRON5, IRON6]), seed: 2 });
  assert.deepEqual(h.ps('p_0').picks, []);
  assert.ok(h.logs.warn.some((w) => /picks/.test(w)));
  h.m.dispose();
});

test('白铁 on the board sends two devices of his skill to the hand (S3: 铁钳号, S1: the ATK platform)', () => {
  for (const [skill, token] of [[null, 'token_10027_ironmn_pile3'], [0, 'token_10027_ironmn_pile1']]) {
    const loadout = skill == null ? null : checkLoadout({ [IRON6]: { skill } }, chess).loadout;
    const h = makeMatch({ mode: 'solo', seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout }], seed: 6 }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    for (const p of [...ps.board.values()]) ps.returnCopies(p);
    ps.board.clear();
    ps.hand.fill(null);
    ps.recompute();
    const iron = give(h.m, ps, IRON6);
    const at = legalTileFor(h.m, ps, IRON6);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: iron.uid, to: { area: 'board', row: at[0], col: at[1] } }), { ok: true });
    const stacks = ps.hand.filter((p) => p && p.kind === 'token');
    assert.deepEqual(stacks.map((p) => [p.id, p.count]), [[token, 2]], `skill ${skill}: the devices of that skill, two (战地工程师)`);
    checkInvariants(h.m);
    h.m.dispose();
  }
});

// ---- battle ----------------------------------------------------------------------------------------------------------

test('battle: every pick deploys and fights (normal and elite)', () => {
  const ids = Object.values(DATA.chess).filter((c) => c.diyPick).map((c) => c.chessId);
  for (const id of ids) {
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], autoFinish: false, timeLimit: 3 });
    h.step();
    const u = h.unit(id);
    assert.ok(u && u.alive && u.deployed, `${id} is on the field`);
    h.run(2);
    assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), [], id);
  }
});
