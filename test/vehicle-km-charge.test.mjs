// The carrier's per-km charge: kilometres past the day's free allowance, per van per day.
import { suite, test, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertVehicle, mileageReport, listVehicles } from '../lib/shifts.js';
import { profitReport } from '../lib/dispatch-money.js';

suite('Vehicle per-km charge');

test('379 km on a day with 100 free at $0.35 is $97.65, and it reaches the profit report', async () => {
  const { done } = await withTestDb();
  try {
    const v = await upsertVehicle({ name: 'Box', dayRate: 60, kmIncluded: 100, kmRate: 0.35 });
    const { rows: u } = await query(`INSERT INTO users (email, name, password_hash, is_driver) VALUES ('r@x.ca','Ruban','x',true) RETURNING id`);
    await query(`INSERT INTO driver_shifts (user_id, driving, vehicle_id, started_at, ended_at, start_km, end_km)
                 VALUES ($1, true, $2, '2026-10-17T12:00:00Z', '2026-10-18T04:00:00Z', 117713, 118092)`, [u[0].id, v.id]);
    const m = await mileageReport({ from: '2026-10-17', to: '2026-10-17' });
    equal(m.drivers[0].km, 379);
    equal(m.drivers[0].billableKm, 279);
    equal(m.drivers[0].kmCharge, 97.65);
    equal(m.kmCharge, 97.65);
    const p = await profitReport({ from: '2026-10-17', to: '2026-10-17' });
    equal(p.buckets[0].kmCharge, 97.65);
    equal(p.buckets[0].truck, 157.65);
    // A partial van post (the day-rate box, the retire button) cannot clear the km terms.
    await upsertVehicle({ id: v.id, name: 'Box', dayRate: 60 });
    const [again] = await listVehicles();
    equal(again.kmRate, 0.35);
    equal(again.kmIncluded, 100);
  } finally { await done(); }
});
