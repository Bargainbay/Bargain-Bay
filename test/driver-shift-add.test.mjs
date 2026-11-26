import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';

suite('office adds a driver shift (real SQL)');

test('a missed driver shift is added once; an overlapping one is refused', async () => {
  const db = await withTestDb();
  try {
    const { createShift, ensureShiftSchema } = await import('../lib/shifts.js');
    const { listDriversForOffice } = await import('../lib/drivers.js');
    await listDriversForOffice(); // makes the driver columns
    await ensureShiftSchema();
    const { rows: [u] } = await db.client.query(
      "INSERT INTO users (email, name, password_hash, is_driver) VALUES ('d@example.com','Dee','x',true) RETURNING id");
    const base = { driverId: u.id, date: '2026-10-05', driving: false };
    const s = await createShift({ ...base, startTime: '09:00', endTime: '17:00' }, 'owner');
    equal(s.minutes ?? Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000), 480);
    let msg = '';
    try { await createShift({ ...base, startTime: '12:00', endTime: '13:00' }, 'owner'); } catch (e) { msg = e.message; }
    assert(/overlaps/.test(msg), `expected an overlap refusal, got "${msg}"`);
    await createShift({ ...base, startTime: '17:00', endTime: '18:00' }, 'owner'); // back to back is fine
  } finally { db.done(); }
});
