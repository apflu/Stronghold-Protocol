// server/match/eventlog.js — the host's event log (env SP_LOG_DIR, off by default): one JSON object per line in
// <dir>/events-YYYY-MM-DD.jsonl (UTC day), written through an append stream (never blocks a callback). Read it with
// tools/logs.mjs (online / history rooms, players, one match's timeline).
//
// What is recorded (each line: { t: ISO time, type, … }; match lines also carry room, match, seed, round, phase):
//   lobby      room.create / join / leave / start / end / dispose with the seats (names, bots) and the client address;
//              a 'rooms' snapshot of every live room every ROOMS_EVERY_MS
//   match      match.start (mode, difficulty, stage, boss, hidden boss, factions, seats, loadouts), phase changes,
//              a board snapshot of every player when a prep ends (board tiles / directions / items, hand, temp, funds,
//              shop level, LP, bonds with layers), bands and 机变 picks, autoplay / leave / reconnect, match.end
//   actions    every player action as PlayerState applies it — humans, AI 托管 and bots alike: buy / sell / refresh /
//              freeze / levelUp / move / equip / art / destroy / reward / ready — with what it touched and the outcome
//   sources    every funds / layers change with its reason (the meta source key: garrison:… / item:… / band:… / bond:…)
//              and every transformation (突变细胞 …)
//   battles    each field's full BattleSpec when it is created (enough to re-simulate it: sim/spec.js
//              createBattleFromSpec), per-player settle results (kills, leaks by enemy, layer gains, damage, coins, LP),
//              client-result rejections / takeovers (the match's warnings), boss pool credits at most once per second
//              per field, and the Final Assault / Hidden Core end
//   errors     the match's engine errors
//
// instrumentMatch(m) wraps the match's methods (and its players' action methods) on the instance — nothing changes
// when the log is off, and a logging failure never reaches the game.

import fs from 'node:fs';
import path from 'node:path';

const ROOMS_EVERY_MS = 5 * 60 * 1000;
/** Boss pool credits: at most one line per field per this many ms. */
const BOSS_EVERY_MS = 1000;

class EventLog {
  constructor() {
    this.dir = null;
    this.day = null;
    this.stream = null;
    this.errors = 0;
  }

  get enabled() { return this.dir != null; }

  /** Start writing into `dir` (created when missing). Returns false when it cannot be used. */
  open(dir) {
    if (!dir) return false;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      return false;
    }
    this.dir = dir;
    return true;
  }

  write(obj) {
    if (!this.dir) return;
    try {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (day !== this.day || !this.stream) {
        if (this.stream) this.stream.end();
        this.day = day;
        this.stream = fs.createWriteStream(path.join(this.dir, `events-${day}.jsonl`), { flags: 'a' });
        this.stream.on('error', () => { this.errors++; });
      }
      this.stream.write(JSON.stringify({ t: now.toISOString(), ...obj }) + '\n');
    } catch {
      this.errors++;
    }
  }

  close() {
    if (this.stream) this.stream.end();
    this.stream = null;
    this.dir = null;
  }
}

/** The process-wide log (server/index.js opens it from SP_LOG_DIR). */
export const eventLog = new EventLog();

/** Never let logging break the game. */
const safe = (fn) => { try { fn(); } catch { eventLog.errors++; } };

// ---------------------------------------------------------------------------------------------------------------------
// lobby

/** A lobby event: `room` = the lobby room record (code, mode, difficulty, seats, …). */
export function logRoom(type, room, extra = {}) {
  if (!eventLog.enabled || !room) return;
  safe(() => eventLog.write({ type, room: room.code, mode: room.mode, difficulty: room.difficulty, seats: seatsOf(room), ...extra }));
}

function seatsOf(room) {
  return (Array.isArray(room.seats) ? room.seats : []).map((s) => (s ? { seat: s.seat, pid: s.playerId, player: s.name, bot: !!s.isBot } : null));
}

/** Snapshot of every live room every ROOMS_EVERY_MS (`rooms()` returns the lobby's room records). */
export function startRoomSnapshots(rooms) {
  if (!eventLog.enabled) return null;
  const timer = setInterval(() => safe(() => {
    const list = [...rooms()].map((r) => ({
      room: r.code, mode: r.mode, difficulty: r.difficulty, inMatch: !!r.match, phase: r.match ? r.match.phase : null,
      round: r.match ? r.match.round : null, seats: seatsOf(r),
    }));
    eventLog.write({ type: 'rooms', count: list.length, rooms: list });
  }), ROOMS_EVERY_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

// ---------------------------------------------------------------------------------------------------------------------
// match

const pieceOf = (m, p) => (p ? { uid: p.uid, id: p.id, name: p.kind === 'item' ? m.gd.item(p.id)?.name : p.kind === 'token' ? m.gd.token(p.id)?.name : m.gd.chess(p.id)?.name } : null);

function boardOf(m, ps) {
  const board = [];
  for (const [k, p] of ps.board) {
    if (!p) continue;
    board.push({ tile: k, dir: p.dir ?? null, ...pieceOf(m, p), items: (p.items || []).map((it) => it.id) });
  }
  return board;
}

function snapshotOf(m, ps) {
  const bonds = {};
  for (const [id, b] of Object.entries(ps.bonds || {})) if (b && (b.count > 0 || b.layers > 0)) bonds[id] = { n: b.count, tier: b.tier, layers: b.layers };
  return {
    pid: ps.playerId, player: ps.name, bot: !!ps.isBot, autoplay: !!ps.autoplay, alive: !!ps.alive, lp: ps.lp, funds: ps.funds,
    level: ps.shop?.level, band: ps.bandId, board: boardOf(m, ps),
    hand: ps.hand.filter(Boolean).map((p) => ({ ...pieceOf(m, p), items: (p.items || []).map((it) => it.id) })),
    temp: ps.temp.filter(Boolean).map((p) => pieceOf(m, p)), bonds,
  };
}

/** Where a piece is (area + tile / index), for the action lines. */
function where(ps, uid) {
  const loc = ps.find(uid);
  return loc ? (loc.area === 'board' ? `board:${loc.key}` : `${loc.area}:${loc.idx ?? ''}`) : null;
}

const okOf = (r) => (r && typeof r === 'object' && r.error ? { ok: false, error: r.error, detail: r.detail } : { ok: true });

/**
 * Wrap the match and its players for the event log (no-op when the log is off). Call once the players exist.
 * @param {import('./Match.js').Match} m
 */
export function instrumentMatch(m) {
  if (!eventLog.enabled) return;
  const base = () => ({ room: m.roomCode, match: m.opts?.matchNo ?? null, seed: m.seed, round: m.round, phase: m.phase });
  const ev = (type, data) => safe(() => eventLog.write({ type, ...base(), ...data }));
  m.eventLog = ev;

  // phase changes (+ a board snapshot of every player when a prep ends)
  let phase = m.phase;
  Object.defineProperty(m, 'phase', {
    configurable: true,
    enumerable: true,
    get: () => phase,
    set: (v) => {
      const prev = phase;
      phase = v;
      if (prev === v) return;
      ev('phase', { from: prev, to: v });
      if (prev === 'PREP') for (const ps of m.order || []) if (ps.alive) ev('board', snapshotOf(m, ps));
    },
  });

  // warnings (client-result rejections, takeovers, bot rehearsal failures …) and engine errors
  const log = m.log || {};
  m.log = {
    ...log,
    warn: (...a) => { ev('warn', { msg: a.map(String).join(' ') }); if (typeof log.warn === 'function') log.warn(...a); },
  };
  wrap(m, 'reportError', (orig, label, e) => { ev('error', { label, message: e && e.message, stack: e && String(e.stack || '').split('\n').slice(0, 4).join(' | ') }); return orig(label, e); });

  // bands, 机变 picks, autoplay, presence
  // (the _apply* methods: humans' picks, bots' picks and timeouts all end there)
  wrap(m, '_applyBand', (orig, ps, bandId, opts) => { const r = orig(ps, bandId, opts); ev('band', { pid: ps.playerId, player: ps.name, bot: !!ps.isBot, bandId, got: ps.bandId }); return r; });
  wrap(m, '_applyCard', (orig, ps, idx) => { const card = m.sp?.cards?.[idx] ?? null; const r = orig(ps, idx); ev('card', { pid: ps.playerId, player: ps.name, bot: !!ps.isBot, idx, card }); return r; });
  wrap(m, 'setAutoplay', (orig, ps, on) => { const r = orig(ps, on); ev('autoplay', { pid: ps.playerId, player: ps.name, on, ...okOf(r) }); return r; });
  for (const k of ['onDisconnect', 'onReconnect', 'onLeave']) wrap(m, k, (orig, pid, ...rest) => { ev(k, { pid, player: m.players.get(pid)?.name }); return orig(pid, ...rest); });

  // battles: every client-combat field's spec (enough to re-simulate it), settle results, boss credits, boss ends
  wrap(m, '_ccField', (orig, a) => { const f = orig(a); ev('field', { fieldId: f.fieldId, kind: f.kind, battleId: f.battleId, players: f.players, spec: f.spec }); return f; });
  wrap(m, 'settle', (orig, plan, unite) => {
    const r = orig(plan, unite);
    for (const ps of m.order || []) {
      const x = m.lastResults?.get(ps.playerId);
      if (!x) continue;
      const leaks = {};
      for (const l of x.leaked || []) if (l && l.counted !== false) leaks[l.enemyKey] = (leaks[l.enemyKey] || 0) + 1;
      ev('result', {
        pid: ps.playerId, player: ps.name, bot: !!ps.isBot, killed: x.killed, total: x.total, leaks, perfect: !!x.perfect,
        layerGains: x.layerGains || {}, damage: Math.round(Number(x.damageDealt) || 0), coins: x.coins || 0, lp: ps.lp, alive: !!ps.alive,
        unite: !!(plan && plan.leakers), synthetic: !!x.synthetic,
      });
    }
    return r;
  });
  const lastBoss = new Map();
  wrap(m, '_creditBoss', (orig, f, cum, by) => {
    const r = orig(f, cum, by);
    const now = Date.now();
    if (now - (lastBoss.get(f.fieldId) || 0) >= BOSS_EVERY_MS) {
      lastBoss.set(f.fieldId, now);
      ev('boss', { fieldId: f.fieldId, acked: Math.round(f.bossAcked || 0), by: f.bossBy || by || {}, poolHp: m.bossPool ? Math.round(m.bossPool.hp) : null, poolMax: m.bossPool ? m.bossPool.maxHp : null, fieldMs: f.startAt != null ? m.sched.now() - f.startAt : null });
    }
    return r;
  });
  wrap(m, '_endFinal', (orig, reason) => { ev('final', { reason, poolHp: m.bossPool ? Math.round(m.bossPool.hp) : null, poolMax: m.bossPool?.maxHp ?? null, teamLp: m.teamLp ?? null }); return orig(reason); });

  for (const ps of m.players.values()) instrumentPlayer(m, ps, ev);
}

/** Replace `obj[name]` by `fn(orig, …args)` (orig bound to obj). */
function wrap(obj, name, fn) {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  const bound = orig.bind(obj);
  obj[name] = (...a) => fn(bound, ...a);
}

/** Wrap one player's action methods (PlayerState) — every caller (humans' intents, AI 托管, bots, effects) goes through them. */
function instrumentPlayer(m, ps, ev) {
  const who = () => ({ pid: ps.playerId, player: ps.name, bot: !!ps.isBot, autoplay: !!ps.autoplay });
  const act = (action, data) => ev('act', { action, ...who(), ...data });
  wrap(ps, 'buy', (orig, slot) => {
    const s = ps.shop?.slots?.[slot];
    const price = s && typeof ps.priceOf === 'function' ? ps.priceOf(s) : null;
    const r = orig(slot);
    act('buy', { slot, kind: s?.kind, id: s?.id, name: s ? (s.kind === 'item' ? m.gd.item(s.id)?.name : m.gd.chess(s.id)?.name) : null, price, funds: ps.funds, ...okOf(r) });
    return r;
  });
  wrap(ps, 'refresh', (orig) => { const r = orig(); act('refresh', { funds: ps.funds, shop: (ps.shop?.slots || []).map((s) => s && s.id), ...okOf(r) }); return r; });
  wrap(ps, 'freeze', (orig) => { const r = orig(); act('freeze', { frozen: !!ps.shop?.frozen, ...okOf(r) }); return r; });
  wrap(ps, 'levelUp', (orig) => { const r = orig(); act('levelUp', { level: ps.shop?.level, funds: ps.funds, ...okOf(r) }); return r; });
  wrap(ps, 'sell', (orig, uid) => { const p = ps.find(uid)?.piece; const from = where(ps, uid); const r = orig(uid); act('sell', { ...pieceOf(m, p), from, funds: ps.funds, ...okOf(r) }); return r; });
  wrap(ps, 'move', (orig, uid, to, dir) => { const p = ps.find(uid)?.piece; const from = where(ps, uid); const r = orig(uid, to, dir); act('move', { ...pieceOf(m, p), from, to: where(ps, uid) ?? to, dir: dir ?? null, ...okOf(r) }); return r; });
  wrap(ps, 'equip', (orig, itemUid, targetUid, replaceUid = null) => {
    const it = ps.find(itemUid)?.piece;
    const tg = ps.find(targetUid)?.piece;
    const r = orig(itemUid, targetUid, replaceUid);
    act('equip', { item: pieceOf(m, it), target: pieceOf(m, tg), at: where(ps, targetUid), replaceUid, ...okOf(r) });
    return r;
  });
  wrap(ps, 'useArt', (orig, itemUid, row, col, dir) => { const it = ps.find(itemUid)?.piece; const r = orig(itemUid, row, col, dir); act('art', { item: pieceOf(m, it), row, col, dir: dir ?? null, ...okOf(r) }); return r; });
  wrap(ps, 'destroy', (orig, uid) => { const p = ps.find(uid)?.piece; const r = orig(uid); act('destroy', { ...pieceOf(m, p), ...okOf(r) }); return r; });
  wrap(ps, 'pickReward', (orig, idx) => { const offer = ps.offers?.[0]; const s = offer?.slots?.[idx]; const r = orig(idx); act('reward', { idx, source: offer?.source ?? null, kind: s?.kind, id: s?.id, ...okOf(r) }); return r; });
  wrap(ps, 'setReady', (orig, on) => { const r = orig(on); if (on) act('ready', { funds: ps.funds, ...okOf(r) }); return r; });
  // sources: funds / layers changes with their reason, transformations
  wrap(ps, 'addFunds', (orig, n, opts = {}) => { const before = ps.funds; const r = orig(n, opts); if (ps.funds !== before) ev('funds', { ...who(), n: ps.funds - before, funds: ps.funds, reason: opts?.reason || '', source: opts?.logSource ?? null }); return r; });
  wrap(ps, 'addLayers', (orig, bondId, n, opts = {}) => {
    const before = ps.layers?.[bondId] || 0;
    const r = orig(bondId, n, opts);
    const after = ps.layers?.[bondId] || 0;
    if (after !== before) ev('layers', { ...who(), bondId, n: after - before, layers: after, reason: opts?.reason || '', source: opts?.logSource ?? null });
    return r;
  });
  wrap(ps, 'transformChess', (orig, piece, newId) => { const from = pieceOf(m, piece); const r = orig(piece, newId); ev('transform', { ...who(), from, to: { id: newId, name: m.gd.chess(newId)?.name } }); return r; });
}

/** match.start / match.end lines (Match.start / the end summary). */
export function logMatchStart(m) {
  if (!m.eventLog) return;
  m.eventLog('match.start', {
    mode: m.mode, difficulty: m.difficulty, modeId: m.modeId, stageId: m.stageId, bossId: m.bossId, hiddenBossId: m.hiddenBossId ?? null,
    factions: m.factions ?? null, botAssist: !!m.botAssist, botPreferBond: m.botPreferBond, bonusFunds: m.bonusFunds || 0,
    seats: [...m.players.values()].map((ps) => ({ seat: ps.seat, pid: ps.playerId, player: ps.name, bot: !!ps.isBot, loadout: ps.loadout ?? null })),
  });
}

export function logMatchEnd(m, summary) {
  if (!m.eventLog) return;
  m.eventLog('match.end', {
    victory: summary?.victory ?? null, reason: summary?.reason ?? null, roundsPassed: summary?.roundsPassed ?? null,
    hiddenCleared: summary?.hiddenCleared ?? null, teamLp: summary?.teamLp ?? null, durationMs: summary?.durationMs ?? null,
    players: (summary?.players || []).map((p) => ({ pid: p.playerId, player: p.name, bot: !!p.isBot, alive: p.alive, lp: p.lp, band: p.bandId, stats: p.stats, title: p.title ?? null })),
  });
  for (const ps of m.order || []) m.eventLog('board', { final: true, ...snapshotOf(m, ps) });
}
