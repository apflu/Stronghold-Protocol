// server/access.js — invite-only access (SP_ACCESS = open | watch | host | invite; SP_ACCESS_FILE = the store).
//
// One invite = one player: its link (`/?invite=<code>`) can be opened on up to MAX_DEVICES devices; each device gets an
// HttpOnly cookie (COOKIE_NAME) and never logs in again. Opening the link only shows a confirm page (peek); the device is
// registered when its button is pressed (a POST: claim), so chat link previews and safety scanners take no slot. Every
// device of an invite plays under the same nickname: the first device's, then whatever any of them renames to
// (server/http/access.js nameFor → net.js onHelloMsg).
//
// Codes and cookies are `<id>.<secret>`: a public id (lookup, logs, the CLI) and a 256-bit random secret of which only a
// SHA-256 is stored (a leaked store grants nothing; comparisons are constant-time). Ids carry 72 random bits.
//
// The store is a JSON file shared with the CLI (tools/access.mjs): every read checks the file's mtime (at most once per
// RELOAD_MS) and every change re-reads it first, then writes atomically (tmp + rename). Device `lastSeen` is kept in
// memory and flushed at most once per SEEN_FLUSH_MS.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const COOKIE_NAME = 'sp_access';
export const MAX_DEVICES = 3;
export const COOKIE_MAX_AGE_S = 400 * 24 * 3600; // browsers cap a cookie's lifetime at 400 days
const ID_BYTES = 9;
const SECRET_BYTES = 32;
const RELOAD_MS = 2000;
const SEEN_FLUSH_MS = 5 * 60 * 1000;

const b64url = (buf) => buf.toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,64}$/;

/** `<id>.<secret>` → { id, secret } or null (shape only). */
export function splitCode(code) {
  const s = typeof code === 'string' ? code.trim() : '';
  const i = s.indexOf('.');
  if (i < 0) return null;
  const id = s.slice(0, i);
  const secret = s.slice(i + 1);
  return ID_RE.test(id) && SECRET_RE.test(secret) ? { id, secret } : null;
}

function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function newCode(prefix) {
  const id = `${prefix}${b64url(crypto.randomBytes(ID_BYTES))}`;
  const secret = b64url(crypto.randomBytes(SECRET_BYTES));
  return { id, secret, code: `${id}.${secret}`, hash: sha256(secret) };
}

/** Cookie header → { name: value }. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || Object.hasOwn(out, k)) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

/**
 * SP_ACCESS → 'open' | 'watch' | 'host' | 'invite'. host: the site is open, only invited devices create rooms (solo runs
 * included) — everyone else joins an invited player's room by its code (server/lobby.js create).
 */
export function parseAccessMode(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'invite' || s === 'watch' || s === 'host' ? s : 'open';
}

export class AccessStore {
  /** @param {string} file the JSON store (created on the first change) */
  constructor(file) {
    this.file = file;
    this.data = { v: 1, invites: [] };
    this.mtime = -1;
    this.checkedAt = -Infinity;
    this.seen = new Map(); // deviceId → ms (pending lastSeen)
    this.seenFlushedAt = Date.now();
    this.reload(true);
  }

  /** Re-read the file when it changed (throttled unless `force`). */
  reload(force = false) {
    const now = Date.now();
    if (!force && now - this.checkedAt < RELOAD_MS) return;
    this.checkedAt = now;
    let st;
    try { st = fs.statSync(this.file); } catch { return; }
    if (!force && st.mtimeMs === this.mtime) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d && Array.isArray(d.invites)) { this.data = d; this.mtime = st.mtimeMs; }
    } catch { /* a half-written file from an older writer: keep the last good copy */ }
  }

  /** Apply `fn` to a fresh copy of the store and write it atomically. */
  change(fn) {
    this.reload(true);
    const out = fn(this.data);
    this.flushSeen(true, false);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
    try { this.mtime = fs.statSync(this.file).mtimeMs; } catch { /* ignore */ }
    return out;
  }

  invite(id) { return this.data.invites.find((x) => x.id === id) || null; }

  /** A new invite → { id, code } (the code is shown once: only its hash is stored). */
  createInvite(note = '') {
    const c = newCode('i');
    this.change((d) => {
      d.invites.push({ id: c.id, hash: c.hash, note: String(note || '').slice(0, 80), name: null, createdAt: new Date().toISOString(), revoked: false, maxDevices: MAX_DEVICES, devices: [] });
    });
    return { id: c.id, code: c.code };
  }

  /**
   * A device opens an invite link → { ok, cookie, invite } | { error: 'bad' | 'revoked' | 'full' }.
   * `current`: the device's present cookie — a device that already belongs to this invite keeps it (no second slot).
   */
  claim(code, { addr = null, ua = null, current = null } = {}) {
    const p = splitCode(code);
    if (!p) return { error: 'bad' };
    this.reload();
    const inv = this.invite(p.id);
    if (!inv || !sameHash(inv.hash, sha256(p.secret))) return { error: 'bad' };
    if (inv.revoked) return { error: 'revoked' };
    const mine = current ? this.verify(current) : null;
    if (mine && mine.invite.id === inv.id) return { ok: true, cookie: current, invite: mine.invite, reused: true };
    if (inv.devices.filter((x) => !x.revoked).length >= (inv.maxDevices || MAX_DEVICES)) return { error: 'full' };
    const c = newCode('d');
    let res = null;
    this.change((d) => {
      const live = d.invites.find((x) => x.id === inv.id);
      if (!live || live.revoked) { res = { error: 'revoked' }; return; }
      if (live.devices.filter((x) => !x.revoked).length >= (live.maxDevices || MAX_DEVICES)) { res = { error: 'full' }; return; }
      live.devices.push({ id: c.id, hash: c.hash, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), addr, ua: ua ? String(ua).slice(0, 160) : null, revoked: false });
      res = { ok: true, cookie: c.code, invite: live };
    });
    return res;
  }

  /**
   * Check an invite link without claiming a device → { ok, invite, reused } | { error: 'bad' | 'revoked' | 'full' }.
   * The link page shows a confirm button (server/http/access.js): a link preview / safety scanner that only fetches the
   * page takes no device slot; `claim` runs when the button is pressed.
   */
  peek(code, { current = null } = {}) {
    const p = splitCode(code);
    if (!p) return { error: 'bad' };
    this.reload();
    const inv = this.invite(p.id);
    if (!inv || !sameHash(inv.hash, sha256(p.secret))) return { error: 'bad' };
    if (inv.revoked) return { error: 'revoked' };
    const mine = current ? this.verify(current) : null;
    if (mine && mine.invite.id === inv.id) return { ok: true, invite: mine.invite, reused: true };
    if (inv.devices.filter((x) => !x.revoked).length >= (inv.maxDevices || MAX_DEVICES)) return { error: 'full' };
    return { ok: true, invite: inv, reused: false };
  }

  /** A device cookie → { invite, device } while both are live, else null. */
  verify(cookie) {
    const p = splitCode(cookie);
    if (!p) return null;
    this.reload();
    const h = sha256(p.secret);
    for (const inv of this.data.invites) {
      if (inv.revoked) continue;
      const dev = inv.devices.find((x) => x.id === p.id);
      if (!dev) continue;
      if (dev.revoked || !sameHash(dev.hash, h)) return null;
      this.seen.set(dev.id, Date.now());
      this.flushSeen();
      return { invite: inv, device: dev };
    }
    return null;
  }

  /** The invite's shared nickname (null: none yet). */
  setName(inviteId, name) {
    const inv = this.invite(inviteId);
    if (!inv || inv.name === name) return;
    this.change((d) => { const x = d.invites.find((i) => i.id === inviteId); if (x) x.name = name; });
  }

  /** Write the pending lastSeen times (at most once per SEEN_FLUSH_MS unless forced). */
  flushSeen(force = false, write = true) {
    if (!this.seen.size) return;
    if (!force && Date.now() - this.seenFlushedAt < SEEN_FLUSH_MS) return;
    this.seenFlushedAt = Date.now();
    const pending = this.seen;
    this.seen = new Map();
    const apply = (d) => { for (const inv of d.invites) for (const dev of inv.devices) if (pending.has(dev.id)) dev.lastSeen = new Date(pending.get(dev.id)).toISOString(); };
    if (write) { try { this.change(apply); } catch { /* next time */ } } else apply(this.data);
  }

  revokeInvite(id) { return this.change((d) => { const x = d.invites.find((i) => i.id === id); if (x) x.revoked = true; return !!x; }); }

  removeDevice(id) {
    return this.change((d) => {
      for (const inv of d.invites) { const dev = inv.devices.find((x) => x.id === id); if (dev) { dev.revoked = true; return true; } }
      return false;
    });
  }
}
