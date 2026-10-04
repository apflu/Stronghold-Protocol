// server/match/pool.js — the SHARED chess pool (copies per base chess, across all players), per-match bans,
// copy-weighted shop rolls (research 00-INDEX §3, §6; DESIGN §6.2).
//
// Model:
//   * Every visible (non-hidden, non-DIY) base chess that is not banned this match has `cap` copies
//     (config.economy.poolCopies[tier], overrides e.g. 缪尔赛思 4). `left[baseId]` = copies not owned by anyone.
//   * Owning a piece takes copies: a normal piece holds 1, an elite holds 3 (merge of 3 normals). Shop displays
//     do NOT reserve copies; buying fails (SOLD_OUT) when left = 0.
//   * Pieces remember how many copies they hold (`piece.poolCopies`), so selling / elimination / temp wipes return
//     exactly what was taken — chess granted by effects while the pool is empty (or hidden/banned chess) hold 0.
//   * Invariant (tests): 0 ≤ left ≤ cap and left + Σ held copies == cap for every base chess.
//
//   * 甄选干员 (DIY picks, shared/protocol.js checkPicks): addPicks(ids, owner) gives each player's pick an entry of its
//     own — key `<chessId>@<playerId>` (pickKey), `pick: true`, `base`, `owner`, the tier's copies: the pick widens THAT
//     player's supply pool ("补给池随机范围也将被相应扩大"), so two players who chose the same pick each have the full
//     copies. A pick entry is only eligible for its owner's rolls (`owner` option of roll / tierShares); every other
//     roll — bots, team-wide draws — never sees it, and roll returns the chess id (`base`). take / give / left / has /
//     cap read the owner's entry for a pick (keyOf); a piece keeps the key its copies came from (`piece.poolKey`), so a
//     sold or merged pick gives them back to that entry whoever holds it then.
//
// Rolls: each chess slot draws ONE copy uniformly from all remaining copies of eligible chess with tier ≤ shop level
// ("copy-weighted"; duplicates within a roll allowed). The item slot picks a tier with the same tier shares, then a
// uniform shop-eligible item of that tier (falling back to lower tiers).

/**
 * Per-match disabled bond set D and banned chess (research 01 A2): D = uniform sample of `core` core bonds and `addon`
 * add-on bonds among weight > 0 bonds that are active in the mode. A visible chess is banned iff every one of its
 * bonds is in D ∪ mode.inactiveBondIds.
 * @param {import('./gamedata.js').GameData} gd
 * @param {Function} rng seeded rng (createRng)
 * @returns {{ drawn: string[], staticOff: string[], banned: string[] }}
 */
export function drawDisabledBonds(gd, rng) {
  const { core: nCore, addon: nAddon } = gd.bans(gd.difficulty);
  const staticOff = [...gd.modeInactiveBonds].filter((b) => gd.bond(b)).sort();
  const eligible = gd.bondIds.filter((b) => {
    const bond = gd.bond(b);
    return bond && Number(bond.weight) > 0 && !gd.modeInactiveBonds.has(b);
  });
  const core = eligible.filter((b) => gd.bond(b).isCore);
  const addon = eligible.filter((b) => !gd.bond(b).isCore);
  const drawn = [...sample(core, nCore, rng), ...sample(addon, nAddon, rng)].sort();
  const off = new Set([...drawn, ...staticOff]);
  const banned = [];
  for (const id of gd.visibleChess) {
    const c = gd.chess(id);
    const bonds = Array.isArray(c.bonds) ? c.bonds : [];
    if (bonds.length > 0 && bonds.every((b) => off.has(b))) banned.push(id);
  }
  return { drawn, staticOff, banned };
}

function sample(arr, n, rng) {
  const a = arr.slice();
  rng.shuffle(a);
  return a.slice(0, Math.max(0, Math.min(n, a.length)));
}

/** Entry key of `owner`'s 甄选 pick `chessId`. */
export const pickKey = (chessId, owner) => `${chessId}@${owner}`;

export class SharedPool {
  /**
   * @param {import('./gamedata.js').GameData} gd
   * @param {{ banned?: Iterable<string> }} [opts]
   */
  constructor(gd, { banned = [] } = {}) {
    this.gd = gd;
    const ban = new Set(banned);
    /** @type {Map<string, { cap: number, left: number, tier: number }>} */
    this.entries = new Map();
    for (const id of gd.visibleChess) {
      if (ban.has(id)) continue;
      const cap = gd.poolCopies(id);
      if (cap <= 0) continue;
      this.entries.set(id, { cap, left: cap, tier: gd.tierOf(id) });
    }
    this.banned = [...ban].sort();
  }

  /** Add `owner`'s 甄选 pick entries (normal chess ids of `diyPick` records; already present / unknown ids are skipped). */
  addPicks(ids, owner) {
    if (owner == null) return;
    for (const id of ids || []) {
      const key = pickKey(id, owner);
      if (this.entries.has(key)) continue;
      const c = this.gd.chess(id);
      if (!c || !c.diyPick || c.isGolden) continue;
      const cap = this.gd.poolCopies(id);
      if (cap > 0) this.entries.set(key, { cap, left: cap, tier: this.gd.tierOf(id), pick: true, base: id, owner });
    }
  }

  /** The entry key of a base chess for `owner`: its pick entry when the owner chose it, else the base id itself. */
  keyOf(baseId, owner = null) {
    if (owner != null) { const k = pickKey(baseId, owner); if (this.entries.has(k)) return k; }
    return baseId;
  }

  /** Whether a base chess is part of this match's pool (visible, not banned) — or `owner`'s pick; `key` may be an entry key. */
  has(key, owner = null) { return this.entries.has(this.keyOf(key, owner)); }
  cap(key, owner = null) { return this.entries.get(this.keyOf(key, owner))?.cap ?? 0; }
  left(key, owner = null) { return this.entries.get(this.keyOf(key, owner))?.left ?? 0; }

  /** Take up to n copies; returns the number actually taken (0 when not in the pool / empty). */
  take(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.left, Math.floor(n));
    e.left -= k;
    return k;
  }

  /** Return n copies (clamped at the cap). Returns the number actually returned. */
  give(baseId, n = 1) {
    const e = this.entries.get(baseId);
    if (!e || !(n > 0)) return 0;
    const k = Math.min(e.cap - e.left, Math.floor(n));
    e.left += k;
    return k;
  }

  /** Remaining copies of eligible chess (tier ≤ maxTier, or exactly `tier`; pick entries only `owner`'s). Ids are bases. */
  _eligible({ maxTier = 6, tier = null, filter = null, owner = null } = {}) {
    const out = [];
    for (const [key, e] of this.entries) {
      if (e.left <= 0) continue;
      if (e.pick && (owner == null || e.owner !== owner)) continue;
      const id = e.pick ? e.base : key;
      if (tier != null ? e.tier !== tier : e.tier > maxTier) continue;
      if (filter && !filter(id, e)) continue;
      out.push([id, e.left]);
    }
    return out;
  }

  /**
   * Copy-weighted roll: one copy uniformly among remaining copies of eligible chess. Returns a base id or null.
   * @param {Function} rng
   * @param {{ maxTier?: number, tier?: number|null, filter?: (id: string, e: object) => boolean, owner?: string|null }} [opts]
   *   owner: the rolling player (their 甄选 pick entries join the roll)
   */
  roll(rng, opts = {}) {
    const el = this._eligible(opts);
    let total = 0;
    for (const [, n] of el) total += n;
    if (total <= 0) return null;
    let r = rng() * total;
    for (const [id, n] of el) { r -= n; if (r < 0) return id; }
    return el[el.length - 1][0];
  }

  /** Tier shares of a copy-weighted roll at shop level `maxTier` (current remaining copies; `owner` as in roll). */
  tierShares(maxTier, owner = null) {
    const t = {};
    let total = 0;
    for (const [, e] of this.entries) {
      if (e.tier > maxTier || e.left <= 0) continue;
      if (e.pick && (owner == null || e.owner !== owner)) continue;
      t[e.tier] = (t[e.tier] || 0) + e.left;
      total += e.left;
    }
    const out = {};
    for (const k of Object.keys(t)) out[k] = total > 0 ? t[k] / total : 0;
    return out;
  }

  /**
   * Item roll for the shop's item slot: tier by the chess tier shares at this level, uniform item within the tier,
   * falling back to lower tiers when a tier has no item. Returns an item id or null.
   */
  rollItem(rng, maxTier) {
    const shares = this.tierShares(maxTier);
    const tiers = Object.keys(shares).map(Number).sort((a, b) => a - b);
    let tier = null;
    if (tiers.length) {
      let r = rng();
      for (const t of tiers) { r -= shares[t]; if (r < 0) { tier = t; break; } }
      if (tier == null) tier = tiers[tiers.length - 1];
    } else {
      tier = 1 + Math.floor(rng() * Math.max(1, maxTier));
    }
    for (let t = tier; t >= 1; t--) {
      const list = this.gd.shopItemsByTier[t];
      if (list && list.length) return list[Math.floor(rng() * list.length)];
    }
    for (let t = tier + 1; t <= 6; t++) {
      const list = this.gd.shopItemsByTier[t];
      if (list && list.length) return list[Math.floor(rng() * list.length)];
    }
    return null;
  }

  /** { baseId: left } snapshot (tests / diagnostics). */
  snapshot() {
    const o = {};
    for (const [id, e] of this.entries) o[id] = e.left;
    return o;
  }

  totalLeft() {
    let n = 0;
    for (const e of this.entries.values()) n += e.left;
    return n;
  }
}
