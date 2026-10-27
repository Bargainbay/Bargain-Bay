// An owner's hours are recorded, not costed; and "head to base first" adds one base stop.
import { suite, test, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { setPaidAsOwner, upsertVehicle } from '../lib/shifts.js';
import { profitReport } from '../lib/dispatch-money.js';
import { addBaseStop } from '../lib/route-plan.js';

suite('Owner hours and the base stop');

test('a paid-as-owner driver costs nothing and raises no missing-rate warning', async () => {
  const { done } = await withTestDb();
  try {
    const v = await upsertVehicle({ name: 'Suburban' });
    const { rows: a } = await query(`INSERT INTO users (email, name, password_hash, is_driver, hourly_rate) VALUES ('rav@x.ca','Ravi','x',true,30) RETURNING id`);
    const { rows: b } = await query(`INSERT INTO users (email, name, password_hash, is_driver) VALUES ('kow@x.ca','Kowsi','x',true) RETURNING id`);
    for (const id of [a[0].id, b[0].id]) {
      await query(`INSERT INTO driver_shifts (user_id, driving, vehicle_id, started_at, ended_at) VALUES ($1,true,$2,'2026-10-26T13:00:00Z','2026-10-26T21:00:00Z')`, [id, v.id]);
    }
    let p = await profitReport({ from: '2026-10-26', to: '2026-10-26' });
    equal(p.buckets[0].labour, 240);
    equal(p.buckets[0].noRateShifts, 1);
    await setPaidAsOwner(a[0].id, true);
    await setPaidAsOwner(b[0].id, true);
    p = await profitReport({ from: '2026-10-26', to: '2026-10-26' });
    equal(p.buckets[0].labour, 0);
    equal(p.buckets[0].noRateShifts, 0);
    equal(p.buckets[0].ownerHours, 16);
  } finally { await done(); }
});

test('head to base first adds one pickup at the base as stop 1, and only once', async () => {
  const { done } = await withTestDb();
  try {
    await query(`INSERT INTO clients (name) VALUES ('Canadian Discount Appliances')`);
    const { rows: u } = await query(`INSERT INTO users (email, name, password_hash, is_driver) VALUES ('rav@x.ca','Ravi','x',true) RETURNING id`);
    const mk = (addr) => query(`INSERT INTO jobs (type, status, address, job_date, driver_id, seq) VALUES ('delivery','scheduled',$1,'2026-10-27',$2,1) RETURNING id`, [addr, u[0].id]);
    await mk('1 First St');
    const r = await addBaseStop('2026-10-27', u[0].id, 'cda', { email: 'a@b.ca', name: 'A' });
    equal(r.existed, false);
    const again = await addBaseStop('2026-10-27', u[0].id, 'cda', { email: 'a@b.ca', name: 'A' });
    equal(again.existed, true);
    const { rows } = await query(`SELECT type, address, seq FROM jobs WHERE job_date='2026-10-27' ORDER BY seq`);
    equal(rows.length, 2);
    equal(rows[0].type, 'pickup');
    equal(rows[0].address, '808 Courtland Avenue East');
    equal(rows[1].address, '1 First St');
  } finally { await done(); }
});
