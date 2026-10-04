// The 轮回之终末 box (SP_BOOST): room.boost in a lobby room, shown on the seat, carried into the match's seats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const connect = async (port, name) => {
  const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`);
  await c.hello(name);
  return c;
};

test('SP_BOOST on: a player ticks the box in the room, everyone sees it, the match gets it', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, boost: true });
  try {
    const a = await connect(srv.port, 'A');
    assert.equal((await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const st = await a.waitFor('room.state');
    assert.deepEqual(st.boostable, { funds: 4, shopLuck: 0.4 }, 'the room offers the box, with the numbers');
    const b = await connect(srv.port, 'B');
    assert.equal((await b.request({ t: 'room.join', code: st.code })).t, 'ok');
    assert.equal((await b.request({ t: 'room.boost', on: true })).t, 'ok');
    const seen = await a.waitFor('room.state', (s) => s.seats.some((x) => x && x.name === 'B' && x.boost));
    assert.ok(!seen.seats.find((x) => x && x.name === 'A').boost, 'only B ticked it');
    await a.close();
    await b.close();
  } finally { await srv.close(); }
});

test('SP_BOOST off: no box, room.boost refused', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, boost: false });
  try {
    const a = await connect(srv.port, 'A');
    await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await a.waitFor('room.state');
    assert.equal(st.boostable, undefined);
    assert.equal((await a.request({ t: 'room.boost', on: true })).t, 'error');
    await a.close();
  } finally { await srv.close(); }
});
