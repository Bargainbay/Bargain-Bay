// Parts — what we have on the shelf, where it came from, and where it went.
//
// Three tables (db/schema.sql, provisioned here too):
//   parts         — the CATALOGUE: this part number, this name, what it fits.
//   part_moves    — every movement, in or out. **On-hand is SUM(qty)**, never a
//                   stored count: the same rule the general ledger follows, and
//                   the reason two people can't quietly disagree about stock.
//   part_requests — a service tech asks, an admin answers (see below).
//
// **Parts are always ours** (owner, 2026-09-15). RS Ops refurbishes other
// companies' lots, but a part on our shelf is our stock, whichever machine it
// came out of. Nothing here is keyed to a client.
//
// **Who may take one, and how:**
//   * The refurb floor takes a part straight off the shelf for a repair — but
//     marks it as they take it, which is what `usePart` records. Asking
//     permission to fix the machine in front of you is friction nobody keeps up.
//   * A service tech on the road REQUESTS, and an admin approves. The part is
//     held from the moment they ask, so two techs can't be promised the same
//     last igniter, and the hold dies with a rejection.
//
// **Cost, for a part cut out of a salvage unit** (owner's rule):
//   * From a PURCHASED lot, the unit's cost is spread across the parts taken out
//     of it, weighted by what the person cutting it out reckoned each is worth.
//   * From a HAUL-AWAY (cost 0), the parts cost nothing. Nothing to spread.
//   The spread happens when the unit is FINISHED being parted out, not per part:
//   until then nobody knows what else is coming off it.
import { hasDb, query, withTransaction } from './db';
import { normCode } from './location-codes';
// The labels live apart because the screens need them and must not pull ./db
// into the browser — same split as location-codes / locations.
import { MOVE_REASONS, PART_CONDITIONS } from './parts-labels';

export { MOVE_REASONS, PART_CONDITIONS };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS parts (
    id          serial PRIMARY KEY,
    part_number text,
    name        text NOT NULL,
    brand       text,
    category    text,
    fits        text[],
    note        text,
    created_by  text,
    created_at  timestamptz DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_number ON parts (upper(part_number))
    WHERE part_number IS NOT NULL AND part_number <> '';
  CREATE INDEX IF NOT EXISTS idx_parts_name ON parts (lower(name));
  CREATE TABLE IF NOT EXISTS part_moves (
    id        bigserial PRIMARY KEY,
    part_id   int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    qty       int NOT NULL,
    condition text NOT NULL DEFAULT 'used',
    location  text,
    cost      numeric(10,2),
    est_value numeric(10,2),
    reason    text NOT NULL,
    ref       text,
    note      text,
    by        text,
    by_name   text,
    at        timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_part_moves_part ON part_moves(part_id, at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_part_moves_ref  ON part_moves(ref);
  CREATE TABLE IF NOT EXISTS part_requests (
    id                serial PRIMARY KEY,
    part_id           int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    qty               int NOT NULL DEFAULT 1,
    reason            text,
    job_ref           text,
    status            text NOT NULL DEFAULT 'pending',
    requested_by      text,
    requested_by_name text,
    decided_by        text,
    decided_by_name   text,
    decided_at        timestamptz,
    picked_at         timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_part_requests_open ON part_requests(status, created_at DESC);
  ALTER TABLE salvage_units ADD COLUMN IF NOT EXISTS disposal text;
`;

let _schema = null;
export function ensurePartSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) _schema = query(SCHEMA).catch((e) => { _schema = null; throw e; });
  return _schema;
}

const clean = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const iso = (d) => (d ? new Date(d).toISOString() : null);
const conditionOf = (v) => (PART_CONDITIONS[v] ? v : 'used');

// Stock changes for ONE part are serialised, so two people taking the last
// igniter at the same moment can't both be told yes. Append-only rows cannot be
// locked against an insert that doesn't exist yet, which is what an advisory
// lock is for.
const lockPart = (client, partId) => client.query('SELECT pg_advisory_xact_lock($1)', [Number(partId)]);

// What a part actually is, plus its on-hand, for a list of ids.
export async function describeParts(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
  if (!list.length || !hasDb()) return [];
  await ensurePartSchema();
  const { rows } = await query(
    `SELECT p.id, p.part_number, p.name, p.brand, p.category, p.fits, p.note,
            COALESCE(s.on_hand, 0)::int       AS on_hand,
            COALESCE(s.value_at_cost, 0)      AS value_at_cost,
            COALESCE(s.unpriced, 0)::int      AS unpriced,
            COALESCE(h.held, 0)::int          AS held,
            COALESCE(sp.spots, '[]'::json)    AS spots
       FROM parts p
       LEFT JOIN LATERAL (
         SELECT SUM(qty)::int AS on_hand,
                SUM(GREATEST(qty, 0) * COALESCE(cost, 0)) AS value_at_cost,
                SUM(CASE WHEN qty > 0 AND cost IS NULL AND reason <> 'harvest' THEN qty ELSE 0 END)::int AS unpriced
           FROM part_moves WHERE part_id = p.id
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT SUM(qty)::int AS held FROM part_requests
          WHERE part_id = p.id AND status IN ('pending', 'approved')
       ) h ON true
       -- Where the pieces actually are: one row per SPOT, and only where
       -- something is left. A spot that has been emptied is not a place to send
       -- somebody looking.
       --
       -- Grouped by spot ALONE, deliberately. Taking a part out doesn't know
       -- whether the piece in somebody's hand was the new one or the used one —
       -- usePart records it as 'used' — so grouping by condition as well made the
       -- buckets drift apart: a part with one piece left read "L3-2 x2" because
       -- the take came off the wrong bucket. The total is what somebody walking
       -- to the bin needs; which pieces were new is still on every incoming move
       -- and in the history.
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('location', g.location, 'qty', g.qty)
                         ORDER BY g.qty DESC) AS spots
           FROM (SELECT location, SUM(qty)::int AS qty
                   FROM part_moves WHERE part_id = p.id
                  GROUP BY location HAVING SUM(qty) > 0) g
       ) sp ON true
      WHERE p.id = ANY($1::int[])`,
    [list]
  );
  const bySku = new Map(rows.map((r) => [r.id, {
    id: r.id,
    partNumber: r.part_number || '',
    name: r.name,
    brand: r.brand || '',
    category: r.category || '',
    fits: r.fits || [],
    note: r.note || '',
    onHand: r.on_hand,
    held: r.held,
    available: Math.max(0, r.on_hand - r.held),
    valueAtCost: r.value_at_cost == null ? 0 : Number(r.value_at_cost),
    // Pieces booked in with no price (RS Ops books without one). Admin-only,
    // like valueAtCost — stripped by every route that serves a non-admin.
    unpriced: r.unpriced,
    // One row per place it is kept. Deduped: the lateral above repeats a group
    // per move, which is exactly the shape json_agg would otherwise multiply.
    spots: (r.spots || []).map((s) => ({ location: s.location || null, qty: s.qty }))
  }]));
  return list.map((id) => bySku.get(id)).filter(Boolean);
}

// Search the catalogue: part number, name, brand, or a model it fits. A part
// number is what somebody reads off the old part, so it matches loosely —
// W10295370A and w10295370 are the same search.
export async function searchParts(q, { limit = 60 } = {}) {
  if (!hasDb()) return [];
  await ensurePartSchema();
  const term = String(q || '').trim();
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const loose = `%${term.replace(/[^A-Za-z0-9]/g, '')}%`;
  const { rows } = await query(
    term
      ? `SELECT id FROM parts
          WHERE name ILIKE $1 OR brand ILIKE $1 OR category ILIKE $1
             OR part_number ILIKE $1
             OR regexp_replace(COALESCE(part_number, ''), '[^A-Za-z0-9]', '', 'g') ILIKE $2
             OR EXISTS (SELECT 1 FROM unnest(COALESCE(fits, '{}')) f WHERE f ILIKE $1)
          ORDER BY name LIMIT $3`
      // An empty box shows what was booked in most recently. Its own parameter
      // list: the search branch's $3 does not exist here.
      : 'SELECT id FROM parts ORDER BY created_at DESC LIMIT $1',
    term ? [like, loose, limit] : [limit]
  );
  return describeParts(rows.map((r) => r.id));
}

export async function getPart(id) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const [part] = await describeParts([id]);
  if (!part) throw new Error('No such part.');
  const { rows: moves } = await query(
    `SELECT id, qty, condition, location, cost, reason, ref, note, by_name, at
       FROM part_moves WHERE part_id = $1 ORDER BY at DESC, id DESC LIMIT 40`,
    [part.id]
  );
  const { rows: requests } = await query(
    `SELECT id, qty, reason, job_ref, status, requested_by_name, decided_by_name, decided_at, created_at
       FROM part_requests WHERE part_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [part.id]
  );
  return {
    ...part,
    moves: moves.map((m) => ({
      id: m.id, qty: m.qty, condition: m.condition, location: m.location, cost: m.cost == null ? null : Number(m.cost),
      reason: m.reason, ref: m.ref, note: m.note, by: m.by_name, at: iso(m.at)
    })),
    requests: requests.map((r) => ({
      id: r.id, qty: r.qty, reason: r.reason, jobRef: r.job_ref, status: r.status,
      requestedBy: r.requested_by_name, decidedBy: r.decided_by_name, decidedAt: iso(r.decided_at), createdAt: iso(r.created_at)
    }))
  };
}

// Add a catalogue row. A part NUMBER is the identity when there is one, so
// adding the same number twice returns what is already there rather than
// splitting the stock of one part across two rows.
export async function addPart({ partNumber, name, brand, category, fits, note, by = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const number = clean(partNumber, 60);
  const label = clean(name, 160);
  if (!label && !number) throw new Error('Give the part a name, or its part number.');
  const models = (Array.isArray(fits) ? fits : String(fits || '').split(','))
    .map((f) => clean(f, 60)).filter(Boolean).slice(0, 40);
  if (number) {
    const { rows } = await query('SELECT id FROM parts WHERE upper(part_number) = upper($1)', [number]);
    if (rows[0]) {
      // Fill in anything the existing row is missing rather than refusing — the
      // second person to meet a part usually knows more about it.
      await query(
        `UPDATE parts SET name = COALESCE(NULLIF(name, ''), $2), brand = COALESCE(brand, $3),
                          category = COALESCE(category, $4),
                          fits = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(fits, '{}') || $5::text[])))
           WHERE id = $1`,
        [rows[0].id, label || number, clean(brand, 60), clean(category, 60), models]
      );
      const [part] = await describeParts([rows[0].id]);
      return { ...part, existed: true };
    }
  }
  const { rows } = await query(
    `INSERT INTO parts (part_number, name, brand, category, fits, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [number, label || number, clean(brand, 60), clean(category, 60), models, clean(note, 500), by]
  );
  const [part] = await describeParts([rows[0].id]);
  return { ...part, existed: false };
}

async function assertSpot(code) {
  if (!code) return null;
  const spot = normCode(code);
  const { rows } = await query('SELECT code, active FROM warehouse_locations WHERE code = $1', [spot]);
  if (!rows[0]) throw new Error(`There is no spot called ${spot}.`);
  if (!rows[0].active) throw new Error(`${spot} has been retired — pick another spot.`);
  return spot;
}

// Stock in: bought, found in a count, or corrected. Harvesting has its own path.
export async function receiveParts({ partId, qty = 1, condition, location, cost, reason = 'purchase', ref, note, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const n = Math.round(Number(qty));
  if (!Number.isFinite(n) || n === 0) throw new Error('How many?');
  if (n < 0) throw new Error('That takes parts out — use the take-out path so it checks the shelf first.');
  const spot = await assertSpot(location);
  const { rows } = await query(
    `INSERT INTO part_moves (part_id, qty, condition, location, cost, reason, ref, note, by, by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [Number(partId), n, conditionOf(condition), spot, num(cost), MOVE_REASONS[reason] ? reason : 'purchase',
      clean(ref, 60), clean(note, 300), by, byName]
  );
  const [part] = await describeParts([partId]);
  return { moveId: rows[0].id, part };
}

// Stock out. Refuses to go below what is on the shelf — a count that can go
// negative is a count nobody believes.
export async function usePart({ partId, qty = 1, location, reason = 'use_unit', ref, note, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const n = Math.round(Number(qty));
  if (!Number.isFinite(n) || n <= 0) throw new Error('How many?');
  const spot = location ? await assertSpot(location) : null;
  const id = Number(partId);
  await withTransaction(async (client) => {
    await lockPart(client, id);
    const { rows } = await client.query(
      spot
        ? 'SELECT COALESCE(SUM(qty), 0)::int AS n FROM part_moves WHERE part_id = $1 AND location = $2'
        : 'SELECT COALESCE(SUM(qty), 0)::int AS n FROM part_moves WHERE part_id = $1',
      spot ? [id, spot] : [id]
    );
    const have = rows[0].n;
    if (have < n) {
      throw new Error(spot
        ? `Only ${have} in ${spot} — check another spot, or count it.`
        : `Only ${have} on the shelf.`);
    }
    await client.query(
      `INSERT INTO part_moves (part_id, qty, condition, location, reason, ref, note, by, by_name)
       VALUES ($1,$2,'used',$3,$4,$5,$6,$7,$8)`,
      [id, -n, spot, MOVE_REASONS[reason] ? reason : 'use_unit', clean(ref, 60), clean(note, 300), by, byName]
    );
  });
  const [part] = await describeParts([id]);
  return { part };
}

// Book a part in from scratch: find-or-create the catalogue row, then put the
// pieces on the shelf. One call, because the refurb floor books in from RS Ops
// and a half-done booking (a catalogue row with nothing on the shelf, left behind
// by a mistyped spot) is a part the next search offers as "none". So the spot is
// checked BEFORE anything is written.
export async function bookInPart({ part, qty = 1, condition, location, reason = 'purchase', note, by = null, byName = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const n = Math.round(Number(qty));
  if (!Number.isFinite(n) || n <= 0) throw new Error('How many?');
  await assertSpot(location);
  const row = await addPart({ ...(part || {}), by });
  const out = await receiveParts({ partId: row.id, qty: n, condition, location, reason, note, by, byName });
  return { ...out, existed: row.existed };
}

// Put a price on the pieces nobody priced. The floor books parts in without a
// cost (cost is the office's), so without this every part booked from RS Ops
// would sit at $0 on the shelf forever. Only INCOMING, UNPRICED, non-harvest
// moves are touched: a price somebody already set is a decision, and a harvested
// part is costed by finishPartOut from the unit it came out of.
export async function priceParts({ partId, cost }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const c = num(cost);
  if (c == null || c < 0) throw new Error('What does one cost?');
  const { rowCount } = await query(
    `UPDATE part_moves SET cost = $2
      WHERE part_id = $1 AND qty > 0 AND cost IS NULL AND reason <> 'harvest'`,
    [Number(partId), c]
  );
  const [part] = await describeParts([partId]);
  return { priced: rowCount, part };
}

// ── Parting out a salvage unit ──────────────────────────────────────────────

// What is on this unit so far, and what it will cost. Read before finishing.
export async function partOutState(salvageSku) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const sku = String(salvageSku || '').trim();
  const { rows: unitRows } = await query(
    'SELECT sku, make, model, title, cost, status, disposal FROM salvage_units WHERE upper(sku) = upper($1)',
    [sku]
  );
  const unit = unitRows[0] || null;
  const { rows: taken } = await query(
    `SELECT m.id, m.part_id, m.qty, m.condition, m.location, m.est_value, m.cost, m.at, p.name, p.part_number
       FROM part_moves m JOIN parts p ON p.id = m.part_id
      WHERE m.reason = 'harvest' AND upper(m.ref) = upper($1)
      ORDER BY m.at, m.id`,
    [sku]
  );
  return {
    unit: unit && {
      sku: unit.sku, make: unit.make, model: unit.model, title: unit.title,
      cost: unit.cost == null ? null : Number(unit.cost),
      status: unit.status, disposal: unit.disposal || null
    },
    parts: taken.map((t) => ({
      moveId: t.id, partId: t.part_id, name: t.name, partNumber: t.part_number || '',
      qty: t.qty, condition: t.condition, location: t.location,
      estValue: t.est_value == null ? null : Number(t.est_value),
      cost: t.cost == null ? null : Number(t.cost),
      at: iso(t.at)
    }))
  };
}

// Take one part off a salvage unit. Cost is deliberately NOT set here — see
// finishPartOut. `estValue` is what the person cutting it out reckons it's
// worth, and it is only ever used to split the unit's cost between the parts.
export async function harvestPart({ salvageSku, partId, part, condition = 'used', estValue, location, note, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const sku = String(salvageSku || '').trim();
  if (!sku) throw new Error('Which unit is it coming out of?');
  const { rows: unit } = await query('SELECT sku, status FROM salvage_units WHERE upper(sku) = upper($1)', [sku]);
  if (!unit[0]) throw new Error(`${sku} isn't in the salvage list. Sync salvage from the tracker first.`);
  if (unit[0].status === 'disposed') throw new Error(`${sku} is already finished — it was invoiced or parted out.`);
  const spot = await assertSpot(location);
  const target = partId ? { id: Number(partId) } : await addPart({ ...(part || {}), by });
  const { rows } = await query(
    `INSERT INTO part_moves (part_id, qty, condition, location, est_value, reason, ref, note, by, by_name)
     VALUES ($1, 1, $2, $3, $4, 'harvest', $5, $6, $7, $8) RETURNING id`,
    [target.id, conditionOf(condition), spot, num(estValue), unit[0].sku, clean(note, 300), by, byName]
  );
  return { moveId: rows[0].id, part: (await describeParts([target.id]))[0] };
}

export async function removeHarvested(moveId) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  const { rowCount } = await query(
    `DELETE FROM part_moves WHERE id = $1 AND reason = 'harvest' AND cost IS NULL`,
    [Number(moveId)]
  );
  // Cost is set when the unit is finished; after that the part is stock like any
  // other and comes off the shelf through the ordinary path, not by deleting history.
  if (!rowCount) throw new Error('That part has already been costed — take it off the shelf instead.');
  return { ok: true };
}

// Finish: split the unit's cost across what came out of it, and dispose of it.
//
// A HAUL-AWAY cost nothing, so its parts cost nothing — the owner's rule, and
// also just arithmetic: there is nothing to spread. A PURCHASED unit's cost is
// spread by estimated value, because a $150 control board and a $20 valve out of
// the same machine did not each carry half its cost. With no estimates at all it
// splits evenly; the last part carries the rounding so the pennies add up to
// exactly what the unit cost.
export async function finishPartOut({ salvageSku, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const { unit, parts } = await partOutState(salvageSku);
  if (!unit) throw new Error(`${salvageSku} isn't in the salvage list.`);
  if (unit.status === 'disposed') throw new Error(`${unit.sku} is already finished.`);
  if (!parts.length) throw new Error('Nothing has been taken off this unit yet.');

  const total = Math.max(0, Number(unit.cost) || 0);
  const weights = parts.map((p) => (Number(p.estValue) > 0 ? Number(p.estValue) : 0));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(total * 100);
  const share = [];
  let used = 0;
  parts.forEach((p, i) => {
    const w = weightSum > 0 ? weights[i] / weightSum : 1 / parts.length;
    const c = i === parts.length - 1 ? cents - used : Math.round(cents * w);
    used += c;
    share.push(Math.max(0, c) / 100);
  });

  await withTransaction(async (client) => {
    for (let i = 0; i < parts.length; i++) {
      await client.query('UPDATE part_moves SET cost = $2 WHERE id = $1', [parts[i].moveId, share[i]]);
    }
    await client.query(
      `UPDATE salvage_units SET status = 'disposed', disposal = 'parted_out', disposed_at = now()
        WHERE upper(sku) = upper($1)`,
      [unit.sku]
    );
  });

  return {
    sku: unit.sku,
    unitCost: total,
    parts: parts.map((p, i) => ({ ...p, cost: share[i] })),
    costed: total > 0
  };
}

// ── Requests: the road crew asks, an admin answers ──────────────────────────

export async function requestPart({ partId, qty = 1, reason, jobRef, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const n = Math.round(Number(qty));
  if (!Number.isFinite(n) || n <= 0) throw new Error('How many?');
  const [part] = await describeParts([partId]);
  if (!part) throw new Error('No such part.');
  if (part.available < n) {
    throw new Error(part.onHand === 0
      ? `There are none on the shelf — ${part.name} has to be ordered.`
      : `Only ${part.available} free (${part.onHand} on the shelf, ${part.held} already spoken for).`);
  }
  const { rows } = await query(
    `INSERT INTO part_requests (part_id, qty, reason, job_ref, requested_by, requested_by_name)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [part.id, n, clean(reason, 300), clean(jobRef, 40), by, byName]
  );
  return { id: rows[0].id, part };
}

export async function listRequests({ status = 'open', limit = 100 } = {}) {
  if (!hasDb()) return [];
  await ensurePartSchema();
  const where = status === 'open' ? "r.status IN ('pending','approved')" : status === 'all' ? 'true' : 'r.status = $2';
  const params = status === 'open' || status === 'all' ? [limit] : [limit, status];
  const { rows } = await query(
    `SELECT r.id, r.qty, r.reason, r.job_ref, r.status, r.requested_by_name, r.decided_by_name,
            r.decided_at, r.picked_at, r.created_at, r.part_id, p.name, p.part_number
       FROM part_requests r JOIN parts p ON p.id = r.part_id
      WHERE ${where} ORDER BY r.created_at DESC LIMIT $1`,
    params
  );
  return rows.map((r) => ({
    id: r.id, partId: r.part_id, name: r.name, partNumber: r.part_number || '',
    qty: r.qty, reason: r.reason, jobRef: r.job_ref, status: r.status,
    requestedBy: r.requested_by_name, decidedBy: r.decided_by_name,
    decidedAt: iso(r.decided_at), pickedAt: iso(r.picked_at), createdAt: iso(r.created_at)
  }));
}

// Approve or refuse. Approving does NOT move stock — the part is still on the
// shelf until somebody physically picks it up, and the hold is what stops it
// being promised twice in the meantime.
export async function decideRequest({ id, approve, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const { rows } = await query(
    `UPDATE part_requests SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING id, part_id, status`,
    [Number(id), approve ? 'approved' : 'rejected', by, byName]
  );
  if (!rows[0]) throw new Error('That request has already been answered.');
  return { id: rows[0].id, status: rows[0].status };
}

// The tech has it in their hand: now the shelf changes.
export async function pickRequest({ id, location, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensurePartSchema();
  const { rows } = await query(
    `SELECT id, part_id, qty, job_ref, status, requested_by_name FROM part_requests WHERE id = $1`,
    [Number(id)]
  );
  const req = rows[0];
  if (!req) throw new Error('No such request.');
  if (req.status !== 'approved') throw new Error(`That request is ${req.status} — only an approved one can be picked up.`);
  // Claim it first: two screens must not spend the same approval twice.
  const { rows: claimed } = await query(
    `UPDATE part_requests SET status = 'picked', picked_at = now() WHERE id = $1 AND status = 'approved' RETURNING id`,
    [req.id]
  );
  if (!claimed[0]) throw new Error('That request has just been picked up by somebody else.');
  try {
    await usePart({
      partId: req.part_id, qty: req.qty, location, reason: 'use_job',
      ref: req.job_ref, note: `Request #${req.id} for ${req.requested_by_name || 'a tech'}`, by, byName
    });
  } catch (e) {
    await query(`UPDATE part_requests SET status = 'approved', picked_at = NULL WHERE id = $1`, [req.id]);
    throw e;
  }
  return { id: req.id, status: 'picked' };
}

export async function cancelRequest({ id, by = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  const { rows } = await query(
    `UPDATE part_requests SET status = 'cancelled', decided_by = COALESCE(decided_by, $2), decided_at = now()
      WHERE id = $1 AND status IN ('pending','approved') RETURNING id`,
    [Number(id), by]
  );
  if (!rows[0]) throw new Error('That request is already closed.');
  return { id: rows[0].id, status: 'cancelled' };
}

// The headline numbers, and the salvage units waiting to be stripped.
export async function partsOverview() {
  if (!hasDb()) return { kinds: 0, pieces: 0, valueAtCost: 0, openRequests: 0, salvage: [] };
  await ensurePartSchema();
  const [{ rows: totals }, { rows: reqs }, { rows: salvage }] = await Promise.all([
    query(`SELECT COUNT(DISTINCT p.id)::int AS kinds,
                  COALESCE(SUM(m.qty), 0)::int AS pieces,
                  COALESCE(SUM(GREATEST(m.qty, 0) * COALESCE(m.cost, 0)), 0) AS value
             FROM parts p LEFT JOIN part_moves m ON m.part_id = p.id`),
    query(`SELECT COUNT(*)::int AS n FROM part_requests WHERE status = 'pending'`),
    query(`SELECT sku, make, model, title, cost FROM salvage_units
            WHERE status <> 'disposed' ORDER BY sku LIMIT 200`)
  ]);
  return {
    kinds: totals[0].kinds,
    pieces: totals[0].pieces,
    valueAtCost: Number(totals[0].value) || 0,
    openRequests: reqs[0].n,
    salvage: salvage.map((s) => ({
      sku: s.sku, make: s.make || '', model: s.model || '', title: s.title || '',
      cost: s.cost == null ? null : Number(s.cost)
    }))
  };
}
