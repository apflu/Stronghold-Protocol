// Per-round damage meter (伤害统计): a collapsible side panel of the game screen (screens/game.js), the owner's request
// 「既然有打完之后的整体伤害统计，也做一个每回合的伤害统计吧。做在侧面一个可收起的面板，最好是实时的。」 — the result
// screen keeps the match totals per player; this shows the current round per operator.
//
// Source: battle/runner.js damageBoard(ownerId, fieldId) — the local simulation's per-unit counters (client-side combat
// only; under server-run combat, and before the first battle, there is no board and the panel is not shown). Which
// player and battle: ui/gameLogic/meter.js meterTarget (the player the bond strip follows, the battle on screen; between
// rounds the runner's kept final board of the last round, labelled with that round). A summon's numbers are its
// summoner's (battle/meter.js), with "含召唤物 N" under the operator's name.
// Refresh: 4 Hz while the board is live and its battle runs (a read of the numbers; the panel re-renders only when the
// fingerprint changes — gameLogic/meter.js boardSignature), nothing while folded or after the battle ended.
// Place: the left edge, between the team panel and the bottom-left corner buttons (measured: the team panel grows with
// the players and a teammate's 前往查看 button, the corner wraps to two rows on narrow phones; a shop bar / scouting pill
// that reaches into its column on a narrow phone is a lower bound too); folded it is a small tab there; with less than
// MIN_OPEN_PX of room only the tab shows. Popups (detail card, bond popup, emote wheel) open over it. Folded / tab: remembered per viewer
// (localStorage `sp.pref.damagePanel`, store.js loadPref / savePref — both guarded); short screens start folded.

import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { UnitThumb, GIcon, diyToken } from './gameComponents.js';
import { METER_TABS, meterTab, meterView, shareText, boardSignature, panelPref } from './gameLogic/meter.js';
import { fmtNum } from './gameLogic/format.js';
import { diyRecordFor } from './gameLogic/diy.js';
import { cardStandIn } from './gameLogic/standIn.js';
import { loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { battleRunner } from '../battle/runner.js';
import { t, tParts } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
/** Refresh period while the battle runs (≈ 4 Hz). */
export const METER_REFRESH_MS = 250;
const PREF_KEY = 'damagePanel';
/** Less room than this (px) between the team panel and the corner: only the tab is shown. */
const MIN_OPEN_PX = 96;
/** The open panel's right edge from the HUD's left (css .dmeter: .22rem + max(2rem, 156px)), px. */
const panelRight = () => {
  let rem = 100;
  try { rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100; } catch { /* default */ }
  return 0.22 * rem + Math.max(2 * rem, 156);
};

const shortScreen = () => {
  try { return (globalThis.innerHeight || 1080) < 432; } catch { return false; }
};

/**
 * The record a row is drawn with (name + art): a chess (its 自选 pick composed, a 补位 stand-in's record), a token; null
 * for anything else (the sim's name is shown).
 * @param {any} row a damageBoard unit
 */
export function rowRecord(row) {
  if (!row || typeof row.defId !== 'string') return null;
  if (row.kind === 'token') return data.lookup('tokens', row.defId) || diyToken(row.defId) || null;
  if (row.kind !== 'op') return null;
  const c = data.lookup('chess', row.defId);
  if (!c) return null;
  const lib = { chess: data.get('chess'), backups: data.get('backups') };
  const diy = row.diy && c.isDiy ? diyRecordFor(c, row.diy, lib) : null;
  const base = diy || c;
  return cardStandIn(base, { unit: row, backups: lib.backups }) || base;
}

/** The name a row shows. */
export const rowName = (row) => rowRecord(row)?.name || row?.name || row?.defId || '?';

/** The name of a summon kind under its operator. */
const summonName = (s) => data.lookup('tokens', s.defId)?.name || diyToken(s.defId)?.name || s.name || s.defId;

function MeterRow({ row, tab }) {
  const rec = rowRecord(row);
  const name = rec?.name || row.name || row.defId;
  const sums = (Array.isArray(row.summons) ? row.summons : []).filter((s) => s && s[tab] > 0);
  const tip = sums.length ? `${name} · ${sums.map((s) => `${summonName(s)} ${fmtNum(s[tab])}`).join(' · ')}` : name;
  return html`<li class="dmeter__row" title=${tip}>
    ${row.kind === 'op' ? html`<${UnitThumb} kind="chess" id=${row.defId} rec=${rec} size="xs" showTier=${false} title=${name} />`
      : row.kind === 'token' ? html`<${UnitThumb} kind="token" id=${row.defId} size="xs" title=${name} />`
        : html`<span class="dmeter__glyph" aria-hidden="true">${[...String(name)][0] || '?'}</span>`}
    <div class="dmeter__main">
      <div class="dmeter__line">
        <span class="dmeter__name">${name}</span>
        <b class="dmeter__val num">${fmtNum(row.value)}</b>
        <span class="dmeter__pct num">${shareText(row.share)}</span>
      </div>
      <div class="dmeter__bar" aria-hidden="true"><i style=${`width:${(row.bar * 100).toFixed(1)}%`}></i></div>
      ${row.summonValue > 0 ? html`<span class="dmeter__sub">${t('含召唤物 {n}', { n: fmtNum(row.summonValue) })}</span>` : null}
    </div>
  </li>`;
}

/**
 * The panel body (pure render of a board): header (round, live mark, total), the tabs, the sorted rows.
 * @param {{ board: any, tab: string, onTab: (k: string) => void, owner?: string|null, onFold?: () => void }} props
 */
export function MeterBody({ board, tab, onTab, owner = null, onFold }) {
  const v = meterView(board, tab);
  const round = Number.isInteger(board?.round) && board.round > 0 ? board.round : null;
  const running = !!board?.live && !board?.done;
  return html`<div class="dmeter__panel">
    <div class="dmeter__head">
      <span class="dmeter__round">${round != null ? tParts('第 {r} 回合', { r: html`<b class="num">${round}</b>` }) : t('伤害统计')}</span>
      ${running ? html`<span class="dmeter__live" title=${t('实时')}><i aria-hidden="true"></i>${t('实时')}</span>` : null}
      ${onFold ? html`<button type="button" class="dmeter__fold" aria-label=${t('收起伤害统计')} title=${t('收起伤害统计')}
        onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }} onClick=${onFold}>‹</button>` : null}
    </div>
    ${owner ? html`<div class="dmeter__owner"><${GIcon} name="eye" /><span>${owner}</span></div>` : null}
    <div class="dmeter__tabs" role="tablist" aria-label=${t('伤害统计')}>
      ${METER_TABS.map((x) => html`<button key=${x.key} type="button" role="tab" aria-selected=${v.tab === x.key ? 'true' : 'false'}
        class=${cx('dmeter__tab', v.tab === x.key && 'is-on')} onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}
        onClick=${() => onTab(x.key)}>${t(x.label)}</button>`)}
    </div>
    <div class="dmeter__total"><span>${t('合计')}</span><b class="num">${fmtNum(v.total)}</b></div>
    ${v.rows.length ? html`<ol class="dmeter__rows">${v.rows.map((r) => html`<${MeterRow} key=${r.id ?? r.defId} row=${r} tab=${v.tab} />`)}</ol>`
      : html`<div class="dmeter__empty">${t('暂无数据')}</div>`}
  </div>`;
}

/**
 * @param {{ target: { ownerId: string, fieldId: string|null } | null, refreshKey?: string, owner?: string|null,
 *   getBoard?: (ownerId: string, fieldId: string|null) => any }} props — refreshKey: changes whenever the runner's state
 *   does (a new battle on screen, its end, the round's clear); owner: the watched player's name (null for the own)
 */
export function DamagePanel({ target, refreshKey = '', owner = null, getBoard = null }) {
  const read = getBoard || ((o, f) => (battleRunner ? battleRunner.damageBoard(o, f) : null));
  const [pref, setPref] = useState(() => panelPref(loadPref(PREF_KEY, null), { short: shortScreen() }));
  const [board, setBoard] = useState(null);
  const [box, setBox] = useState(null);
  const sigRef = useRef('');
  const rootRef = useRef(null);
  const ownerId = target ? target.ownerId : null;
  const fieldId = target ? target.fieldId : null;

  const update = (p) => setPref((cur) => { const n = { ...cur, ...p, tab: meterTab(p.tab ?? cur.tab) }; savePref(PREF_KEY, n); return n; });

  // read the board now, then 4 Hz while its battle runs and the panel is open
  useEffect(() => {
    const pull = () => {
      let b;
      try { b = ownerId ? read(ownerId, fieldId) : null; } catch { b = null; }
      const sig = boardSignature(b);
      if (sig !== sigRef.current) { sigRef.current = sig; setBoard(b); }
      return b;
    };
    const b = pull();
    if (!pref.open || !b || !b.live || b.done) return undefined;
    const h = setInterval(() => { const n = pull(); if (!n || !n.live || n.done) clearInterval(h); }, METER_REFRESH_MS);
    return () => clearInterval(h);
  }, [ownerId, fieldId, refreshKey, pref.open]);

  // the room between the team panel and the corner buttons (both move: players, 前往查看, a wrapped corner)
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const place = () => {
      const hud = el.parentElement;
      if (!hud || typeof hud.getBoundingClientRect !== 'function') return;
      const hb = hud.getBoundingClientRect();
      const team = hud.querySelector('.team');
      const corner = hud.querySelector('.gm__corner');
      const tb = team ? team.getBoundingClientRect() : null;
      const cb = corner ? corner.getBoundingClientRect() : null;
      const top = Math.round(tb && tb.height > 0 ? tb.bottom - hb.top : 0);
      let bottom = cb && cb.height > 0 ? hb.bottom - cb.top : 0;
      // a bottom bar that reaches into the panel's column (the shop bar / the scouting pill on a narrow phone): above it
      const right = hb.left + Math.max(el.getBoundingClientRect().right - hb.left, panelRight());
      for (const sel of ['.shopbar__row', '.shopbar-tab', '.gm__watching']) {
        const r = hud.querySelector(sel)?.getBoundingClientRect();
        if (r && r.height > 0 && r.left < right) bottom = Math.max(bottom, hb.bottom - r.top);
      }
      bottom = Math.round(bottom);
      setBox((cur) => (cur && cur.top === top && cur.bottom === bottom && cur.h === Math.round(hb.height) ? cur : { top, bottom, h: Math.round(hb.height) }));
    };
    place();
    const h = setInterval(place, 500);
    globalThis.addEventListener?.('resize', place);
    return () => { clearInterval(h); globalThis.removeEventListener?.('resize', place); };
  }, [!!board]);

  if (!target || !board) return html`<div class="dmeter is-empty" ref=${rootRef} hidden></div>`;
  const room = box ? box.h - box.top - box.bottom : Infinity;
  const open = pref.open && room >= MIN_OPEN_PX;
  const style = box && box.top > 0 ? `--dm-top:${box.top}px;--dm-bottom:${box.bottom}px` : '';
  return html`<aside class=${cx('dmeter', open ? 'is-open' : 'is-folded')} ref=${rootRef} style=${style} aria-label=${t('伤害统计')}
      data-owner=${ownerId} data-round=${board.round ?? ''}>
    ${open ? html`<${MeterBody} board=${board} tab=${pref.tab} owner=${owner} onTab=${(k) => update({ tab: k })} onFold=${() => update({ open: false })} />`
      : html`<button type="button" class="dmeter__toggle" aria-expanded="false" aria-label=${t('展开伤害统计')} title=${t('展开伤害统计')}
          disabled=${room < MIN_OPEN_PX} onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}
          onClick=${() => update({ open: true })}><${GIcon} name="meter" /><span>${t('伤害')}</span></button>`}
  </aside>`;
}
