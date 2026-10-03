// The host's event log (SP_LOG_DIR, server/match/eventlog.js): what a match writes, and nothing when it is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eventLog } from '../../server/match/eventlog.js';
import { makeMatch } from './harness.js';

const play = () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 21, fake: true, botAssist: false });
  h.ps('p_0').autoplay = true;
  h.start();
  h.runToEnd();
  const out = { ended: h.ended, errors: h.m.errorCount, lp: [...h.m.players.values()].map((p) => p.lp) };
  h.m.dispose();
  return out;
};

test('event log: a match writes its start, phases, boards, actions with their sources, results and end', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-evlog-'));
  assert.ok(eventLog.open(dir));
  let on;
  try { on = play(); } finally { eventLog.close(); }
  await new Promise((r) => setTimeout(r, 50)); // the append stream flushes
  const lines = fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')).map((l) => JSON.parse(l));
  const types = new Set(lines.map((l) => (l.type === 'act' ? `act:${l.action}` : l.type)));
  for (const t of ['match.start', 'phase', 'board', 'act:buy', 'act:move', 'act:ready', 'funds', 'band', 'result', 'match.end']) assert.ok(types.has(t), `${t} logged`);
  const buy = lines.find((l) => l.type === 'act' && l.action === 'buy' && l.ok);
  assert.ok(buy.player && buy.id && buy.name && buy.room === 'TEST' && Number.isInteger(buy.round), 'an action names the player, the piece and where in the match');
  assert.ok(lines.some((l) => l.type === 'funds' && l.reason === 'income'), 'funds changes carry their reason');
  assert.ok(lines.every((l) => typeof l.t === 'string'));
  // the same match without the log plays out the same
  const off = play();
  assert.deepEqual(off, on, 'logging changes nothing in the match');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('event log: off by default (nothing to write, nothing wrapped)', () => {
  assert.equal(eventLog.enabled, false);
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', fake: true });
  assert.equal(h.m.eventLog, undefined);
  assert.equal(Object.hasOwn(h.ps('p_0'), 'buy'), false, 'player methods untouched');
  h.m.dispose();
});
