// tools/access.mjs — manage the invite-only access store (server/access.js; SP_ACCESS=invite).
//
// Usage:
//   node tools/access.mjs invite [note]        a new invite: prints its link (shown once — only a hash is stored)
//   node tools/access.mjs list                 invites with their nickname, devices and last use
//   node tools/access.mjs revoke <inviteId>    disable an invite (all its devices)
//   node tools/access.mjs kick <deviceId>      drop one device (frees one of the invite's 3 slots)
//   options: --file <store> (default $SP_ACCESS_FILE, else $SP_LOG_DIR/access.json, else ./logs/access.json)
//            --base <url>   the site's address for printed links (default $SP_PUBLIC_URL)
// The running server picks changes up within a few seconds (it re-reads the file when it changes).

import path from 'node:path';
import { AccessStore, MAX_DEVICES } from '../server/access.js';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--file', '--base'].includes(argv[i - 1])));
const file = opt('--file', process.env.SP_ACCESS_FILE || (process.env.SP_LOG_DIR ? path.join(process.env.SP_LOG_DIR, 'access.json') : path.resolve('logs', 'access.json')));
const base = String(opt('--base', process.env.SP_PUBLIC_URL || '')).replace(/\/+$/, '');
const store = new AccessStore(file);
const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-');

const cmd = pos[0] || 'list';
if (cmd === 'invite') {
  const { id, code } = store.createInvite(pos.slice(1).join(' '));
  console.log(`invite ${id}${pos[1] ? ` (${pos.slice(1).join(' ')})` : ''} — up to ${MAX_DEVICES} devices`);
  console.log(base ? `${base}/?invite=${code}` : `/?invite=${code}   (add the site address, or pass --base https://…)`);
} else if (cmd === 'list') {
  if (!store.data.invites.length) console.log(`no invites in ${file}`);
  for (const inv of store.data.invites) {
    const live = inv.devices.filter((d) => !d.revoked);
    console.log(`${inv.id}${inv.revoked ? ' [停用]' : ''}  昵称 ${inv.name ?? '(未使用)'}  备注 ${inv.note || '-'}  设备 ${live.length}/${inv.maxDevices || MAX_DEVICES}  创建 ${fmt(inv.createdAt)}`);
    for (const d of inv.devices) console.log(`    ${d.id}${d.revoked ? ' [已移除]' : ''}  最近 ${fmt(d.lastSeen)}  首次 ${fmt(d.createdAt)}  ${d.addr || ''}  ${(d.ua || '').slice(0, 60)}`);
  }
} else if (cmd === 'revoke') {
  console.log(pos[1] && store.revokeInvite(pos[1]) ? `invite ${pos[1]} disabled` : `no invite ${pos[1] ?? ''}`);
} else if (cmd === 'kick') {
  console.log(pos[1] && store.removeDevice(pos[1]) ? `device ${pos[1]} removed` : `no device ${pos[1] ?? ''}`);
} else {
  console.error('usage: node tools/access.mjs invite [note] | list | revoke <inviteId> | kick <deviceId>');
  process.exit(1);
}
