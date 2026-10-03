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
    const a = await get(port, `/?invite=${encodeURIComponent(code)}`);
    assert.equal(a.status, 302);
    assert.equal(a.headers.location, '/');
    assert.match(String(a.headers['set-cookie']), /HttpOnly; SameSite=Lax/);
    const ca = cookieOf(a);
    assert.equal((await get(port, '/', ca)).status, 200, 'with the cookie the site opens');
    const cb = cookieOf(await get(port, `/?invite=${encodeURIComponent(code)}`));
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
