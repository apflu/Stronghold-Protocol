// tools/logs.mjs — read the host's event log (SP_LOG_DIR, server/match/eventlog.js).
//
// Usage:
//   node tools/logs.mjs [rooms]                 rooms live right now (the latest 5-min snapshot + what happened since)
//   node tools/logs.mjs history [--days N]      every room: creator, players (+ address), matches and how they ended
//   node tools/logs.mjs players [--days N]      every nickname: addresses, first / last seen, rooms, matches
//   node tools/logs.mjs match <ROOM> [N]        one match (the room's last, or its match #N): per round each player's
//                                               board at the end of the prep, the battle results (leaks, layer gains,
//                                               damage), the boss pool and the end; --acts adds every action
//   options: --dir <path> (default $SP_LOG_DIR, else ./logs), --days N (default 7), --json
// Times are shown in the host's local time zone. The raw lines are plain JSON: jq / grep work too.

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--dir', '--days'].includes(argv[i - 1])));
const cmd = pos[0] || 'rooms';
const dir = opt('--dir', process.env.SP_LOG_DIR || path.resolve('logs'));
const days = Number(opt('--days', 7));
const json = has('--json');

function readEvents(maxDays = days) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch {
    console.error(`no event log in ${dir} (set SP_LOG_DIR or --dir)`);
    process.exit(1);
  }
  const out = [];
  for (const f of files.slice(-Math.max(1, maxDays))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* a torn last line */ }
    }
  }
  return out;
}

// names from the game data next to this tool (optional)
const dataDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const loadJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch { return {}; } };
const ENEMIES = loadJson('enemies.json');
const BONDS = loadJson('bonds.json');
const CHESS = loadJson('chess.json');
const enemyName = (k) => ENEMIES[k]?.name || k;
const bondName = (k) => BONDS[k]?.name || k.replace(/Ship$/, '');
const chessName = (k) => CHESS[k]?.name || k;

const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-');
const hm = (t) => (t ? new Date(t).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5) : '-');
const seatNames = (seats) => (seats || []).filter(Boolean).map((s) => (s.bot ? `${s.player}(AI)` : s.player)).join(', ');
const print = (rows) => { if (json) console.log(JSON.stringify(rows, null, 1)); else for (const r of rows) console.log(r); };

// ---- rooms --------------------------------------------------------------------------------------------------------
function rooms() {
  const ev = readEvents(2);
  let snapAt = null;
  const live = new Map();
  for (const e of ev) {
    if (e.type === 'rooms') { snapAt = e.t; live.clear(); for (const r of e.rooms) live.set(r.room, { ...r, since: null }); continue; }
    if (!e.type.startsWith('room.')) continue;
    if (e.type === 'room.dispose') { live.delete(e.room); continue; }
    const r = live.get(e.room) || { room: e.room, mode: e.mode, difficulty: e.difficulty, inMatch: false, since: e.t };
    r.seats = e.seats;
    if (e.type === 'room.create') r.since = e.t;
    if (e.type === 'room.start') { r.inMatch = true; r.startedAt = e.t; }
    if (e.type === 'room.end') r.inMatch = false;
    live.set(e.room, r);
  }
  const rows = [...live.values()].map((r) => (json ? r
    : `${r.room}  ${r.mode}/${r.difficulty}  ${r.inMatch ? `对局中${r.round ? ` R${r.round}` : ''}${r.startedAt ? ` (开局 ${hm(r.startedAt)})` : ''}` : '大厅'}  ${seatNames(r.seats)}`));
  if (!json) console.log(`live rooms (${rows.length})${snapAt ? `, last snapshot ${fmt(snapAt)}` : ''}:`);
  print(rows);
}

// ---- history ------------------------------------------------------------------------------------------------------
function history() {
  const ev = readEvents();
  const roomsSeen = new Map();
  for (const e of ev) {
    if (!e.type.startsWith('room.')) continue;
    const key = `${e.room}@${e.type === 'room.create' ? e.t : ''}`;
    let r = e.type === 'room.create' ? null : [...roomsSeen.values()].reverse().find((x) => x.room === e.room && !x.disposed);
    if (!r) { r = { room: e.room, mode: e.mode, difficulty: e.difficulty, created: e.t, by: e.player ?? null, addr: e.addr ?? null, players: new Map(), matches: [], disposed: null }; roomsSeen.set(key, r); }
    for (const s of e.seats || []) if (s && !s.bot) r.players.set(s.player, r.players.get(s.player) || null);
    if (e.player && e.addr) r.players.set(e.player, e.addr);
    if (e.type === 'room.start') r.matches.push({ n: e.matchNo, start: e.t, seats: seatNames(e.seats) });
    if (e.type === 'room.end') { const m = r.matches.find((x) => x.n === e.matchNo); if (m) Object.assign(m, { end: e.t, victory: e.victory, reason: e.reason, rounds: e.roundsPassed }); }
    if (e.type === 'room.dispose') r.disposed = e.t;
  }
  const rows = [...roomsSeen.values()].map((r) => (json ? { ...r, players: Object.fromEntries(r.players) }
    : `${fmt(r.created)}  ${r.room}  ${r.mode}/${r.difficulty}  建房 ${r.by}${r.addr ? ` [${r.addr}]` : ''}  玩家 ${[...r.players].map(([n, a]) => (a ? `${n}[${a}]` : n)).join(', ')}\n`
      + r.matches.map((m) => `      #${m.n} ${hm(m.start)}–${hm(m.end)}  ${m.seats}  → ${m.end ? `${m.victory ? '胜利' : '失败'} (${m.reason}, 过 ${m.rounds} 回合)` : '未结束'}`).join('\n')));
  print(rows);
}

// ---- players ------------------------------------------------------------------------------------------------------
function players() {
  const ev = readEvents();
  const by = new Map();
  const get = (n) => { let p = by.get(n); if (!p) by.set(n, (p = { name: n, addrs: new Set(), first: null, last: null, rooms: new Set(), matches: 0 })); return p; };
  for (const e of ev) {
    const name = e.player;
    if (!name) continue;
    if (e.type === 'hello' || e.type.startsWith('room.')) {
      const p = get(name);
      if (e.addr) p.addrs.add(e.addr);
      p.first ??= e.t;
      p.last = e.t;
      if (e.room) p.rooms.add(e.room);
    }
  }
  for (const e of ev) if (e.type === 'room.start') for (const s of e.seats || []) if (s && !s.bot) get(s.player).matches++;
  const rows = [...by.values()].sort((a, b) => (b.last || '').localeCompare(a.last || '')).map((p) => (json ? { ...p, addrs: [...p.addrs], rooms: [...p.rooms] }
    : `${p.name}  对局 ${p.matches}  房间 ${p.rooms.size}  首次 ${fmt(p.first)}  最近 ${fmt(p.last)}  地址 ${[...p.addrs].join(' ')}`));
  print(rows);
}

// ---- one match ----------------------------------------------------------------------------------------------------
function match() {
  const code = String(pos[1] || '').toUpperCase();
  if (!code) { console.error('usage: node tools/logs.mjs match <ROOM> [N]'); process.exit(1); }
  const ev = readEvents().filter((e) => e.room === code);
  const starts = ev.filter((e) => e.type === 'match.start');
  if (!starts.length) { console.error(`no match of room ${code} in the last ${days} day(s)`); process.exit(1); }
  const want = pos[2] != null ? Number(pos[2]) : null;
  const start = want != null ? starts.find((e) => e.match === want) ?? starts[want - 1] : starts[starts.length - 1];
  const i0 = ev.indexOf(start);
  const i1 = ev.findIndex((e, i) => i > i0 && e.type === 'match.start');
  const mev = ev.slice(i0, i1 < 0 ? undefined : i1).filter((e) => e.seed === start.seed);
  if (json) { console.log(JSON.stringify(mev)); return; }
  console.log(`${code} ${start.mode}/${start.difficulty}  seed ${start.seed}  stage ${start.stageId}  boss ${start.bossId} / hidden ${start.hiddenBossId}  开局 ${fmt(start.t)}`);
  console.log(`  ${start.seats.map((s) => `${s.player}${s.bot ? '(AI)' : ''}`).join(', ')}${start.botAssist ? '  [AI assist]' : ''}${start.botPreferBond ? `  [AI ${start.botPreferBond}]` : ''}${start.bonusFunds ? `  [+${start.bonusFunds} funds]` : ''}`);
  const acts = has('--acts');
  let round = -1;
  for (const e of mev) {
    if (e.round !== round && e.round != null && ['board', 'result', 'boss', 'final'].includes(e.type)) { round = e.round; console.log(`— R${round}`); }
    if (e.type === 'band') console.log(`  策略 ${e.player}: ${e.got}`);
    else if (e.type === 'card') console.log(`  机变 ${e.player}: ${e.card ? (e.card.name || e.card.id || JSON.stringify(e.card).slice(0, 60)) : e.idx}`);
    else if (e.type === 'board' && !e.final) {
      const bonds = Object.entries(e.bonds).filter(([, b]) => b.tier > 0).map(([k, b]) => `${bondName(k)}${b.n}/${b.layers}层`).join(' ');
      console.log(`  ${e.player}${e.bot ? '(AI)' : ''} LP ${e.lp} L${e.level} ¥${e.funds}  ${e.board.filter((p) => p.name).map((p) => `${p.name}${p.id.endsWith('_b') ? '★' : ''}@${p.tile}${p.items.length ? `[${p.items.length}]` : ''}`).join(' ')}  | ${bonds}`);
    } else if (e.type === 'result') {
      const leaks = Object.entries(e.leaks).map(([k, n]) => `${enemyName(k)}×${n}`).join(' ');
      const gains = Object.entries(e.layerGains).filter(([, n]) => n).map(([k, n]) => `${bondName(k)}+${n}`).join(' ');
      console.log(`  结果 ${e.player}: ${e.killed}/${e.total}${leaks ? ` 漏 ${leaks}` : ' 完美'}${gains ? `  层 ${gains}` : ''}  伤害 ${e.damage}  LP→${e.lp}${e.unite ? ' (联防)' : ''}`);
    } else if (e.type === 'boss') console.log(`  boss ${e.fieldId} +${((e.fieldMs ?? 0) / 1000).toFixed(1)}s  pool ${e.poolHp}/${e.poolMax}  by ${JSON.stringify(e.by)}`);
    else if (e.type === 'final') console.log(`  ${e.reason}  pool ${e.poolHp}/${e.poolMax}  teamLP ${e.teamLp}`);
    else if (e.type === 'warn' || e.type === 'error') console.log(`  !! ${e.type} ${e.msg || e.label + ': ' + e.message}`);
    else if (e.type === 'match.end') console.log(`== ${e.victory ? '胜利' : '失败'} (${e.reason}) 过 ${e.roundsPassed} 回合  ${e.players.map((p) => `${p.player}: 伤害 ${p.stats?.dmgDealt} 漏 ${p.stats?.leaks}`).join(' | ')}`);
    else if (acts && e.type === 'act') console.log(`    ${hm(e.t)} ${e.player} ${e.action} ${e.name || e.item?.name || ''}${e.to ? ` → ${e.to}` : ''}${e.ok ? '' : ` ✗ ${e.error}`}`);
    else if (acts && (e.type === 'layers' || e.type === 'funds')) console.log(`    ${e.player} ${e.type === 'layers' ? `层数 ${bondName(e.bondId)}` : '资金'} ${e.n > 0 ? '+' : ''}${e.n} (${e.reason}${e.source?.piece ? ` ${chessName(e.source.piece)}` : ''})`);
  }
}

const commands = { rooms, history, players, match };
if (!commands[cmd]) { console.error(`unknown command ${cmd} (rooms | history | players | match <ROOM> [N])`); process.exit(1); }
commands[cmd]();
