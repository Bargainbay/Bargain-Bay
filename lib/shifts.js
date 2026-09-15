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
      -- What the truck costs for a day it goes out, whoever is driving it. The
      -- box truck is $60. Charged once per van per day, not once per shift: a
      -- two-man day on one truck is one truck.
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS day_rate numeric(10,2);
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
      -- What an hour of this person costs. Ruban is $25 (it is what the carrier
      -- bills for him), Kowsi is $20 and we pay him directly.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate numeric(8,2);
      -- When we last asked "are you still working?". Stamped so a driver gets
      -- the question once an evening and not once an hour.
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS nudged_at timestamptz;
      -- Who corrected this shift and when. A shift the office has retyped is a
      -- different kind of record from one the driver's taps produced, and the
      -- person reading the hours is entitled to know which they are looking at.
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS edited_at timestamptz;
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS edited_by text;
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
const money = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Give the ${label} as a number, like 60 or 25.50.`);
  return round2(n);
};

// What an hour of this person costs. It lives on the USER because it follows
// the person, not the stop: the same driver on a delivery and on a pickup costs
// the same per hour, and pricing it per stop is what left 123 stops at $0.
export async function setDriverRate(userId, hourlyRate) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureShiftSchema();
  const rate = hourlyRate === '' || hourlyRate == null ? null : money(hourlyRate, 'hourly rate');
  const { rows } = await query(
    'UPDATE users SET hourly_rate = $2 WHERE id = $1 RETURNING id, hourly_rate',
    [Number(userId), rate]
  );
  if (!rows.length) throw new Error('No such driver.');
  return { id: rows[0].id, hourlyRate: rows[0].hourly_rate == null ? null : Number(rows[0].hourly_rate) };
}

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
    `SELECT id, name, plate, active, fuel_paid_by, carrier_name, day_rate FROM vehicles
      ${includeInactive ? '' : 'WHERE active = true'} ORDER BY name`
  );
  return rows.map((r) => ({
    ...r,
    fuelPaidBy: r.fuel_paid_by || 'us',
    carrierName: r.carrier_name || null,
    dayRate: r.day_rate == null ? null : Number(r.day_rate)
  }));
}

export async function upsertVehicle({ id, name, plate, active = true, fuelPaidBy, carrierName, dayRate }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureShiftSchema();
  const nm = clean(name, 80);
  if (!nm) throw new Error('Give the van a name — whatever the crew calls it.');
  const paid = FUEL_PAID_BY[fuelPaidBy] ? fuelPaidBy : 'us';
  const carrier = paid === 'carrier' ? clean(carrierName, 120) : null;
  // A blank day rate is "not set", which is different from zero — the report
  // counts a van with no rate as costing nothing and says so, rather than
  // pretending the truck was free.
  const rate = dayRate === '' || dayRate == null ? null : money(dayRate, 'day rate');
  const cols = 'id, name, plate, active, fuel_paid_by, carrier_name, day_rate';
  if (id) {
    const { rows } = await query(
      `UPDATE vehicles SET name = $2, plate = $3, active = $4, fuel_paid_by = $5, carrier_name = $6,
              day_rate = $7
        WHERE id = $1 RETURNING ${cols}`,
      [Number(id), nm, clean(plate, 20), active !== false, paid, carrier, rate]
    );
    if (!rows.length) throw new Error('No such van.');
    return rows[0];
  }
  const { rows } = await query(
    `INSERT INTO vehicles (name, plate, active, fuel_paid_by, carrier_name, day_rate)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${cols}`,
    [nm, clean(plate, 20), active !== false, paid, carrier, rate]
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
  note: r.note || null,
  editedAt: r.edited_at ? r.edited_at.toISOString() : null,
  editedBy: r.edited_by || null,
  nudgedAt: r.nudged_at ? r.nudged_at.toISOString() : null
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

// ── The odometer, and how we know a reading is false ─────────────────────────

// The LAST reading we have for a van — the most recent one by time, not the
// highest one.
//
// It was the highest, and that was wrong in a way that only showed up on live
// data. One false reading poisons a van forever under a MAX: the box truck runs
// at ~108,000 and carries a stray 241,394 typed off the Ram's dash, and the
// F150 carries a 4,624,784 that somebody fat-fingered. Under MAX, every honest
// reading after those is "lower than the last one" and gets refused — the guard
// would have stopped two of three trucks going out the next morning, which is
// worse than the mistake it exists to catch.
//
// Most-recent-by-time self-heals instead: one bad number is superseded by the
// next real one, and the office can correct it in Times → Shifts meanwhile.
// The readings either side of a moment in time — not just the latest one.
//
// The latest was enough while every reading arrived live, because "now" is
// always after everything. It stopped being enough the moment the office could
// CORRECT HISTORY, which is the whole point of the editor: putting Kowsi's 9th
// of September back on the Ram was refused because the Ram has since been read
// at 241,680, and a reading from the 9th is of course lower than that. The
// editor could not perform the one repair it was built for.
//
// A reading has to fit BETWEEN its neighbours. For a live entry there is no
// neighbour after it, so this behaves exactly as before.
async function odometerWindow(vehicleId, { at, excludeShiftId } = {}) {
  if (!hasDb() || !vehicleId) return { before: null, after: null };
  const when = at ? new Date(at) : new Date();
  const readings = `
    SELECT start_km AS km, started_at AS seen, id AS shift_id
      FROM driver_shifts WHERE vehicle_id = $1 AND driving = true AND start_km > 0
    UNION ALL
    SELECT end_km, COALESCE(ended_at, started_at), id
      FROM driver_shifts WHERE vehicle_id = $1 AND driving = true AND end_km > 0
    UNION ALL
    -- A fill has a DATE, not a time, and midnight sorts before every shift
    -- reading on the same day. That is what refused to put Kowsi's 9 September
    -- shift back on the Ram: his own fill that morning, dated the 9th, landed
    -- at 00:00 and became the "reading before" — 241,394 against a shift that
    -- started at 241,316. created_at is the moment the driver actually typed
    -- it, so use that whenever the fill was entered on the day it happened, and
    -- fall back to NOON for one the office backdated. Noon rather than midnight
    -- because a backdated fill belongs somewhere inside its day, not in front
    -- of all of it.
    SELECT odometer_km,
           CASE WHEN (created_at AT TIME ZONE 'America/Toronto')::date = expense_date
                THEN created_at
                ELSE expense_date::timestamptz + interval '12 hours' END,
           NULL
      FROM dispatch_expenses WHERE vehicle_id = $1 AND odometer_km > 0`;
  // The shift being edited must not be compared against its OWN old numbers.
  const notSelf = 'AND (shift_id IS NULL OR shift_id <> COALESCE($3::int, -1))';
  const [b, a] = await Promise.all([
    query(`SELECT km, seen FROM (${readings}) r WHERE seen <= $2 ${notSelf}
            ORDER BY seen DESC, km DESC LIMIT 1`,
      [Number(vehicleId), when, excludeShiftId ? Number(excludeShiftId) : null]),
    query(`SELECT km, seen FROM (${readings}) r WHERE seen > $2 ${notSelf}
            ORDER BY seen ASC, km ASC LIMIT 1`,
      [Number(vehicleId), when, excludeShiftId ? Number(excludeShiftId) : null])
  ]);
  const shape = (r) => (r && r.km != null ? { km: Number(r.km), seen: r.seen || null } : null);
  return { before: shape(b.rows[0]), after: shape(a.rows[0]) };
}

export async function lastOdometer(vehicleId, opts) {
  return (await odometerWindow(vehicleId, opts)).before;
}

// An odometer only ever goes UP, and never by very much in a day. A reading
// outside that is not a reading, it is a different truck — which is exactly
// what happened on 2026-09-09: the box truck was sitting on ~108,700 and a
// driver started a shift on it at 241,316, the Ram's reading. Nothing objected,
// and one van's mileage was ruined by the other's number.
//
// The van's OWN history is what makes this knowable. Ruban has been reading the
// box truck since the beginning, so the moment a reading arrives 130,000 km
// above the last one, we already know.
// Every refusal names the way out. A guard that can be triggered by BAD HISTORY
// — and this one can, because the history already contains false readings — has
// to tell the person it just stopped who can unstick them, or the answer on a
// forecourt at 7am is to give up and type nothing.
const FIX_IT = 'If the last reading is the wrong one, the office can correct it in Times → Shifts.';
const DAILY_KM_ALLOWANCE = 1500;   // generous: a long haul day is ~600
const MIN_ALLOWANCE = 5000;        // and a van that has sat unread for a while

export async function assertOdometer(vehicleId, km, { vehicleName, at, excludeShiftId } = {}) {
  const reading = Number(km);
  if (!Number.isFinite(reading) || reading <= 0) {
    // Ardy's 28 Aug shift went in at 0 km and came out at 0 km. Zero is not a
    // reading; it is the field being got past.
    throw new Error('That odometer reading is not a number off the dash — check it and type what it says.');
  }
  const { before: last, after } = await odometerWindow(vehicleId, { at, excludeShiftId });
  const name = vehicleName || 'this van';

  // A reading that lands after a LATER one is the same mistake seen from the
  // other side, and only the editor can produce it.
  if (after && reading > after.km) {
    throw new Error(
      `${name} read ${after.km.toLocaleString('en-CA')} km later that ` +
      `${new Date(after.seen).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })}, ` +
      `so it cannot have been ${reading.toLocaleString('en-CA')} before it. ${FIX_IT}`
    );
  }
  if (!last) return;   // nothing earlier to compare against
  if (reading < last.km) {
    throw new Error(
      `${name} last read ${last.km.toLocaleString('en-CA')} km, and an odometer doesn't go backwards. ` +
      'Check the truck — is this the trip meter, or a different van? ' +
      `${FIX_IT}`
    );
  }
  const days = last.seen ? Math.max(1, Math.ceil((Date.now() - new Date(last.seen)) / 86400000)) : 1;
  const allowance = Math.max(MIN_ALLOWANCE, days * DAILY_KM_ALLOWANCE);
  if (reading - last.km > allowance) {
    // Name the van it probably IS. "That's wrong" sends a driver back to the
    // dash to read the same number again; "that looks like the Ram" tells them
    // what actually happened.
    const other = await closestVehicle(reading, vehicleId);
    throw new Error(
      `${name} last read ${last.km.toLocaleString('en-CA')} km, so ${reading.toLocaleString('en-CA')} is ` +
      `${(reading - last.km).toLocaleString('en-CA')} km more than it can have done.` +
      (other ? ` That reading looks like ${other.name} (last read ${other.km.toLocaleString('en-CA')} km) — ` +
               'is that the truck you are in?'
             : ' Check the truck you picked.') +
      ` ${FIX_IT}`
    );
  }
}

// Which van does this reading actually belong to? Only answers when one van is
// a clear match, because a guess here would be worse than no suggestion.
async function closestVehicle(km, excludeId) {
  const vans = await listVehicles();
  const scored = [];
  for (const v of vans) {
    if (String(v.id) === String(excludeId)) continue;
    const last = await lastOdometer(v.id);
    if (last) scored.push({ name: v.name, km: last.km, gap: Math.abs(Number(km) - last.km) });
  }
  scored.sort((a, b) => a.gap - b.gap);
  return scored[0] && scored[0].gap <= MIN_ALLOWANCE ? scored[0] : null;
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
  // Refuse a reading that cannot belong to this van BEFORE the shift opens.
  // Letting it in and correcting later is not the same thing: the mileage
  // figures are built off these two numbers, and nobody goes back for them.
  if (driving !== false && vehicleId && startKm != null && String(startKm) !== '') {
    const van = (await listVehicles({ includeInactive: true })).find((v) => String(v.id) === String(vehicleId));
    await assertOdometer(vehicleId, startKm, { vehicleName: van?.name });
  }
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
  // And an end reading that is impossibly far ABOVE the start is the same
  // mistake in the other direction — a different truck's dash, read at night.
  if (km != null && open.startKm != null && km - open.startKm > DAILY_KM_ALLOWANCE) {
    throw new Error(
      `That is ${(km - open.startKm).toLocaleString('en-CA')} km since this morning's ` +
      `${open.startKm.toLocaleString('en-CA')} km. Check the odometer — is this the right truck?`
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

// Correcting a shift after the fact.
//
// Until now the only shift anybody could change was one that had not started.
// The report says "3 shifts could not be costed — fix them in Times" and there
// was nowhere to do it, which makes the flag an accusation rather than a task.
//
// Times come in as 'HH:MM' Toronto on the shift's OWN day, the same shape the
// stop times use, because that is how the drivers report them in the group
// chat: "finished at 7". An end before the start rolls to the next day — a
// shift that begins at 22:00 and ends at 02:00 is one night's work.
export async function setShiftTimes(shiftId, { startTime, endTime, startKm, endKm, vehicleId, clearKm, note, clear } = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureShiftSchema();
  const id = Number(shiftId);
  const { rows: cur } = await query(
    `SELECT s.*, v.name AS vehicle_name FROM driver_shifts s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id WHERE s.id = $1`, [id]
  );
  if (!cur.length) throw new Error('No such shift.');
  const shift = cur[0];
  const day = shift.started_at
    ? new Date(shift.started_at).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
    : torontoToday();

  const stamp = async (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    if (!/^\d{1,2}:\d{2}$/.test(t)) throw new Error(`"${t}" isn't a time — use 24-hour, like 19:30.`);
    const { rows } = await query(
      `SELECT ($1::date + $2::time) AT TIME ZONE 'America/Toronto' AS ts`, [day, t]
    );
    return rows[0].ts;
  };

  // `clear` reopens a shift that was closed at the wrong time entirely — the
  // driver is still out and somebody closed it from the office at 6pm.
  let started = startTime === undefined ? shift.started_at : (await stamp(startTime)) || shift.started_at;
  let ended = clear ? null
    : endTime === undefined ? shift.ended_at : await stamp(endTime);

  if (ended && started && ended <= started) {
    // Past midnight, not backwards. Only ever ONE day, so a typo cannot silently
    // become a 25-hour shift.
    ended = new Date(new Date(ended).getTime() + 86400000);
  }
  if (ended && started) {
    const hours = (new Date(ended) - new Date(started)) / 3600000;
    const wasHours = shift.ended_at
      ? (new Date(shift.ended_at) - new Date(shift.started_at)) / 3600000 : Infinity;
    // Refused only if the edit MAKES IT WORSE. Ardy's 28 August shift is 191.4
    // hours, and a flat ceiling meant the editor refused to touch it at all —
    // including to clear the 0 km readings, which is what it was being asked to
    // do. The shifts this tool exists for are exactly the ones already over the
    // line; locking it out of them leaves the flag permanently unactionable.
    // `>` and not `>=`: an edit that leaves the duration exactly as it was —
    // clearing a bad odometer on a 191-hour shift, say — is not making anything
    // worse, and refusing it locked the editor out all over again.
    if (hours > 20 && hours > wasHours) {
      throw new Error(
        `That is ${hours.toFixed(1)} hours. If the shift really ran that long, split it — a figure that size ` +
        'is what the report refuses to cost in the first place.'
      );
    }
  }

  // Moving a shift onto the truck it was actually driven in. This is the repair
  // for the mistake that started all of this — a reading typed against the wrong
  // van — and without it the only way to get the number out of that van's
  // history is to leave it there.
  const van = vehicleId === undefined || vehicleId === '' ? shift.vehicle_id : Number(vehicleId) || null;

  // `clearKm` empties both readings. A reading that belongs to no van at all —
  // the 0 km, the 4,624,784 — has to be removable, and a blank field cannot
  // mean "delete this" when it already means "leave it alone".
  const kmIn = clearKm ? null : (startKm === undefined || startKm === '' ? shift.start_km : int(startKm));
  const kmOut = clearKm ? null : (endKm === undefined || endKm === '' ? shift.end_km : int(endKm));
  if (shift.driving !== false && van) {
    for (const km of [kmIn, kmOut]) {
      // Checked against the van it is being SAVED to, and only when it is new
      // or the van changed — re-saving a shift's own existing reading must not
      // be refused by the reading itself.
      const unchanged = km === shift.start_km || km === shift.end_km;
      if (km != null && (!unchanged || van !== shift.vehicle_id)) {
        const vName = van === shift.vehicle_id ? shift.vehicle_name
          : (await listVehicles({ includeInactive: true })).find((v) => v.id === van)?.name;
        // Judged against the van's readings AROUND THIS SHIFT'S OWN TIME, not
        // against whatever the van has read since.
        await assertOdometer(van, km, {
          vehicleName: vName, at: started || shift.started_at, excludeShiftId: id
        });
      }
    }
  }
  if (kmIn != null && kmOut != null && kmOut < kmIn) {
    throw new Error(`${kmOut.toLocaleString('en-CA')} km is lower than the ${kmIn.toLocaleString('en-CA')} km start.`);
  }

  const { rows } = await query(
    `UPDATE driver_shifts
        SET started_at = $2, ended_at = $3, start_km = $4, end_km = $5, vehicle_id = $8,
            note = COALESCE(NULLIF($6,''), note),
            edited_at = now(), edited_by = $7
      WHERE id = $1
      RETURNING *, NULL AS vehicle_name, NULL AS riding_with_name`,
    [id, started, ended, kmIn, kmOut, clean(note), clean(by, 120), van]
  );
  return shapeShift(rows[0]);
}

// What the stops say about when the day ended.
//
// A driver who forgets to clock off has still tapped Done on his last stop, and
// if there is a "return to base" on the end of his run that tap IS the moment he
// finished. The editor offers it rather than making the office go and look.
export async function lastStopFinish(userId, day) {
  if (!hasDb()) return null;
  const { rows } = await query(
    `SELECT j.time_out, j.type, j.customer_name
       FROM jobs j
      WHERE (j.driver_id = $1 OR j.driver2_id = $1)
        AND j.job_date = $2::date AND j.time_out IS NOT NULL
      ORDER BY j.time_out DESC LIMIT 1`,
    [Number(userId), day]
  );
  if (!rows.length) return null;
  return {
    at: rows[0].time_out.toISOString(),
    type: rows[0].type,
    what: rows[0].type === 'return_to_base' ? 'back at base' : (rows[0].customer_name || 'last stop')
  };
}

// A shift the office types in, for somebody who never clocked on at all.
//
// The editor could only ever fix a shift that EXISTED, and the drivers who
// forget are not reliably the ones who remembered to start. Nicholas Carter ran
// five stops on 10 September and has never started a shift in this system: his
// day has no hours, so it cannot be costed and cannot even be flagged, because
// there is no row to flag. Nothing in the app could produce one.
//
// Same shape as a correction rather than a clock-on: explicit times on a named
// day, in Toronto, from what the driver says in the group chat. It is stamped
// as office-entered on the way in, because a shift nobody's phone ever saw is a
// different kind of record and the person reading the hours should know.
export async function createShift({
  driverId, date, startTime, endTime, driving = true, vehicleId, ridingWith, startKm, endKm, note
} = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureShiftSchema();
  const uid = Number(driverId);
  if (!uid) throw new Error('Which driver?');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : torontoToday();
  if (!/^\d{1,2}:\d{2}$/.test(String(startTime || ''))) {
    throw new Error('Give the start time as 24-hour, like 07:30.');
  }

  const stamp = async (t) => {
    const { rows } = await query(
      `SELECT ($1::date + $2::time) AT TIME ZONE 'America/Toronto' AS ts`, [day, t]
    );
    return rows[0].ts;
  };
  const started = await stamp(startTime);
  let ended = /^\d{1,2}:\d{2}$/.test(String(endTime || '')) ? await stamp(endTime) : null;
  if (ended && ended <= started) ended = new Date(new Date(ended).getTime() + 86400000);
  if (ended) {
    const hours = (new Date(ended) - new Date(started)) / 3600000;
    if (hours > 20) throw new Error(`That is ${hours.toFixed(1)} hours — check the times.`);
  }

  // One open shift per driver is enforced by a partial unique index, and the
  // index's own error is unreadable. Say it in words, and say whose.
  if (!ended) {
    const open = await openShift(uid);
    if (open) {
      throw new Error(
        'That driver already has a shift open (since ' +
        new Date(open.startedAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) +
        '). Give this one an end time, or close the open one first.'
      );
    }
  }

  const isDriving = driving !== false;
  const van = isDriving && vehicleId ? Number(vehicleId) : null;
  const kmIn = isDriving ? int(startKm) : null;
  const kmOut = isDriving ? int(endKm) : null;
  if (kmIn != null && kmOut != null && kmOut < kmIn) {
    throw new Error(`${kmOut.toLocaleString('en-CA')} km is lower than the ${kmIn.toLocaleString('en-CA')} km start.`);
  }
  if (van) {
    const vName = (await listVehicles({ includeInactive: true })).find((v) => v.id === van)?.name;
    for (const km of [kmIn, kmOut]) {
      // Judged at the moment the shift belongs to, exactly as a correction is.
      if (km != null) await assertOdometer(van, km, { vehicleName: vName, at: started });
    }
  }

  const { rows } = await query(
    `INSERT INTO driver_shifts
       (user_id, driving, riding_with, vehicle_id, started_at, ended_at, start_km, end_km,
        note, edited_at, edited_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)
     RETURNING *, NULL AS vehicle_name, NULL AS riding_with_name`,
    [uid, isDriving, isDriving ? null : (ridingWith ? Number(ridingWith) : null), van,
     started, ended, kmIn, kmOut,
     clean(note) || 'entered by the office', clean(by, 120)]
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
  // For every shift the report cannot cost, what the stops say the finish time
  // was. Only for the broken ones — this is one query per row and there is no
  // reason to run it against a shift nobody needs to correct.
  await Promise.all(out.map(async (r) => {
    const hours = r.minutes == null ? null : r.minutes / 60;
    r.needsFixing = !r.endedAt || hours == null || hours <= 0 || hours > 14;
    if (r.needsFixing && r.startedAt) {
      r.lastStop = await lastStopFinish(
        r.driverId, new Date(r.startedAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
      );
    }
  }));
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
