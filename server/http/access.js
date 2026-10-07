// server/http/access.js — invite-only access on the HTTP side (SP_ACCESS; the store and its codes: server/access.js):
// (i18n-ignore-file: the invite / gate pages are served before any language is chosen, and SP_ACCESS_TITLE /
// SP_ACCESS_MESSAGE are the host's own words — docs/I18N.md)
//
//   * SP_ACCESS = open (default: nothing here runs) | watch (nobody is blocked; what would be is logged as
//     'access.deny', once per address per hour) | host (the site is open, only invited devices create rooms — solo
//     included — enforced by the lobby: membersCreateOnly; welcome.member greys out room creation in the client, and
//     guests see SP_ACCESS_MESSAGE next to it) | invite (only invited devices get pages, static files and the WebSocket;
//     everyone else gets the 403 page with SP_ACCESS_TITLE / SP_ACCESS_MESSAGE). /healthz is never gated.
//   * the store: SP_ACCESS_FILE, else SP_LOG_DIR/access.json (without either, access stays open); tools/access.mjs edits
//     the same file and the server picks the change up within seconds.
//   * GET /?invite=<code>: a device already on that invite goes straight on (302 /); any other gets a confirm page whose
//     button POSTs the code to /invite — the only request that registers a device (sets the HttpOnly cookie, 303 /).
//     Chat apps fetch links for their previews / safety checks (QQ's scanner took a device slot of a fresh invite
//     within 10 s), and those never press the button. A view is logged as 'access.view', a claim as 'access.claim'.
//   * the WebSocket upgrade: the cookie's invite + device ride on the request (`req.spAccess` → net.js session.access);
//     every device of one invite plays under the invite's nickname (nameFor: the first device's, or the latest rename).

import path from 'node:path';
import { clientAddress } from '../net.js';
import { eventLog } from '../match/eventlog.js';
import { AccessStore, COOKIE_NAME, COOKIE_MAX_AGE_S, MAX_DEVICES, parseAccessMode, parseCookies } from '../access.js';
import { sendError } from './common.js';
import { parseTrustProxy } from './config.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The invite link's confirm page: one button that POSTs the code to /invite. */
function invitePage(code, maxDevices) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>加入 · 卫戍协议：盟约</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111614;color:#d8e3de;font:16px/1.6 "Noto Sans SC",system-ui,sans-serif}
main{border:1px solid #2c3a35;padding:32px 40px;max-width:520px;text-align:center}h1{margin:0 0 8px;color:#4ed8af;font-size:28px;letter-spacing:2px}
p{margin:8px 0}button{margin-top:16px;padding:10px 32px;font:inherit;font-weight:700;color:#0b1210;background:#4ed8af;border:0;cursor:pointer}
button:focus-visible{outline:2px solid #d8e3de;outline-offset:2px}</style></head><body><main><h1>卫戍协议：盟约</h1>
<p>你收到了一个邀请链接。点击下方按钮，把这台设备加入邀请。</p>
<p style="opacity:.6">每个邀请最多 ${maxDevices} 台设备；加入后这台设备以后直接访问即可。</p>
<form method="post" action="/invite"><input type="hidden" name="invite" value="${escapeHtml(code)}"><button type="submit">加入 · Join</button></form>
</main></body></html>`;
}

const inviteRefusal = (r) => (r && r.error === 'full' ? `这个邀请链接已经在 ${MAX_DEVICES} 台设备上使用过了，无法再添加新设备。需要更换设备请联系管理员。`
  : r && r.error === 'revoked' ? '这个邀请链接已被管理员停用。' : '邀请链接无效，请确认链接完整（复制时不要漏掉末尾）。');

const uaOf = (req) => String(req.headers['user-agent'] || '').slice(0, 160);

/**
 * The access gate of one server, or null when SP_ACCESS is open (or has no store).
 * @param {{ access?: string, accessFile?: string, accessTitle?: string, accessMessage?: string, logDir?: string,
 *           trustProxy?: 'auto' | boolean }} opts startServer() options (they win over SP_ACCESS* / SP_LOG_DIR)
 * @param {{ log: object }} deps
 * @returns {null | { mode: string, store: AccessStore, netOptions: object, lobbyOptions: object,
 *   handle: (req, res, parts: { rawPath: string, query: string }) => Promise<boolean>, admit: (req) => boolean }}
 */
export function createAccess(opts, { log }) {
  const mode = parseAccessMode(opts.access ?? process.env.SP_ACCESS);
  if (mode === 'open') return null;
  const logDir = opts.logDir ?? process.env.SP_LOG_DIR ?? '';
  const file = opts.accessFile ?? process.env.SP_ACCESS_FILE ?? (logDir ? path.join(logDir, 'access.json') : '');
  if (!file) { log.warn('[access] SP_ACCESS needs SP_ACCESS_FILE (or SP_LOG_DIR) — access stays open'); return null; }
  const store = new AccessStore(file);
  log.info(`[access] ${mode} · ${file}`);
  const trustProxy = opts.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY);
  const gate = mode === 'invite';
  // the page an uninvited visitor sees (SP_ACCESS_TITLE / SP_ACCESS_MESSAGE: the host's own words)
  const message = String(opts.accessMessage ?? process.env.SP_ACCESS_MESSAGE ?? '').trim();
  const gateTitle = String(opts.accessTitle ?? process.env.SP_ACCESS_TITLE ?? '').trim() || '本站仅限受邀玩家 · Invite only';
  const gateText = message || '请使用管理员发给你的邀请链接打开本站。打开过一次之后，这台设备以后直接访问即可。';
  const cookieOf = (req) => parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
  /** The invite + device of a request's cookie, or null. */
  const identify = (req) => store.verify(cookieOf(req));
  const addrOf = (req) => clientAddress(req, trustProxy).ip;

  const deniedAt = new Map(); // one 'access.deny' line per address per hour
  const noteDenied = (req, what) => {
    if (!eventLog.enabled || mode === 'host') return; // host mode: guests are welcome (they only cannot create)
    const addr = addrOf(req);
    const now = Date.now();
    if (now - (deniedAt.get(addr) || 0) < 3600_000) return;
    deniedAt.set(addr, now);
    if (deniedAt.size > 10_000) for (const k of deniedAt.keys()) { deniedAt.delete(k); if (deniedAt.size <= 8000) break; }
    eventLog.write({ type: 'access.deny', mode, what, addr, ua: uaOf(req) });
  };

  const netOptions = {
    // every device of one invite plays under one nickname: the invite's (the first device's, or the latest rename)
    nameFor: (acc, name, { repeat }) => {
      const inv = store.invite(acc.invite.id) || acc.invite;
      if (!inv.name || repeat) { if (inv.name !== name) store.setName(inv.id, name); return name; }
      return inv.name;
    },
  };
  const lobbyOptions = {};
  if (mode === 'host') {
    netOptions.memberFlag = true; // welcome.member: the lobby greys out room creation for guests
    if (message) netOptions.guestNote = gateText; // shown to guests there
    lobbyOptions.membersCreateOnly = true; // enforced by the lobby (server/lobby.js create), never by the client
  }

  /** POST /invite (the confirm page's button, body invite=<code>): register this device, set its cookie, 303 to /. */
  async function claimInvite(req, res) {
    let body = '';
    try {
      for await (const chunk of req) { body += chunk; if (body.length > 2048) { sendError(req, res, 413, '请求过大 · Payload too large'); return; } }
    } catch { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    const code = new URLSearchParams(body).get('invite') || '';
    const addr = addrOf(req);
    const r = store.claim(code, { addr, ua: req.headers['user-agent'] || null, current: cookieOf(req) });
    if (!r || !r.ok) { sendError(req, res, 403, '邀请链接无法使用 · Invite not usable', inviteRefusal(r)); return; }
    if (!r.reused && eventLog.enabled) eventLog.write({ type: 'access.claim', invite: r.invite.id, note: r.invite.note, devices: r.invite.devices.filter((d) => !d.revoked).length, addr, ua: uaOf(req) });
    const https = String(req.headers['x-forwarded-proto'] || '').includes('https') || String(req.headers['cf-visitor'] || '').includes('https');
    res.writeHead(303, {
      Location: '/',
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(r.cookie)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`,
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  /** The HTTP side (routes.js, right after the URL parses). Returns true when the request was answered here. */
  async function handle(req, res, parts) {
    // the invite confirm button: the only POST the site takes
    if (req.method === 'POST' && parts.rawPath === '/invite') { await claimInvite(req, res); return true; }
    if (req.method !== 'GET' && req.method !== 'HEAD') return false; // routes.js answers 405
    if (parts.rawPath === '/healthz') return false;
    const code = new URLSearchParams(parts.query || '').get('invite');
    if (code) {
      // opening the link registers nothing: a device already on this invite goes on, any other gets the confirm page
      const r = store.peek(code, { current: cookieOf(req) });
      if (r && r.ok && r.reused) { res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); res.end(); return true; }
      if (!r || !r.ok) { sendError(req, res, 403, '邀请链接无法使用 · Invite not usable', inviteRefusal(r)); return true; }
      if (eventLog.enabled) eventLog.write({ type: 'access.view', invite: r.invite.id, note: r.invite.note, addr: addrOf(req), ua: uaOf(req) });
      const page = Buffer.from(invitePage(code, r.invite.maxDevices || MAX_DEVICES));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      res.end(req.method === 'HEAD' ? undefined : page);
      return true;
    }
    if (identify(req)) return false;
    noteDenied(req, parts.rawPath);
    if (!gate) return false; // watch / host: logged (watch), served
    sendError(req, res, 403, gateTitle, gateText);
    return true;
  }

  /** The WebSocket upgrade (websocket.js): tags the request with its invite; false = refuse it (403). */
  function admit(req) {
    const who = identify(req);
    if (who) { req.spAccess = who; return true; }
    noteDenied(req, '/ws');
    return !gate;
  }

  return { mode, store, netOptions, lobbyOptions, handle, admit };
}
