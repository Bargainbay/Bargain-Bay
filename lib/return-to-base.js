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
//
// THERE IS MORE THAN ONE BASE. This started as a single address in settings,
// which was wrong the moment somebody said "we have two" — Milner Ave in
// Scarborough and Squires Beach Rd in Pickering. A driver's run ends at the
// yard his van lives in, and that is per-driver on the night, not a constant.
import { hasDb, query } from './db';
import { createJob, torontoToday } from './jobs';
import { getSetting, setSetting } from './settings';

export const BASES_KEY = 'dispatch_bases';
const LEGACY_KEY = 'dispatch_base_address';

const shape = (b, i) => ({
  id: Number(b.id) || i + 1,
  name: String(b.name || '').trim().slice(0, 80) || String(b.address || '').split(',')[0],
  address: String(b.address || '').trim().slice(0, 300),
  city: String(b.city || '').trim().slice(0, 120) || null,
  postal: String(b.postal || '').trim().slice(0, 12) || null
});

export async function listBases() {
  const v = await getSetting(BASES_KEY, null);
  if (Array.isArray(v) && v.length) return v.map(shape);
  // The single address this feature shipped with, carried forward rather than
  // dropped — it is already set on production and is one of the two real yards.
  const legacy = await getSetting(LEGACY_KEY, null);
  if (legacy && legacy.address) return [shape({ ...legacy, id: 1, name: legacy.city || 'Base' }, 0)];
  return [];
}

export async function saveBases(bases) {
  const list = (Array.isArray(bases) ? bases : []).map(shape).filter((b) => b.address);
  if (!list.length) throw new Error('A base needs an address — it is where the vans end up.');
  // Ids have to be stable: a job already added points at nothing if they shuffle.
  const seen = new Set();
  list.forEach((b, i) => {
    while (seen.has(b.id)) b.id = Math.max(...list.map((x) => x.id), i) + 1;
    seen.add(b.id);
  });
  await setSetting(BASES_KEY, list);
  return list;
}

// Who is actually out on a given day, so the office picks from real names
// rather than the whole roster. A driver with an empty column is not out.
export async function driversOut(date) {
  if (!hasDb()) return [];
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : torontoToday();
  const { rows } = await query(
    `SELECT DISTINCT d.id, COALESCE(d.name, d.email) AS name,
            EXISTS (SELECT 1 FROM jobs r WHERE r.job_date = $1::date
                      AND r.type = 'return_to_base' AND r.status <> 'cancelled'
                      AND r.driver_id = d.id) AS has_one
       FROM jobs j
       JOIN users d ON d.id IN (j.driver_id, j.driver2_id)
      WHERE j.job_date = $1::date AND j.status <> 'cancelled'
        AND j.type <> 'return_to_base'
      ORDER BY name`,
    [day]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, hasOne: !!r.has_one }));
}

// `assignments` is [{ driverId, baseId }] — which yard each driver goes back to.
// Not one base for the batch: the two crews finish in different cities, which is
// the whole reason this takes a list.
export async function addReturnToBase({ date, assignments = [], createdBy } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const bases = await listBases();
  if (!bases.length) throw new Error('Set a base address first — Clients & drivers, under Vans.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : torontoToday();

  const out = await driversOut(day);
  const added = [];
  const skipped = [];
  for (const a of assignments) {
    const drv = out.find((d) => String(d.id) === String(a.driverId));
    if (!drv) { skipped.push({ driverId: a.driverId, why: 'not out on this day' }); continue; }
    // Never twice for the same driver on the same day. The button is on the
    // board, and the board is where people click things again to see if they
    // worked.
    if (drv.hasOne) { skipped.push({ driver: drv.name, why: 'already has one' }); continue; }
    const base = bases.find((b) => String(b.id) === String(a.baseId)) || bases[0];
    const job = await createJob({
      type: 'return_to_base',
      customerName: `Return to base — ${base.name}`,
      address: base.address, city: base.city, postal: base.postal,
      jobDate: day, driverId: drv.id,
      notes: 'Tap Done when the van is parked — this is how we know what time you finished.',
      createdBy
    });
    added.push({ driver: drv.name, base: base.name, jobNumber: job.jobNumber || job.job_number || null });
  }
  return { date: day, added, skipped };
}
