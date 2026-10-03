import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { LiveFeed, PublicTimingState, sessionDate } from '../lib/public-live.mjs';
const now = Date.parse('2026-10-03T08:30:00Z');
const initial = {
  SessionInfo: { Key: 12345, Name: 'Practice 1', StartDate: '2026-10-03T16:00:00', EndDate: '2026-10-03T17:00:00', GmtOffset: '08:00:00', Meeting: { Country: { Name: 'Test' } } },
  SessionStatus: { Status: 'Started' },
  DriverList: { '4': { Tla: 'NOR', FullName: 'Lando Norris', TeamName: 'McLaren', TeamColour: 'FF8700' }, '16': { Tla: 'LEC', TeamColour: 'FF0000' } },
  TimingData: { Lines: { '4': { Position: '2' }, '16': { Position: '1' } } },
};
test('timezone conversion handles source offsets and UTC', () => {
  assert.equal(sessionDate('2026-10-03T16:00:00', '08:00:00'), '2026-10-03T08:00:00.000Z');
  assert.equal(sessionDate('2026-10-03T16:00:00Z', '08:00:00'), '2026-10-03T16:00:00.000Z');
});
test('partial updates preserve driver metadata, ignore older positions and reset on session change', () => {
  const timing = new PublicTimingState(); timing.bootstrap(initial);
  timing.apply('DriverList', { '4': { Tla: 'NOR' } }, '2026-10-03T08:31:00Z');
  timing.apply('TimingData', { Lines: { '4': { Position: '1' }, '16': { Position: '2' } } }, '2026-10-03T08:31:00Z');
  timing.apply('TimingData', { Lines: { '4': { Position: '8' } } }, '2026-10-03T08:30:00Z');
  const state = timing.store.snapshot();
  assert.equal(state.drivers[0].team_colour, 'FF8700');
  assert.equal(state.drivers[0].position, 1);
  assert.equal(state.changes.length, 1);
  timing.apply('SessionInfo', { ...initial.SessionInfo, Key: 12346 });
  assert.deepEqual(timing.store.snapshot().drivers, []);
});
test('ended and stale sessions are not live; reconnect snapshot replaces old state', () => {
  const timing = new PublicTimingState(); timing.bootstrap(initial);
  assert.equal(timing.state(now), 'connected');
  assert.equal(timing.state(now + 86400000), 'waiting');
  timing.apply('SessionStatus', { Status: 'Aborted' }); assert.equal(timing.state(now), 'suspended');
  timing.apply('SessionStatus', { Status: 'Ends' }); assert.equal(timing.state(now), 'ended');
  timing.bootstrap({ ...initial, TimingData: { Lines: { '4': { Position: '7' } } } });
  assert.equal(timing.store.snapshot().drivers.find(d => d.driver_number === 4).position, 7);
});
test('public transport uses no credentials, parses split frames and handles disconnect', async t => {
  let socket;
  const feed = new LiveFeed({ now: () => now, fetcher: async (url, options) => {
    assert.ok(!options.headers?.Authorization); assert.ok(!options.body);
    return Response.json({ connectionToken: 'temporary-routing-id', availableTransports: [{ transport: 'WebSockets' }] });
  }, socketFactory: () => {
    socket = new EventEmitter(); socket.terminate = () => socket.emit('close');
    socket.send = raw => {
      const message = JSON.parse(raw.slice(0, -1));
      queueMicrotask(() => {
        if (message.protocol) socket.emit('message', Buffer.from('{}\x1e'));
        else if (message.target === 'Subscribe') {
          const response = JSON.stringify({ type: 3, invocationId: '1', result: initial }) + '\x1e';
          socket.emit('message', Buffer.from(response.slice(0, 20))); socket.emit('message', Buffer.from(response.slice(20)));
        }
      });
    };
    queueMicrotask(() => socket.emit('open')); return socket;
  } });
  t.after(() => feed.stop());
  const observed = new EventEmitter(); const ready = once(observed, 'ready');
  const unsubscribe = feed.subscribe(state => { if (state.status === 'connected') observed.emit('ready', state); });
  const [state] = await ready;
  assert.equal(state.drivers.length, 2); assert.equal(state.requiresAccount, false);
  assert.ok(!JSON.stringify(state).includes('temporary-routing-id'));
  socket.emit('message', Buffer.from(JSON.stringify({ type: 1, target: 'feed', arguments: ['TimingData', { Lines: { '4': { Position: '1' } } }, '2026-10-03T08:31:00Z'] }) + '\x1e'));
  assert.equal(feed.snapshot().drivers.find(d => d.driver_number === 4).position, 1);
  socket.emit('close'); assert.equal(feed.snapshot().status, 'reconnecting');
  unsubscribe(); assert.equal(feed.status, 'idle');
});
test('refused anonymous access stops without paid fallback', async t => {
  let requests = 0;
  const feed = new LiveFeed({ fetcher: async () => { requests++; return new Response('', { status: 403 }); } });
  t.after(() => feed.stop());
  const observed = new EventEmitter(); const refused = once(observed, 'refused');
  const unsubscribe = feed.subscribe(state => { if (state.status === 'unavailable') observed.emit('refused'); });
  await refused; assert.equal(requests, 1); assert.equal(feed.retry, undefined); unsubscribe();
});
