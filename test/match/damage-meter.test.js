// The per-round damage meter's data (battle/runner.js damageBoard, battle/meter.js meterRows; the panel is
// ui/damagePanel.js, its pure logic test/ui/damage-panel.test.js): a real client-combat battle run by the runner under
// Node — the board's numbers are the sim's unit.stats (rounded), per owner and field, live while the battle runs, kept
// after the round's battles are dropped until the next round's first battle is shown; reading it never changes the
// battle (the result digest of a battle read every tick equals the server's headless run); a summon's numbers go to
// its summoner's row (a real 麦哲伦 drone, and the pure folding rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { meterRows, rootOwner } from '../../public/js/battle/meter.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { validateC2S } from '../../shared/protocol.js';
import { validateClientResult, runHeadless } from '../../server/match/fields.js';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch } from './harness.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

const DS = new DataSource(DATA, null);

function fakeNet() {
  const handlers = new Map();
  const n = {
    sent: [],
    on(t, fn) { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t).add(fn); return () => handlers.get(t).delete(fn); },
    emit(t, msg) { for (const fn of handlers.get(t) || []) fn({ t, ...msg }); },
    send(t, fields) { const msg = { ...fields, t }; assert.equal(validateC2S(msg), null, `invalid ${t}`); n.sent.push(msg); return true; },
    request(t, fields) { const msg = { ...fields, t, rid: 1 }; assert.equal(validateC2S(msg), null, `invalid ${t}`); n.sent.push(msg); return Promise.resolve({ t: 'ok' }); },
  };
  return n;
}

function rig() {
  let t = 1000;
  const frames = [];
  const net = fakeNet();
  const store = createStore(initialState);
  const runner = createBattleRunner({
    net, store, doc: { hidden: false, addEventListener() {} },
    now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; },
    caf: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    loadSim: async () => ({ spec: specMod, ds: DS }),
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  return {
    runner, net, store,
    /** advance the clock by `ms` in frames of `step` ms; `each` runs after every frame */
    advance(ms, step = 1000 / 60, each = null) {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + step);
        const q = frames.splice(0);
        for (const fn of q) fn(t);
        if (each) each();
      }
    },
    async settle() { for (let i = 0; i < 50; i++) { await new Promise((res) => setImmediate(res)); const q = frames.splice(0); for (const fn of q) fn(t); } },
  };
}

/** A real b.start of round 2 (a board with operators) from a client-combat match. */
function realStart(seed = 7301) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans();
  h.m.start();
  h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 1);
  h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 2, { maxSteps: 3e6 });
  const msg = h.lastTo('p_0', 'b.start');
  h.m.dispose();
  return msg;
}

const START = realStart(7311);
const OWNER = START.spec.players[0].playerId;

/** The expected rows of an owner straight from the units (no summons fold for a token-free board: every op its own). */
function expectedOps(battle, ownerId) {
  return battle.allyUnits.filter((u) => u.kind === 'op' && u.ownerId === ownerId)
    .map((u) => ({ id: u.id, defId: u.defId, dmg: u.stats.dmg, taken: u.stats.taken, heal: u.stats.heal }));
}

test('damageBoard: the battle on screen, the owner\'s operators with the sim\'s unit.stats (rounded), live; field / owner filters', async () => {
  const r = rig();
  assert.equal(r.runner.damageBoard(OWNER), null, 'nothing before the first battle');
  r.net.emit('b.start', START);
  await r.settle();
  const e = r.runner._entries.get(START.battleId);
  r.advance(15000, 50);
  const b = r.runner.damageBoard(OWNER);
  assert.ok(b, 'a board');
  assert.deepEqual([b.battleId, b.fieldId, b.kind, b.round, b.live, b.done, b.own], [START.battleId, START.fieldId, START.kind, START.spec.round, true, false, true]);
  assert.equal(b.round, 2, 'round 2 of the match');
  assert.ok(b.ownerIds.includes(OWNER));
  const ops = expectedOps(e.battle, OWNER);
  assert.ok(ops.length > 0, 'the board has operators');
  for (const x of ops) {
    const row = b.units.find((u) => u.id === x.id);
    assert.ok(row, `row of ${x.defId}`);
    assert.equal(row.defId, x.defId);
    assert.equal(row.kind, 'op');
    assert.equal(row.ownerId, OWNER);
    assert.equal(typeof row.name, 'string');
    // a summon would add its numbers; the plain check holds for operators without one
    if (!row.summons.length) assert.deepEqual([row.dmg, row.taken, row.heal], [Math.round(x.dmg), Math.round(x.taken), Math.round(x.heal)], x.defId);
  }
  assert.ok(b.units.some((u) => u.dmg > 0), 'someone dealt damage 15 s in');
  assert.equal(b.totals.dmg, b.units.reduce((a, u) => a + u.dmg, 0));
  assert.equal(b.totals.taken, b.units.reduce((a, u) => a + u.taken, 0));
  assert.equal(b.totals.heal, b.units.reduce((a, u) => a + u.heal, 0));
  assert.equal(r.runner.damageBoard(OWNER, START.fieldId)?.battleId, START.battleId, 'on the named field');
  assert.equal(r.runner.damageBoard(OWNER, 'n:someone_else'), null, 'another field');
  assert.equal(r.runner.damageBoard('someone_else'), null, 'a player not in that battle');
  const all = r.runner.damageBoard();
  assert.ok(all.units.length >= b.units.length, 'every player without an owner');
  // live: the numbers follow the battle
  const before = b.totals.dmg;
  r.advance(10000, 50);
  assert.ok(r.runner.damageBoard(OWNER).totals.dmg >= before);
  r.runner.dispose();
});

test('damageBoard after the battle: done, then kept through the next prep (live false, the round it was) until the next round\'s first battle is shown', async () => {
  const r = rig();
  r.net.emit('b.start', START);
  await r.settle();
  const e = r.runner._entries.get(START.battleId);
  for (let i = 0; i < 400 && !e.done; i++) r.advance(1000, 50);
  assert.ok(e.done, 'finished');
  const end = r.runner.damageBoard(OWNER);
  assert.equal(end.done, true);
  assert.equal(end.live, true, 'still the battle on screen');
  // the next prep drops the battles (store phase → clear): the final numbers stay readable
  r.store.patch('match', { public: { phase: PHASE.PREP, round: 3 } });
  assert.equal(r.runner._entries.size, 0, 'the battles were dropped');
  assert.equal(r.runner.state(), null);
  const kept = r.runner.damageBoard(OWNER);
  assert.ok(kept, 'kept for the prep');
  assert.deepEqual([kept.live, kept.done, kept.round, kept.battleId], [false, true, 2, START.battleId]);
  assert.deepEqual(kept.units.map((u) => [u.id, u.dmg, u.taken, u.heal]), end.units.map((u) => [u.id, u.dmg, u.taken, u.heal]), 'the final numbers');
  assert.deepEqual(kept.totals, end.totals);
  assert.equal(r.runner.damageBoard(OWNER, START.fieldId)?.battleId, START.battleId, 'by its field too');
  assert.equal(r.runner.damageBoard(OWNER, 'n:someone_else'), null);
  assert.equal(r.runner.damageBoard('someone_else'), null, 'a player it does not hold');
  // a second phase change with nothing to drop keeps it
  r.store.patch('match', { public: { phase: PHASE.ROUND_START, round: 3 } });
  assert.equal(r.runner.damageBoard(OWNER)?.battleId, START.battleId);
  // the next round's battle: kept while it is being prepared, replaced once it is shown
  r.store.patch('match', { public: { phase: PHASE.COMBAT, round: 3 } });
  const next = { ...START, battleId: `${START.battleId}r3`, spec: { ...START.spec, round: 3 } };
  const p = r.runner.onStart(next);
  assert.equal(r.runner.damageBoard(OWNER)?.battleId, START.battleId, 'still the last round while the next one loads');
  await p;
  await r.settle();
  const fresh = r.runner.damageBoard(OWNER);
  assert.deepEqual([fresh.battleId, fresh.round, fresh.live], [next.battleId, 3, true]);
  r.runner.clear();
  assert.equal(r.runner.damageBoard(OWNER)?.battleId, next.battleId, 'the round-3 board is kept now');
  r.runner.dispose();
});

test('damageBoard never changes the battle: read every frame (and meterRows every tick) the result digest equals the server\'s headless run', async () => {
  const r = rig();
  r.net.emit('b.start', START);
  await r.settle();
  const e = r.runner._entries.get(START.battleId);
  // a trap on the lazy stat getter of every ally: the board must not read it (a recompute would move the sim's floats)
  let reads = 0;
  for (let i = 0; i < 400 && !e.done; i++) {
    r.advance(1000, 50, () => {
      const units = [...e.battle.allyUnits];
      const saved = units.map((u) => Object.getOwnPropertyDescriptor(u, 's'));
      for (const u of units) Object.defineProperty(u, 's', { configurable: true, get() { throw new Error('unit.s read by the meter'); } });
      try { r.runner.damageBoard(OWNER); r.runner.damageBoard(); reads++; } finally {
        units.forEach((u, k) => { if (saved[k]) Object.defineProperty(u, 's', saved[k]); else delete u.s; });
      }
    });
  }
  assert.ok(e.done && reads > 100, `finished, read ${reads} times`);
  await r.settle();
  const res = r.net.sent.filter((x) => x.t === 'b.result');
  assert.equal(res.length, 1);
  const server = runHeadless(specMod.createBattleFromSpec(START.spec, DS, { recordEvents: false }), { players: START.spec.players.map((p) => p.playerId) }).result;
  const a = validateClientResult(START.spec, res[0].result, {});
  const b = validateClientResult(START.spec, specMod.compactResult(server), {});
  assert.ok(a.ok && b.ok);
  assert.equal(specMod.resultDigest(a.result).hash, specMod.resultDigest(b.result).hash, 'the read battle equals the unread one');
  // the same with meterRows every single tick, against a plain run of the same spec
  const plain = specMod.createBattleFromSpec(START.spec, DS, { recordEvents: false });
  const read = specMod.createBattleFromSpec(START.spec, DS, { recordEvents: false });
  while (!plain.finished) plain.step();
  while (!read.finished) { read.step(); meterRows(read); meterRows(read, OWNER); }
  assert.equal(specMod.resultDigest(specMod.compactResult(read.result())).hash, specMod.resultDigest(specMod.compactResult(plain.result())).hash);
  // the per-unit numbers the result screen reads agree with the board's
  const rows = meterRows(read, OWNER);
  for (const u of read.allyUnits.filter((x) => x.kind === 'op' && x.ownerId === OWNER)) {
    const row = rows.units.find((x) => x.id === u.id);
    if (!row.summons.length) assert.equal(row.dmg, Math.round(u.stats.dmg));
  }
  r.runner.dispose();
});

// ---- summons ----------------------------------------------------------------------------------------------------------

const unit = (id, kind, ownerId, stats, extra = {}) => ({ id, kind, ownerId, defId: `${kind}_${id}`, name: `n${id}`, uid: id, stats: { dmg: 0, taken: 0, heal: 0, ...stats }, ...extra });

test('meterRows: a summon\'s numbers are folded into its root operator (nested tokens too), listed per kind under `summons`; an owner-less token and an active device keep their own row', () => {
  const op = unit(1, 'op', 'p1', { dmg: 100.4, taken: 50.2, heal: 10.6 });
  const tokA = unit(2, 'token', 'p1', { dmg: 20.3, taken: 5 }, { defId: 'token_a', ownerUnit: op });
  const tokA2 = unit(3, 'token', 'p1', { dmg: 9.9 }, { defId: 'token_a', ownerUnit: op });
  const nested = unit(4, 'token', 'p1', { dmg: 1.1, heal: 3 }, { defId: 'token_b', ownerUnit: tokA });
  const loose = unit(5, 'token', 'p1', { dmg: 7 }, { defId: 'token_loose' });
  const devIdle = unit(6, 'device', 'p1', {});
  const devHit = unit(7, 'device', 'p1', { taken: 30 });
  const other = unit(8, 'op', 'p2', { dmg: 999 });
  const otherTok = unit(9, 'token', 'p2', { dmg: 1 }, { ownerUnit: other });
  const battle = { allyUnits: [op, tokA, tokA2, nested, loose, devIdle, devHit, other, otherTok] };
  assert.equal(rootOwner(nested), op);
  assert.equal(rootOwner(loose), null);
  const b = meterRows(battle, 'p1');
  assert.deepEqual(b.units.map((u) => u.id), [1, 5, 7], 'the operator, the loose token, the device that was hit');
  const row = b.units[0];
  assert.deepEqual([row.dmg, row.taken, row.heal], [Math.round(100.4 + 20.3 + 9.9 + 1.1), Math.round(50.2 + 5), Math.round(10.6 + 3)]);
  assert.deepEqual(row.summons.map((s) => [s.defId, s.count, s.dmg]), [['token_a', 2, 30], ['token_b', 1, 1]]);
  assert.deepEqual(b.totals, { dmg: row.dmg + 7, taken: row.taken + 30, heal: row.heal });
  const all = meterRows(battle);
  assert.deepEqual(all.units.map((u) => u.id), [1, 5, 7, 8]);
  assert.equal(all.units[3].dmg, 1000, 'p2\'s summon folded into p2\'s operator');
  // nothing read is written
  assert.deepEqual(op.stats, { dmg: 100.4, taken: 50.2, heal: 10.6 });
  assert.deepEqual(meterRows(null), { units: [], totals: { dmg: 0, taken: 0, heal: 0 } });
});

test('meterRows on a real 召唤师: 麦哲伦\'s drone damage goes to her row (a 自选 pick: the row carries it), the drone listed under summons', () => {
  const SLOT = 'chess_char_5_diy1_a';
  const DRONE = 'token_10005_mgllan_drone2'; // 龙腾.L: strikes the enemies on its tile
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, mass: 0 }) } }, timeLimit: 900, autoFinish: false, seed: 5,
    flags: { dpPerSec: 0, dpMax: 999, dpInit: 99 },
    units: [{ uid: 1, diy: { slot: SLOT, charId: 'char_248_mgllan', skillIndex: 1, uniEquipId: null }, elite: false, row: 10, col: 3 },
      { uid: 10, kind: 'token', tokenId: DRONE, ownerUid: 1, row: 10, col: 6, dir: 'RIGHT' }],
  });
  h.step();
  const mg = h.unit(1);
  const drone = h.b.allyUnits.find((u) => u.kind === 'token' && u.defId === DRONE);
  assert.ok(mg && drone, 'her and her drone');
  assert.equal(rootOwner(drone), mg, 'the drone\'s owner is her');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.run(20);
  assert.ok(drone.stats.dmg > 0, 'the drone dealt damage');
  const b = meterRows(h.b, mg.ownerId);
  const row = b.units.find((u) => u.id === mg.id);
  assert.ok(row);
  assert.equal(b.units.some((u) => u.id === drone.id), false, 'no row of its own');
  assert.equal(row.dmg, Math.round(mg.stats.dmg + drone.stats.dmg));
  assert.deepEqual(row.summons.map((s) => [s.defId, s.count, s.dmg]), [[DRONE, 1, Math.round(drone.stats.dmg)]]);
  assert.equal(row.diy?.charId, 'char_248_mgllan', 'the 自选 pick (the panel composes her record)');
});
