import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareEvents, stateAt, createDemo } from '../public/replay.js';

test('replay uses timestamps, ignores malformed records and never reveals future positions', () => {
  const drivers = [{ driver_number: 1 }, { driver_number: 2 }, { driver_number: 3 }];
  const events = prepareEvents([
    { driver_number: 1, position: 2, date: '2024-01-01T00:00:10Z' },
    { driver_number: 1, position: 1, date: '2024-01-01T00:00:00Z' },
    { driver_number: 2, position: 2, date: '2024-01-01T00:00:00Z' },
    { driver_number: 2, position: 1, date: '2024-01-01T00:00:10Z' },
    { driver_number: 3, position: 0, date: '2024-01-01T00:00:01Z' },
    { driver_number: 3, position: 3, date: 'invalid' },
  ]);
  assert.equal(events.length, 4);
  const initial = stateAt(drivers, events, Date.parse('2024-01-01T00:00:05Z'));
  assert.deepEqual(initial.map(d => d.position), [1, 2, null]);
  const later = stateAt(drivers, events, Date.parse('2024-01-01T00:00:10Z'));
  assert.deepEqual(later.map(d => d.driver_number), [2, 1, 3]);
  assert.equal(later[0].previous, 2);
  assert.deepEqual(stateAt(drivers, events, Date.parse('2024-01-01T00:00:05Z')), initial);
});
test('demo has a complete unique classification at every update', () => {
  const demo = createDemo();
  for (let time = demo.start; time <= demo.end; time += 20000) {
    const state = stateAt(demo.drivers, demo.events, time);
    assert.equal(state.length, 20);
    assert.deepEqual(state.map(d => d.position), Array.from({ length: 20 }, (_, i) => i + 1));
  }
});
