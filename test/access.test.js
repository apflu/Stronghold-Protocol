// Invite-only access (server/access.js + server/index.js): the store, the gate, invite links, ≤ 3 devices, one nickname.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AccessStore, MAX_DEVICES, COOKIE_NAME, splitCode, parseCookies } from '../server/access.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-access-')), 'access.json');

test('store: an invite takes up to 3 devices; codes are <id>.<secret> and only hashes are kept', () => {
  const file = tmpFile();
  const s = new AccessStore(file);
  const { id, code } = s.createInvite('月鸦');
  const p = splitCode(code);
  assert.ok(p && p.id === id && p.secret.length >= 43, 'a 256-bit secret after the id');
  assert.ok(!fs.readFileSync(file, 'utf8').includes(p.secret), 'the secret is never stored');
  const cookies = [];
  for (let i = 0; i < MAX_DEVICES; i++) {
    const r = s.claim(code, { addr: `10.0.0.${i}` });
    assert.ok(r.ok, `device ${i + 1}`);
    cookies.push(r.cookie);
    assert.ok(!fs.readFileSync(file, 'utf8').includes(splitCode(r.cookie).secret));
  }
  assert.equal(s.claim(code).error, 'full', 'a 4th device is refused');
  assert.ok(s.claim(code, { current: cookies[0] }).reused, 'a device that already holds the invite keeps its cookie');
  assert.equal(s.verify(cookies[1]).invite.id, id);
  assert.equal(s.claim(`${id}.${'A'.repeat(43)}`).error, 'bad', 'a wrong secret');
  assert.equal(s.claim('nonsense').error, 'bad');
  assert.equal(s.verify(`${splitCode(cookies[0]).id}.${'B'.repeat(43)}`), null, 'a forged device secret');
  // kick frees a slot; a second process (the CLI) sees the same file
  assert.ok(s.removeDevice(splitCode(cookies[2]).id));
  assert.equal(s.verify(cookies[2]), null);
  const cli = new AccessStore(file);
  assert.ok(cli.claim(code).ok, 'the freed slot');
  cli.revokeInvite(id);
  s.reload(true);
  assert.equal(s.verify(cookies[0]), null, 'a revoked invite drops every device');
  assert.equal(s.claim(code).error, 'revoked');
  assert.deepEqual(parseCookies(`a=1; ${COOKIE_NAME}=x.y; b=%41`), { a: '1', [COOKIE_NAME]: 'x.y', b: 'A' });
});

const get = (port, p, cookie = null) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path: p, headers: cookie ? { cookie } : {} }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
  });
  req.on('error', reject);
});
const cookieOf = (res) => String(res.headers['set-cookie']?.[0] || '').split(';')[0];
/** The confirm button of an invite page: POST /invite { invite } (the only request that registers a device). */
const post = (port, code, cookie = null) => new Promise((resolve, reject) => {
  const body = `invite=${encodeURIComponent(code)}`;
  const req = http.request({ host: '127.0.0.1', port, path: '/invite', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body), ...(cookie ? { cookie } : {}) } }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
  });
  req.on('error', reject);
  req.end(body);
});
/** Open an invite link and press its button → the response of the POST. */
const join = async (port, code, cookie = null) => {
  const page = await get(port, `/?invite=${encodeURIComponent(code)}`, cookie);
  assert.equal(page.status, 200, 'the link shows the confirm page');
  assert.equal(page.headers['set-cookie'], undefined, 'opening the link sets no cookie');
  return post(port, code, cookie);
};
const hello = async (port, cookie, name) => {
  const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`, { wsOptions: cookie ? { headers: { cookie } } : {} });
  const w = await c.hello(name);
  return { c, w };
};

test('server (SP_ACCESS=invite): the gate, invite links, the WebSocket and one nickname per invite', async () => {
  const file = tmpFile();
  const store = new AccessStore(file);
  const { code } = store.createInvite('test');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, access: 'invite', accessFile: file, accessTitle: '私有实例', accessMessage: '请联系管理员获得邀请链接' });
  try {
    const port = srv.port;
    assert.equal((await get(port, '/')).status, 403, 'no cookie: the invite-only page');
    const page = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b)); }));
    assert.match(page, /私有实例/);
    assert.match(page, /请联系管理员获得邀请链接/, 'the host\'s own words (SP_ACCESS_TITLE / SP_ACCESS_MESSAGE)');
    assert.equal((await get(port, '/js/main.js')).status, 403, 'static files too');
    assert.equal((await get(port, '/healthz')).status, 200, '/healthz stays open');
    assert.equal((await get(port, '/?invite=bad.code')).status, 403);
    // opening the link registers nothing (link previews / safety scanners fetch it): only the button's POST does
    for (let i = 0; i < 5; i++) assert.equal((await get(port, `/?invite=${encodeURIComponent(code)}`)).status, 200);
    assert.equal(new AccessStore(file).invite(splitCode(code).id).devices.length, 0, 'no device from page views');
    assert.equal((await post(port, 'bad.code')).status, 403);
    const a = await join(port, code);
    assert.equal(a.status, 303);
    assert.equal(a.headers.location, '/');
    assert.match(String(a.headers['set-cookie']), /HttpOnly; SameSite=Lax/);
    const ca = cookieOf(a);
    assert.equal((await get(port, '/', ca)).status, 200, 'with the cookie the site opens');
    const cb = cookieOf(await join(port, code));
    const again = await get(port, `/?invite=${encodeURIComponent(code)}`, ca);
    assert.equal(again.status, 302, 'a device already on the invite goes straight on');
    assert.equal(again.headers['set-cookie'], undefined);
    assert.notEqual(cb, ca, 'a second device gets its own cookie');
    await assert.rejects(TestClient.connect(`ws://127.0.0.1:${port}/ws`), 'the WebSocket needs the cookie too');
    // one nickname: the first device's, adopted by the others; a rename on any device moves the invite's
    const d1 = await hello(port, ca, 'Alice');
    assert.equal(d1.w.name, 'Alice');
    const d2 = await hello(port, cb, 'Bob');
    assert.equal(d2.w.name, 'Alice', 'another device of the invite plays as Alice');
    const renamed = await d2.c.hello('Carol');
    assert.equal(renamed.name, 'Carol', 'a rename on a live connection');
    await d1.c.close();
    const d1b = await hello(port, ca, 'Alice');
    assert.equal(d1b.w.name, 'Carol', 'the first device follows the rename on its next connection');
    await d2.c.close();
    await d1b.c.close();
  } finally {
    await srv.close();
  }
});

test('server (SP_ACCESS=watch): nobody is blocked; open by default', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, access: 'watch', accessFile: tmpFile() });
  try {
    assert.equal((await get(srv.port, '/')).status, 200);
    const { c, w } = await hello(srv.port, null, 'Guest');
    assert.equal(w.name, 'Guest');
    await c.close();
  } finally { await srv.close(); }
  const open = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try { assert.equal((await get(open.port, '/')).status, 200); } finally { await open.close(); }
});

test('server (SP_ACCESS=host): everyone plays, only invited devices create rooms — enforced by the server', async () => {
  const file = tmpFile();
  const { code } = new AccessStore(file).createInvite('host');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, access: 'host', accessFile: file, accessMessage: '私有实例，请联系管理员' });
  try {
    const port = srv.port;
    assert.equal((await get(port, '/')).status, 200, 'the site is open');
    const cm = cookieOf(await join(port, code));
    const member = await hello(port, cm, 'Host');
    assert.equal(member.w.member, true);
    const guest = await hello(port, null, 'Guest');
    assert.equal(guest.w.member, false, 'welcome tells the client (it greys out room creation)');
    assert.equal(guest.w.note, '私有实例，请联系管理员', 'and the host\'s note for guests');
    assert.equal(member.w.note, undefined);
    // a guest's room.create is refused whatever the client sends (solo included)
    for (const mode of ['coop', 'solo']) {
      const r = await guest.c.request({ t: 'room.create', mode, difficulty: 'NORMAL' });
      assert.equal(r.t, 'error');
      assert.equal(r.code, 'FORBIDDEN', mode);
    }
    // the invited player creates; the guest joins by the code
    assert.equal((await member.c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const room = (await member.c.waitFor('room.state')).code;
    assert.equal((await guest.c.request({ t: 'room.join', code: room })).t, 'ok', 'a guest joins an invited player\'s room');
    await guest.c.request({ t: 'room.leave' });
    // code guessing: a guest network gets 10 wrong codes per minute
    let last = null;
    for (let i = 0; i < 11; i++) last = await guest.c.request({ t: 'room.join', code: i < 10 ? 'ZZZZ' : room });
    assert.equal(last.code, 'RATE', 'the 11th try within a minute is refused, even with the right code');
    await member.c.close();
    await guest.c.close();
  } finally { await srv.close(); }
});
