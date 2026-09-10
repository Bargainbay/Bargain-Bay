// The last stop of the night: parking the van.
//
// It exists for one reason — a driver who forgets to clock off has still tapped
// Done on his last stop, and if that stop is "return to base" then the tap is
// the moment the day actually ended. The office can then correct the shift to a
// real time instead of a guess, and the day becomes costable.
//
// It is a stop and not a checkbox because a stop is a thing the driver already
// knows how to finish. Anything new on that screen is a thing to be taught,
// forgotten, and tapped wrong in the dark.
import { hasDb, query } from './db';
import { createJob, torontoToday } from './jobs';
import { getSetting, setSetting } from './settings';

export const BASE_ADDRESS_KEY = 'dispatch_base_address';

export async function getBaseAddress() {
  const v = await getSetting(BASE_ADDRESS_KEY, null);
  return v && typeof v === 'object' ? v : null;
}

export async function setBaseAddress({ address, city, postal }) {
  const addr = String(address || '').trim();
  if (!addr) throw new Error('Give the yard an address — it is where the vans end up.');
  const base = {
    address: addr.slice(0, 300),
    city: String(city || '').trim().slice(0, 120) || null,
    postal: String(postal || '').trim().slice(0, 12) || null
  };
  await setSetting(BASE_ADDRESS_KEY, base);
  return base;
}

// One per driver who actually has work that day. Adding it to a driver with an
// empty column would put a stop on the phone of somebody who is not out.
export async function addReturnToBase({ date, driverIds, createdBy } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const base = await getBaseAddress();
  if (!base) throw new Error('Set the yard address first — Clients & drivers, under Vans.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : torontoToday();

  const { rows: working } = await query(
    `SELECT DISTINCT d.id, COALESCE(d.name, d.email) AS name
       FROM jobs j
       JOIN users d ON d.id IN (j.driver_id, j.driver2_id)
      WHERE j.job_date = $1::date AND j.status <> 'cancelled'
        AND j.type <> 'return_to_base'
        AND ($2::int[] IS NULL OR d.id = ANY($2))`,
    [day, driverIds && driverIds.length ? driverIds.map(Number) : null]
  );

  // Never twice on the same day for the same driver. The button is on the board
  // and the board is where somebody clicks things again to see if they worked.
  const { rows: already } = await query(
    `SELECT driver_id FROM jobs
      WHERE job_date = $1::date AND type = 'return_to_base' AND status <> 'cancelled'`,
    [day]
  );
  const have = new Set(already.map((r) => r.driver_id));

  const added = [];
  for (const d of working) {
    if (have.has(d.id)) continue;
    const job = await createJob({
      type: 'return_to_base',
      customerName: 'Return to base',
      address: base.address, city: base.city, postal: base.postal,
      jobDate: day, driverId: d.id,
      notes: 'Tap Done when the van is parked — this is how we know what time you finished.',
      createdBy
    });
    added.push({ driver: d.name, jobNumber: job.jobNumber || job.job_number || null });
  }
  return { date: day, added, skipped: working.length - added.length };
}
