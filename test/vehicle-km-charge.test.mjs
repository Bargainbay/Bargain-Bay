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

test('a bridged Bargain Bay order prices the stop from its Delivery line; no delivery line stays unpriced', async () => {
  const { done } = await withTestDb();
  try {
    const mk = async (num, subtotal, items) => {
      const { rows: o } = await query(`INSERT INTO orders (order_number, email, status, subtotal, hst, total, delivery_method)
        VALUES ($1,'c@x.ca','delivered',$2,$3,$4,'delivery') RETURNING id`, [num, subtotal, +(subtotal * 0.13).toFixed(2), +(subtotal * 1.13).toFixed(2)]);
      for (const [kind, title, price] of items) await query(`INSERT INTO order_items (order_id, title, price, kind) VALUES ($1,$2,$3,$4)`, [o[0].id, title, price, kind]);
      const { rows: j } = await query(`INSERT INTO jobs (type, status, order_id, address, job_date) VALUES ('delivery','done',$1,'1 Main St','2026-10-16') RETURNING id`, [o[0].id]);
      return j[0].id;
    };
    await mk('BB-T1', 600, [['unit', 'Fridge', 500], ['service', 'Delivery', 50], ['service', 'Installation', 50]]);
    await mk('BB-T2', 486.73, [['unit', 'Laundry centre', 486.73]]);
    const p = await profitReport({ from: '2026-10-16', to: '2026-10-16' });
    equal(p.buckets[0].revenue, 50);
    equal(p.buckets[0].unpricedRevenue, 1);
  } finally { await done(); }
});
