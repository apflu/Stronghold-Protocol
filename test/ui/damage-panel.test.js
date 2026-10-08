// The per-round damage meter panel (ui/damagePanel.js, pure logic ui/gameLogic/meter.js): rows sorted by the tab's value
// with their share and bar, the tabs (伤害 default / 承伤 / 治疗), which board the panel asks for (the strip's player, the
// battle on screen; between rounds the kept one; nothing under server-run combat), the refresh fingerprint, the
// remembered fold / tab, the names of 自选 / 补位 / token rows, and the panel body's markup. The runner side:
// test/match/damage-meter.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { METER_TABS, meterTab, meterView, shareText, meterTarget, boardSignature, panelPref } = await import('../../public/js/ui/gameLogic/meter.js');
const gl = await import('../../public/js/ui/gameLogic.js');
const { MeterBody, rowName, rowRecord, DamagePanel, METER_REFRESH_MS } = await import('../../public/js/ui/damagePanel.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'tokens', 'backups', 'assets');

const row = (id, dmg, taken, heal, extra = {}) => ({ id, uid: id, defId: `chess_${id}`, kind: 'op', ownerId: 'p1', name: `op${id}`, dmg, taken, heal, summons: [], ...extra });
const BOARD = (extra = {}) => ({
  battleId: 'b1', fieldId: 'n:p1', kind: 'normal', round: 4, own: true, watch: false, done: false, live: true, ownerIds: ['p1'],
  units: [row(1, 300, 50, 0), row(2, 700, 0, 120), row(3, 0, 400, 0), row(4, 300, 10, 0)],
  totals: { dmg: 1300, taken: 460, heal: 120 },
  ...extra,
});

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && v.type.name === 'MeterRow') yield* walk(v.type(v.props));
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v.type === 'function' && v.type.name === 'MeterRow') return textOf(v.type(v.props));
  return textOf(v.props?.children);
};

describe('meterView: sorting, shares, bars', () => {
  test('伤害 (default): descending, ties by unit id; shares of the total; bars relative to the top row', () => {
    const v = meterView(BOARD());
    assert.equal(v.tab, 'dmg');
    assert.deepEqual(v.rows.map((r) => r.id), [2, 1, 4, 3]);
    assert.equal(v.total, 1300);
    assert.equal(v.top, 700);
    assert.deepEqual(v.rows.map((r) => Math.round(r.share * 10) / 10), [53.8, 23.1, 23.1, 0]);
    assert.deepEqual(v.rows.map((r) => Math.round(r.bar * 1000) / 1000), [1, 0.429, 0.429, 0]);
    assert.ok(Math.abs(v.rows.reduce((a, r) => a + r.share, 0) - 100) < 1e-9, 'shares add up to 100 %');
  });
  test('承伤 / 治疗 sort by their own value; an unknown tab falls back to 伤害', () => {
    assert.deepEqual(meterView(BOARD(), 'taken').rows.map((r) => r.id), [3, 1, 4, 2]);
    assert.deepEqual(meterView(BOARD(), 'heal').rows.map((r) => [r.id, r.share]), [[2, 100], [1, 0], [3, 0], [4, 0]]);
    assert.equal(meterView(BOARD(), 'bogus').tab, 'dmg');
    assert.deepEqual(METER_TABS.map((x) => x.key), ['dmg', 'taken', 'heal']);
    assert.deepEqual(METER_TABS.map((x) => x.label), ['伤害', '承伤', '治疗']);
    assert.equal(meterTab('heal'), 'heal');
    assert.equal(meterTab(undefined), 'dmg');
  });
  test('nothing dealt: zero shares and bars (no division by zero); a missing board is empty', () => {
    const v = meterView(BOARD({ units: [row(1, 0, 0, 0), row(2, 0, 0, 0)] }));
    assert.deepEqual(v.rows.map((r) => [r.share, r.bar]), [[0, 0], [0, 0]]);
    assert.deepEqual(meterView(null), { tab: 'dmg', total: 0, top: 0, rows: [] });
  });
  test('the summons\' part of a row (shown as 含召唤物 N)', () => {
    const v = meterView(BOARD({ units: [row(1, 500, 0, 0, { summons: [{ defId: 't', count: 2, dmg: 200, taken: 0, heal: 0 }] })] }));
    assert.equal(v.rows[0].summonValue, 200);
  });
  test('shareText: one decimal under 10 %, whole percents above', () => {
    assert.deepEqual([shareText(0), shareText(4.26), shareText(9.96), shareText(53.84), shareText(100)], ['0%', '4.3%', '10.0%', '54%', '100%']);
  });
  test('re-exported from gameLogic.js', () => {
    assert.equal(gl.meterView, meterView);
    assert.equal(gl.meterTarget, meterTarget);
  });
});

describe('meterTarget: whose board, which battle', () => {
  test('server-run combat: no source (the panel is hidden)', () => {
    assert.equal(meterTarget({ cc: false, combat: true, stripOwnerId: 'p1', battleFieldId: 'n:p1', myId: 'p1' }), null);
  });
  test('in battle / the settlement: the strip\'s player in the runner\'s battle on screen', () => {
    assert.deepEqual(meterTarget({ cc: true, combat: true, stripOwnerId: 'p1', battleFieldId: 'n:p1', myId: 'p1' }), { ownerId: 'p1', fieldId: 'n:p1' });
    // a teammate's battle watched after the own one / auto-observed while eliminated: the strip follows them
    assert.deepEqual(meterTarget({ cc: true, combat: true, stripOwnerId: 'p2', battleFieldId: 'n:p2', myId: 'p1' }), { ownerId: 'p2', fieldId: 'n:p2' });
    // 联防 / 最终攻势: the player on the ‹ › half (the strip's owner) on the shared field
    assert.deepEqual(meterTarget({ cc: true, combat: true, stripOwnerId: 'p3', battleFieldId: 'u', myId: 'p1' }), { ownerId: 'p3', fieldId: 'u' });
    assert.deepEqual(meterTarget({ cc: true, settle: true, stripOwnerId: 'p1', battleFieldId: 'b1', myId: 'p1' }), { ownerId: 'p1', fieldId: 'b1' });
  });
  test('between rounds (or no battle on screen yet): the last round\'s kept board, any field', () => {
    assert.deepEqual(meterTarget({ cc: true, combat: false, stripOwnerId: 'p1', battleFieldId: null, myId: 'p1' }), { ownerId: 'p1', fieldId: null });
    assert.deepEqual(meterTarget({ cc: true, combat: false, stripOwnerId: 'p2', myId: 'p1' }), { ownerId: 'p2', fieldId: null }, 'a scouted teammate');
    assert.deepEqual(meterTarget({ cc: true, combat: true, stripOwnerId: 'p1', battleFieldId: null, myId: 'p1' }), { ownerId: 'p1', fieldId: null });
    assert.deepEqual(meterTarget({ cc: true, combat: false, stripOwnerId: null, myId: 'p1' }), { ownerId: 'p1', fieldId: null }, 'no strip owner: yourself');
    assert.equal(meterTarget({ cc: true }), null);
  });
});

describe('refresh fingerprint and remembered state', () => {
  test('boardSignature changes with any shown number, the battle, its end; not otherwise', () => {
    const a = BOARD();
    assert.equal(boardSignature(a), boardSignature(BOARD()));
    assert.notEqual(boardSignature(a), boardSignature(BOARD({ units: [...a.units.slice(0, 3), row(4, 301, 10, 0)] })));
    assert.notEqual(boardSignature(a), boardSignature(BOARD({ done: true })));
    assert.notEqual(boardSignature(a), boardSignature(BOARD({ live: false })));
    assert.notEqual(boardSignature(a), boardSignature(BOARD({ battleId: 'b2' })));
    assert.equal(boardSignature(null), '');
    assert.equal(METER_REFRESH_MS, 250, '4 Hz');
  });
  test('panelPref: the stored fold / tab; default open on desktop, folded on a short screen; junk ignored', () => {
    assert.deepEqual(panelPref(null), { open: true, tab: 'dmg' });
    assert.deepEqual(panelPref(null, { short: true }), { open: false, tab: 'dmg' });
    assert.deepEqual(panelPref({ open: false, tab: 'heal' }), { open: false, tab: 'heal' });
    assert.deepEqual(panelPref({ open: true, tab: 'heal' }, { short: true }), { open: true, tab: 'heal' });
    assert.deepEqual(panelPref({ open: 'yes', tab: 3 }), { open: true, tab: 'dmg' });
    assert.deepEqual(panelPref('broken'), { open: true, tab: 'dmg' });
  });
});

describe('row names and the panel body', () => {
  test('an operator by its chess record, a token by its token record, else the sim\'s name', () => {
    const chessId = Object.keys(data.get('chess')).find((id) => !data.lookup('chess', id).isDiy);
    assert.equal(rowName({ kind: 'op', defId: chessId, name: 'x' }), data.lookup('chess', chessId).name);
    const tokId = Object.keys(data.get('tokens')).find((id) => data.lookup('tokens', id)?.name);
    assert.equal(rowName({ kind: 'token', defId: tokId, name: 'x' }), data.lookup('tokens', tokId).name);
    assert.equal(rowName({ kind: 'device', defId: 'dev', name: '装置' }), '装置'); // i18n-ignore
    assert.equal(rowName({ kind: 'op', defId: 'nope', name: 'simName' }), 'simName');
  });
  test('a 自选 slot shows the operator picked (the row carries the pick)', () => {
    const rec = rowRecord({ kind: 'op', defId: 'chess_char_5_diy1_a', diy: { charId: 'char_248_mgllan', skillIndex: 0, uniEquipId: null } });
    assert.equal(rec?.diyFor, 'chess_char_5_diy1_a');
    assert.equal(rec?.charId, 'char_248_mgllan');
  });
  test('MeterBody: 第N回合, the live mark while the battle runs, the three tabs, the total and the rows in order', () => {
    let tab = null;
    const v = MeterBody({ board: BOARD(), tab: 'dmg', onTab: (k) => { tab = k; }, onFold: () => {} });
    const nodes = [...walk(v)];
    assert.equal(textOf(nodes.find((n) => hasClass(n, 'dmeter__round'))), '第 4 回合');
    assert.ok(nodes.some((n) => hasClass(n, 'dmeter__live')), 'live');
    const tabs = nodes.filter((n) => hasClass(n, 'dmeter__tab'));
    assert.deepEqual(tabs.map(textOf), ['伤害', '承伤', '治疗']);
    assert.deepEqual(tabs.map((n) => n.props['aria-selected']), ['true', 'false', 'false']);
    tabs[2].props.onClick();
    assert.equal(tab, 'heal');
    assert.equal(textOf(nodes.find((n) => hasClass(n, 'dmeter__total'))), '合计1,300');
    const names = nodes.filter((n) => hasClass(n, 'dmeter__name')).map(textOf);
    assert.deepEqual(names, ['op2', 'op1', 'op4', 'op3']);
    assert.deepEqual(nodes.filter((n) => hasClass(n, 'dmeter__pct')).map(textOf), ['54%', '23%', '23%', '0%']);
    assert.ok(nodes.some((n) => hasClass(n, 'dmeter__fold')), 'the fold button');
  });
  test('MeterBody: a kept board (between rounds) has no live mark; a watched player\'s name; empty board', () => {
    const nodes = [...walk(MeterBody({ board: BOARD({ live: false, done: true }), tab: 'taken', onTab() {}, owner: '阿米娅' }))];
    assert.ok(!nodes.some((n) => hasClass(n, 'dmeter__live')));
    assert.equal(textOf(nodes.find((n) => hasClass(n, 'dmeter__owner'))), '阿米娅');
    assert.deepEqual(nodes.filter((n) => hasClass(n, 'dmeter__name')).map(textOf), ['op3', 'op1', 'op4', 'op2']);
    const empty = [...walk(MeterBody({ board: BOARD({ units: [] }), tab: 'dmg', onTab() {} }))];
    assert.ok(empty.some((n) => hasClass(n, 'dmeter__empty')));
  });
  test('the game screen mounts the panel with the strip\'s player and the runner state as its refresh key', () => {
    assert.equal(typeof DamagePanel, 'function');
    const src = read('public/js/screens/game.js');
    assert.match(src, /meterTarget\(\{ cc, combat, settle: settleMode, stripOwnerId: strip\.ownerId, battleFieldId: battleState\?\.fieldId/);
    assert.match(src, /<\$\{DamagePanel\} target=\$\{meter\} refreshKey=\$\{meterKey\}/);
    const css = read('public/css/screens/game.css');
    assert.match(css, /\.dmeter \{/);
  });
});
