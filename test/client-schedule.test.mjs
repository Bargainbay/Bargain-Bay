import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, mapsUrl, windowText } from '../lib/client-schedule.js';

const J = (o) => ({ status: 'scheduled', date: '2026-11-12', items: [], ...o });
test('groups by day and driver, orders by seq then window', () => {
  const s = buildSchedule([
    J({ id: 3, driverId: 1, driverName: 'Ruban', seq: 2, windowStart: '09:00', address: 'B' }),
    J({ id: 1, driverId: 1, driverName: 'Ruban', seq: 1, windowStart: '13:00', address: 'A' }),
    J({ id: 4, driverId: 2, driverName: 'Ardy', windowStart: '10:00', address: 'C' }),
    J({ id: 5, windowStart: '08:00', address: 'D' }),
    J({ id: 6, status: 'done', driverId: 1 }),
    J({ id: 7, status: 'unscheduled', date: null })
  ]);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].routes.map((r) => r.label), ['Route A', 'Route B', 'Route to be confirmed']);
  assert.deepEqual(s[0].routes[1].stops.map((j) => j.id), [1, 3]);
  assert.equal(s[0].routes.length, 3);
});
test('maps link and window text', () => {
  assert.match(mapsUrl([{ address: 'A' }, { address: 'B' }, { address: 'C' }]), /destination=C&origin=A&waypoints=B/);
  assert.equal(mapsUrl([]), null);
  assert.equal(windowText({ windowStart: '09:00', windowEnd: '11:00' }), '09:00–11:00');
  assert.equal(windowText({}), 'Time to be confirmed');
});
