// Damage meter rows of a battle (the per-round 伤害统计 panel, ui/damagePanel.js) — read-only views of the sim's per-unit
// counters, used by battle/runner.js damageBoard().
//
// The sim keeps on every unit `stats.dmg` (HP removed from the other side — server/sim/damage.js: self and friendly damage
// never count, an element burst is credited to the unit that filled the gauge), `stats.taken` (HP the unit lost, from any
// source) and `stats.heal` (HP it restored on others or itself). Every ally unit ever created stays in
// `battle.allyUnits` (dead or retreated included), so the numbers of a unit that left the field are kept.
//
// Summons: a token's numbers are its summoner's. A token with an `ownerUnit` (the operator that summoned or placed it —
// a skill summon, a 召唤师's drone, a deck piece) is folded into the row of its root operator (`ownerUnit` followed up
// through tokens): the operator's row totals include it and list it under `summons` (one entry per token kind, its own
// numbers), so the panel reads "麦哲伦 12 345 (含召唤物 4 567)". A token without an owner (a board token piece of its own)
// and a device with any number keep a row of their own.
//
// Read-only: only `kind`, `defId`, `uid`, `ownerId`, `name`, `ownerUnit`, `stats` and the def's 补位 / 自选 marks are
// read — never `unit.s` (a lazy stat recompute would run earlier than the sim itself would run it) — and nothing is
// written, so building a board never changes the battle (test/match/damage-meter.test.js digests a battle with and
// without reading it every tick).

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isObj = (v) => !!v && typeof v === 'object';

/** The operator a token's numbers belong to (its `ownerUnit`, followed through tokens), or null. */
export function rootOwner(u) {
  let o = u && u.ownerUnit;
  for (let i = 0; o && i < 8; i++) {
    if (o.kind !== 'token') return o;
    o = o.ownerUnit;
  }
  return null;
}

/** The 3 counters of a unit (raw floats). */
const countersOf = (u) => {
  const s = isObj(u && u.stats) ? u.stats : null;
  return { dmg: num(s && s.dmg), taken: num(s && s.taken), heal: num(s && s.heal) };
};

/** A row's display fields of the unit it stands for. */
function rowOf(u) {
  const d = isObj(u.def) ? u.def : null;
  const row = {
    id: Number.isInteger(u.id) ? u.id : null, uid: Number.isInteger(u.uid) ? u.uid : null,
    defId: typeof u.defId === 'string' ? u.defId : '', kind: u.kind, ownerId: u.ownerId ?? null,
    name: typeof u.name === 'string' ? u.name : '', dmg: 0, taken: 0, heal: 0, summons: [],
  };
  // a 补位 stand-in names the replaced operator; a 自选 slot carries its pick (the panel composes the record shown)
  if (u.kind === 'op' && d && typeof d.standInFor === 'string' && d.standInFor) row.standInFor = d.standInFor;
  if (u.kind === 'op' && d && d.diyFor && isObj(d.loadout) && isObj(d.loadout.diy)) row.diy = { ...d.loadout.diy };
  return row;
}

const round = (v) => Math.round(v);

/**
 * The meter rows of a battle's ally units (all players, or `ownerId`'s), numbers rounded for display: operators (and
 * owner-less tokens / devices with any number) with their summons folded in (see the header), in the battle's unit
 * order (the panel sorts). Totals over the rows.
 * @param {any} battle a sim Battle (or anything with `allyUnits`)
 * @param {string|null} [ownerId]
 * @returns {{ units: Array<{ id: number|null, uid: number|null, defId: string, kind: string, ownerId: string|null,
 *   name: string, dmg: number, taken: number, heal: number, standInFor?: string, diy?: object,
 *   summons: Array<{ defId: string, name: string, count: number, dmg: number, taken: number, heal: number }> }>,
 *   totals: { dmg: number, taken: number, heal: number } }}
 */
export function meterRows(battle, ownerId = null) {
  const list = battle && Array.isArray(battle.allyUnits) ? battle.allyUnits : [];
  const rows = new Map(); // root unit → row
  const raw = new Map();  // row → raw sums (rounded once at the end: no drift from rounding each summon)
  const want = (u) => ownerId == null || u.ownerId === ownerId;
  const rowFor = (u) => {
    let r = rows.get(u);
    if (!r) { r = rowOf(u); rows.set(u, r); raw.set(r, { dmg: 0, taken: 0, heal: 0, sum: new Map() }); }
    return r;
  };
  for (const u of list) {
    if (!u || !want(u)) continue;
    if (u.kind === 'op') { const r = rowFor(u); const c = countersOf(u); const a = raw.get(r); a.dmg += c.dmg; a.taken += c.taken; a.heal += c.heal; continue; }
    const c = countersOf(u);
    const root = u.kind === 'token' ? rootOwner(u) : null;
    if (root && want(root)) {
      const a = raw.get(rowFor(root));
      a.dmg += c.dmg; a.taken += c.taken; a.heal += c.heal;
      const key = typeof u.defId === 'string' ? u.defId : '';
      let s = a.sum.get(key);
      if (!s) { s = { defId: key, name: typeof u.name === 'string' ? u.name : '', count: 0, dmg: 0, taken: 0, heal: 0 }; a.sum.set(key, s); }
      s.count++; s.dmg += c.dmg; s.taken += c.taken; s.heal += c.heal;
      continue;
    }
    // an owner-less token (a board piece of its own), a device: a row of its own when it did anything
    if (u.kind === 'token' || c.dmg > 0 || c.taken > 0 || c.heal > 0) {
      const a = raw.get(rowFor(u));
      a.dmg += c.dmg; a.taken += c.taken; a.heal += c.heal;
    }
  }
  const totals = { dmg: 0, taken: 0, heal: 0 };
  const units = [];
  for (const r of rows.values()) {
    const a = raw.get(r);
    r.dmg = round(a.dmg); r.taken = round(a.taken); r.heal = round(a.heal);
    r.summons = [...a.sum.values()].map((s) => ({ ...s, dmg: round(s.dmg), taken: round(s.taken), heal: round(s.heal) }));
    totals.dmg += r.dmg; totals.taken += r.taken; totals.heal += r.heal;
    units.push(r);
  }
  return { units, totals };
}
