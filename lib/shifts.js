// The driver's DAY, as distinct from the stops inside it.
//
// Dispatch could say how long a driver was standing at a customer's door and
// nothing at all about the shift around it — when they picked the van up, when
// they parked it, or how far it went. Those are different questions with
// different answers: time on site is what a delivery costs, and shift hours are
// what a person is paid for. Keeping them apart is deliberate; adding them up
// would be wrong in both directions.
import { hasDb, query } from './db';
import { round2 } from './constants';
import { torontoToday } from './jobs';

let _schema = null;
export function ensureShiftSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      -- Which van. Odometer readings from two different trucks in one column is
      -- not a mileage figure, it's noise — so a reading has to say which vehicle
      -- it came off before it can mean anything.
      CREATE TABLE IF NOT EXISTS vehicles (
        id serial PRIMARY KEY,
        name text NOT NULL,
        plate text,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      -- WHO PAYS FOR THE FUEL, and it is a property of the truck, not of the
      -- fill. The 20ft box truck comes from a carrier who bills fortnightly for
      -- the truck AND its diesel; our own pickups are fuelled by the driver, who
      -- gets e-transferred for it. Those are different kinds of money and the
      -- P&L has to treat them differently or it counts the same diesel twice —
      -- once as a fill and again inside the carrier's invoice.
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_paid_by text NOT NULL DEFAULT 'us';
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS carrier_name text;
      CREATE TABLE IF NOT EXISTS driver_shifts (
        id serial PRIMARY KEY,
        user_id int NOT NULL,
        -- Not everybody on a shift is DRIVING. A second crew member rides with
        -- somebody else all day: on the clock, not responsible for a van, and
        -- unable to read an odometer from the passenger seat. Whatever they
        -- typed would be a guess, and a guess in this column corrupts every
        -- mileage figure built on it.
        driving boolean NOT NULL DEFAULT true,
        riding_with int,
        vehicle_id int,
        started_at timestamptz NOT NULL,
        ended_at   timestamptz,
        start_km int,
        end_km   int,
        start_lat numeric(9,6), start_lng numeric(9,6),
        end_lat   numeric(9,6), end_lng   numeric(9,6),
        note text,
        ref text
      );
      CREATE INDEX IF NOT EXISTS idx_driver_shifts_user ON driver_shifts(user_id, started_at DESC);
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS driving     boolean NOT NULL DEFAULT true;
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS riding_with int;
      -- One open shift per driver, enforced where it cannot be argued with: a
      -- phone that replays "start shift" off the offline queue must not open a
      -- second one and quietly double somebody's hours.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_shift_open
        ON driver_shifts(user_id) WHERE ended_at IS NULL;
      -- The fuel side of dispatch_expenses. The row already existed for gas the
      -- office typed in; these are what a driver filling up on the road adds to
      -- it, and what turns a pile of receipts into a mileage figure.
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS litres       numeric(8,2);
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS odometer_km  int;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS vehicle_id   int;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS shift_id     int;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS receipt_path text;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS receipt_url  text;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS ref          text;
      CREATE INDEX IF NOT EXISTS idx_dispatch_expenses_ref ON dispatch_expenses(ref) WHERE ref IS NOT NULL;
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const clean = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

// ── Vehicles ─────────────────────────────────────────────────────────────────

// Who settles the fuel bill for a given truck.
//   us      — our own pickup. The driver pumps and is e-transferred for it, so
//             their entry is the ONLY record of that money anywhere.
//   carrier — the 20ft box truck. The carrier bills fortnightly for the truck
//             and its diesel together, so a fill logged against it is a MILEAGE
//             record and must never be counted as a cost as well.
export const FUEL_PAID_BY = {
  us: 'We pay (driver pumps, we e-transfer them)',
  carrier: 'Carrier pays (billed to us fortnightly with the truck)'
};

export async function listVehicles({ includeInactive = false } = {}) {
  if (!hasDb()) return [];
  await ensureShiftSchema();
  const { rows } = await query(
    `SELECT id, name, plate, active, fuel_paid_by, carrier_name FROM vehicles
      ${includeInactive ? '' : 'WHERE active = true'} ORDER BY name`
  );
  return rows.map((r) => ({
    ...r,
    fuelPaidBy: r.fuel_paid_by || 'us',
    carrierName: r.carrier_name || null
  }));
}

export async function upsertVehicle({ id, name, plate, active = true, fuelPaidBy, carrierName }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureShiftSchema();
  const nm = clean(name, 80);
  if (!nm) throw new Error('Give the van a name — whatever the crew calls it.');
  const paid = FUEL_PAID_BY[fuelPaidBy] ? fuelPaidBy : 'us';
  const carrier = paid === 'carrier' ? clean(carrierName, 120) : null;
  const cols = 'id, name, plate, active, fuel_paid_by, carrier_name';
  if (id) {
    const { rows } = await query(
      `UPDATE vehicles SET name = $2, plate = $3, active = $4, fuel_paid_by = $5, carrier_name = $6
        WHERE id = $1 RETURNING ${cols}`,
      [Number(id), nm, clean(plate, 20), active !== false, paid, carrier]
    );
    if (!rows.length) throw new Error('No such van.');
    return rows[0];
  }
  const { rows } = await query(
    `INSERT INTO vehicles (name, plate, active, fuel_paid_by, carrier_name)
     VALUES ($1,$2,$3,$4,$5) RETURNING ${cols}`,
    [nm, clean(plate, 20), active !== false, paid, carrier]
  );
  return rows[0];
}

// ── Shifts ───────────────────────────────────────────────────────────────────

const shapeShift = (r) => ({
  id: r.id,
  driverId: r.user_id,
  driverName: r.driver_name || null,
  driving: r.driving !== false,
  ridingWith: r.riding_with || null,
  ridingWithName: r.riding_with_name || null,
  vehicleId: r.vehicle_id || null,
  vehicleName: r.vehicle_name || null,
  fuelPaidBy: r.fuel_paid_by || 'us',
  carrierName: r.carrier_name || null,
  startedAt: r.started_at ? r.started_at.toISOString() : null,
  endedAt: r.ended_at ? r.ended_at.toISOString() : null,
  startKm: r.start_km == null ? null : Number(r.start_km),
  endKm: r.end_km == null ? null : Number(r.end_km),
  km: r.start_km != null && r.end_km != null && r.end_km >= r.start_km
    ? Number(r.end_km) - Number(r.start_km) : null,
  minutes: r.started_at && r.ended_at
    ? Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000) : null,
  note: r.note || null
});

export async function openShift(userId) {
  if (!hasDb() || !userId) return null;
  await ensureShiftSchema();
  const { rows } = await query(
    `SELECT s.*, v.name AS vehicle_name, v.fuel_paid_by, v.carrier_name,
            COALESCE(m.name, m.email) AS riding_with_name
       FROM driver_shifts s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN users m ON m.id = s.riding_with
      WHERE s.user_id = $1 AND s.ended_at IS NULL
      ORDER BY s.started_at DESC LIMIT 1`,
    [Number(userId)]
  );
  return rows.length ? shapeShift(rows[0]) : null;
}

// Clocking on. `at` is the DEVICE's time for the same reason a location ping is:
// a phone with no signal at 6am posts the shift when it finds some, and stamping
// it on arrival would move the start of somebody's paid day.
export async function startShift(userId, { driving = true, ridingWith, vehicleId, startKm, at, lat, lng, note, ref } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureShiftSchema();
  const uid = Number(userId);

  // A replayed start must find the shift it already opened, not open another.
  if (ref) {
    const { rows: seen } = await query(
      `SELECT s.*, NULL AS vehicle_name, NULL AS riding_with_name
         FROM driver_shifts s WHERE s.user_id = $1 AND s.ref = $2 LIMIT 1`, [uid, ref]
    );
    if (seen.length) return { ...shapeShift(seen[0]), duplicate: true };
  }
  const already = await openShift(uid);
  if (already) return { ...already, already: true };

  const when = Number(at) > 0 ? new Date(Math.min(Number(at), Date.now())) : new Date();
  // A passenger has no van and no odometer, whatever the form happened to send.
  // Enforced here and not only in the UI, because a reading typed from the
  // passenger seat is a guess and a guess in this column corrupts every mileage
  // figure built on it.
  const isDriving = driving !== false;
  const { rows } = await query(
    `INSERT INTO driver_shifts
       (user_id, driving, riding_with, vehicle_id, started_at, start_km, start_lat, start_lng, note, ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *, NULL AS vehicle_name, NULL AS riding_with_name`,
    [uid, isDriving,
     isDriving ? null : (ridingWith ? Number(ridingWith) : null),
     isDriving && vehicleId ? Number(vehicleId) : null,
     when, isDriving ? int(startKm) : null,
     Number.isFinite(Number(lat)) ? Number(lat) : null,
     Number.isFinite(Number(lng)) ? Number(lng) : null,
     clean(note), clean(ref, 80)]
  );
  return shapeShift(rows[0]);
}

// Clocking off. The odometer is asked for again because the DIFFERENCE is the
// only thing that makes a mileage figure — one reading a day is a number nobody
// can subtract.
export async function endShift(userId, { endKm, at, lat, lng, note } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureShiftSchema();
  const uid = Number(userId);
  const open = await openShift(uid);
  if (!open) return { none: true };

  // Nothing to read if they were in the passenger seat all day.
  const km = open.driving ? int(endKm) : null;
  // A reading LOWER than the start is a typo — a fat thumb, or the trip meter
  // read instead of the odometer. Refusing it is better than recording a
  // negative distance that quietly poisons the average.
  if (km != null && open.startKm != null && km < open.startKm) {
    throw new Error(
      `That reads lower than this morning's ${open.startKm} km. Check the odometer — is it the trip meter?`
    );
  }
  const when = Number(at) > 0 ? new Date(Math.min(Number(at), Date.now())) : new Date();
  const { rows } = await query(
    `UPDATE driver_shifts SET ended_at = GREATEST($2, started_at), end_km = $3,
            end_lat = $4, end_lng = $5,
            note = COALESCE(NULLIF($6,''), note)
      WHERE id = $1 RETURNING *, NULL AS vehicle_name, NULL AS riding_with_name`,
    [open.id, when, km,
     Number.isFinite(Number(lat)) ? Number(lat) : null,
     Number.isFinite(Number(lng)) ? Number(lng) : null,
     clean(note)]
  );
  return shapeShift(rows[0]);
}

// Hours per driver over a period — what the shift is FOR. Kept apart from the
// pay report's "hours on site", which answers a different question.
export async function shiftReport({ from, to, driverId } = {}) {
  if (!hasDb()) return { from, to, rows: [], totals: {} };
  await ensureShiftSchema();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : torontoToday();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : start;
  const { rows } = await query(
    `SELECT s.*, COALESCE(u.name, u.email) AS driver_name, v.name AS vehicle_name,
            COALESCE(m.name, m.email) AS riding_with_name
       FROM driver_shifts s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN users m ON m.id = s.riding_with
      WHERE (s.started_at AT TIME ZONE 'America/Toronto')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR s.user_id = $3)
      ORDER BY s.started_at DESC`,
    [start, end, driverId ? Number(driverId) : null]
  );
  const out = rows.map(shapeShift);
  return {
    from: start, to: end, rows: out,
    totals: {
      shifts: out.length,
      hours: Math.round(out.reduce((a, r) => a + (r.minutes || 0), 0) / 60 * 100) / 100,
      km: out.reduce((a, r) => a + (r.km || 0), 0),
      open: out.filter((r) => !r.endedAt).length
    }
  };
}

// ── How far, and on how much fuel ────────────────────────────────────────────
// Distance comes from the shifts (a start and an end reading on the same van);
// fuel comes from the gas entries. Both are needed and neither is guessed: a
// period missing either one reports what it has and says the other is missing,
// rather than dividing by a number nobody wrote down.
export async function mileageReport({ from, to } = {}) {
  if (!hasDb()) return { from, to, vehicles: [] };
  await ensureShiftSchema();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : torontoToday();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : start;

  const [dist, fuel] = await Promise.all([
    query(
      `SELECT s.vehicle_id, COALESCE(v.name, 'No van recorded') AS name,
              COUNT(*) FILTER (WHERE s.start_km IS NOT NULL AND s.end_km IS NOT NULL
                               AND s.end_km >= s.start_km)::int AS shifts_with_km,
              -- Only shifts somebody was DRIVING. Counting a passenger's shift
              -- here would report "2 of 5 shifts have both readings" on a day
              -- when every driver gave both and three people rode along.
              COUNT(*)::int AS shifts,
              COALESCE(SUM(s.end_km - s.start_km) FILTER (
                WHERE s.start_km IS NOT NULL AND s.end_km IS NOT NULL AND s.end_km >= s.start_km
              ), 0)::int AS km
         FROM driver_shifts s
         LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.driving = true
          AND (s.started_at AT TIME ZONE 'America/Toronto')::date BETWEEN $1::date AND $2::date
        GROUP BY 1, 2`,
      [start, end]
    ),
    query(
      // Litres count for EVERY truck — that is how far it went on how much, and
      // it is true whoever paid. The SPEND is split: on a carrier-supplied truck
      // the diesel is already inside the fortnightly invoice, so counting the
      // fill as well would charge us for the same tank twice.
      `SELECT e.vehicle_id, COALESCE(v.fuel_paid_by, 'us') AS fuel_paid_by,
              COALESCE(SUM(e.amount) FILTER (WHERE COALESCE(v.fuel_paid_by,'us') <> 'carrier'), 0) AS spend,
              COALESCE(SUM(e.amount) FILTER (WHERE COALESCE(v.fuel_paid_by,'us') =  'carrier'), 0) AS carrier_spend,
              COALESCE(SUM(e.litres), 0) AS litres,
              COUNT(*)::int AS fills,
              COUNT(*) FILTER (WHERE e.litres IS NULL)::int AS fills_no_litres
         FROM dispatch_expenses e
         LEFT JOIN vehicles v ON v.id = e.vehicle_id
        WHERE e.kind = 'gas' AND e.expense_date BETWEEN $1::date AND $2::date
        GROUP BY 1, 2`,
      [start, end]
    )
  ]);

  const fuelBy = new Map(fuel.rows.map((r) => [r.vehicle_id, r]));
  const keys = new Set([...dist.rows.map((r) => r.vehicle_id), ...fuel.rows.map((r) => r.vehicle_id)]);
  const vehicles = [...keys].map((vid) => {
    const d = dist.rows.find((r) => r.vehicle_id === vid) || {};
    const f = fuelBy.get(vid) || {};
    const km = d.km || 0;
    const litres = round2(Number(f.litres) || 0);
    const spend = round2(Number(f.spend) || 0);
    const carrierSpend = round2(Number(f.carrier_spend) || 0);
    return {
      vehicleId: vid || null,
      name: d.name || 'No van recorded',
      fuelPaidBy: f.fuel_paid_by || 'us',
      carrierSpend,
      shifts: d.shifts || 0,
      shiftsWithKm: d.shifts_with_km || 0,
      km,
      litres,
      spend,
      fills: f.fills || 0,
      fillsWithoutLitres: f.fills_no_litres || 0,
      // Only when BOTH halves are real. A litres-per-100km built on one of them
      // is a made-up number that looks authoritative.
      litresPer100: km > 0 && litres > 0 ? Math.round((litres / km) * 100 * 10) / 10 : null,
      // Cost per km only where WE pay for the fuel. On the carrier's truck the
      // cost of a kilometre is inside their invoice, not in these fills.
      costPerKm: km > 0 && spend > 0 ? Math.round((spend / km) * 100) / 100 : null
    };
  }).sort((a, b) => b.km - a.km);

  return { from: start, to: end, vehicles };
}
