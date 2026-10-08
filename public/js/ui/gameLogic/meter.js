// ui/gameLogic/meter.js — pure logic of the per-round damage meter (ui/damagePanel.js; the owner's request
// 「既然有打完之后的整体伤害统计，也做一个每回合的伤害统计吧。做在侧面一个可收起的面板，最好是实时的。」).
//
// The panel reads battle/runner.js damageBoard(ownerId, fieldId) and shows one player's operators of the battle on screen:
//   * whose: the player the bond strip follows (ui/watchBonds.js screenStrip — the own player in the own battle, a watched
//     / auto-observed teammate, the player on the ‹ › half of a 联防 / 最终攻势 field, 全景 = yours when you fight there,
//     else the teammate picked with 前往查看 / the field's first player);
//   * which battle: the runner's battle on screen during combat and the settlement (`battleFieldId`); between rounds
//     (prep, 机变, the round start) the runner's kept final board of the last round — no field filter, the strip's player;
//   * nothing under server-run combat (no local simulation) — the panel is hidden then, and whenever damageBoard is null.
// Tabs 伤害 / 承伤 / 治疗 (METER_TABS); rows sorted by the tab's value (descending; ties by unit id), each with its share
// of the total and a bar relative to the top row.

import { N_ } from '../../../../shared/i18n.js';
import { isObj } from './shared.js';

/** The meter's tabs: the damage-board field each shows and its label (msgid). */
export const METER_TABS = Object.freeze([
  Object.freeze({ key: 'dmg', label: N_('伤害') }),
  Object.freeze({ key: 'taken', label: N_('承伤') }),
  Object.freeze({ key: 'heal', label: N_('治疗') }),
]);

/** A valid tab key ('dmg' by default). */
export function meterTab(key) {
  return METER_TABS.some((x) => x.key === key) ? key : 'dmg';
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The rows of a damage board for a tab: sorted by value (descending, ties by unit id then defId), with `value`, `share`
 * (percent of the tab's total, 0 when the total is 0) and `bar` (0..1, relative to the top value); the tab's `total`
 * (the sum of the rows) and `top`.
 * @param {any} board battle/runner.js damageBoard() (or null) @param {string} [tab]
 * @returns {{ tab: string, total: number, top: number, rows: Array<any> }}
 */
export function meterView(board, tab = 'dmg') {
  const k = meterTab(tab);
  const units = isObj(board) && Array.isArray(board.units) ? board.units.filter(isObj) : [];
  const rows = units.map((u) => {
    const sums = Array.isArray(u.summons) ? u.summons.filter(isObj) : [];
    return { ...u, value: num(u[k]), summonValue: sums.reduce((a, s) => a + num(s[k]), 0) };
  });
  rows.sort((a, b) => b.value - a.value || (a.id ?? 0) - (b.id ?? 0) || String(a.defId).localeCompare(String(b.defId)));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const top = rows.length ? rows[0].value : 0;
  for (const r of rows) {
    r.share = total > 0 ? (r.value / total) * 100 : 0;
    r.bar = top > 0 ? r.value / top : 0;
  }
  return { tab: k, total, top, rows };
}

/** A share as shown: one decimal under 10 %, whole percents above ('0%' for none). */
export function shareText(pct) {
  if (!(pct > 0)) return '0%';
  if (pct < 10) return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/**
 * Which damage board the panel asks the runner for: { ownerId, fieldId } — fieldId null = the kept board of the last
 * round (between rounds) — or null when the panel has no source (server-run combat).
 * @param {{ cc?: boolean, combat?: boolean, settle?: boolean, stripOwnerId?: string|null, battleFieldId?: string|null,
 *   myId?: string|null }} o — stripOwnerId: ui/watchBonds.js screenStrip().ownerId; battleFieldId: the runner's battle on
 *   screen (state().fieldId)
 */
export function meterTarget({ cc = false, combat = false, settle = false, stripOwnerId = null, battleFieldId = null, myId = null } = {}) {
  if (!cc) return null;
  const ownerId = typeof stripOwnerId === 'string' && stripOwnerId ? stripOwnerId : (typeof myId === 'string' && myId ? myId : null);
  if (!ownerId) return null;
  const inBattle = (combat || settle) && typeof battleFieldId === 'string' && battleFieldId;
  return { ownerId, fieldId: inBattle ? battleFieldId : null };
}

/**
 * A cheap fingerprint of what the panel shows (the refresh only re-renders when it changes): the battle, its state and
 * every row's three numbers.
 * @param {any} board
 */
export function boardSignature(board) {
  if (!isObj(board)) return '';
  const units = Array.isArray(board.units) ? board.units : [];
  let s = `${board.battleId}|${board.fieldId}|${board.round}|${board.done ? 1 : 0}|${board.live ? 1 : 0}`;
  for (const u of units) s += `|${u.id}:${u.dmg}:${u.taken}:${u.heal}`;
  return s;
}

/**
 * The panel's remembered state per viewer (localStorage `sp.pref.damagePanel`): { open, tab }. A missing / broken value
 * opens the panel on desktop and keeps it folded on a short (phone landscape) screen.
 * @param {any} raw the stored value @param {{ short?: boolean }} [o]
 */
export function panelPref(raw, { short = false } = {}) {
  const v = isObj(raw) ? raw : {};
  return { open: typeof v.open === 'boolean' ? v.open : !short, tab: meterTab(v.tab) };
}
