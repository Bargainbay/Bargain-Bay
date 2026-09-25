// Where a unit is physically standing in the warehouse (1135 Squires Beach Rd).
//
// Three tables, provisioned here and mirrored in db/migrations/0001_baseline.sql:
//   warehouse_locations — every spot: a rack shelf (L3-2), a floor lane (V4),
//                         or a holding area (RECEIVING).
//   unit_moves          — one row every time a unit is put somewhere.
//   location_audits     — one row every time somebody counts a spot.
//
// **Where a unit is now is its LATEST move — it is never a column that gets
// overwritten.** "Where was it on Tuesday" and "who moved it" are the questions
// asked the day a unit can't be found, and a single location field cannot answer
// either.
//
// **It is not on `products`, and must never be.** `upsertProducts` rewrites every
// column of a product row on every tracker sync — the same reason unit photos
// have their own table. A location stored there would be wiped the next time
// somebody pressed Sync. Keyed by SKU in its own table, and joined on read.
//
// **A unit that has LEFT is worked out, not recorded.** Delivery, pickup and
// salvage disposal already have their own paths and nothing here hangs off them;
// a unit stops being "in" its spot when an order carrying it reads `delivered`,
// or its salvage row reads `disposed`, AFTER it was last put there. So a unit
// that comes back (a return, a failed delivery) and is scanned into a spot again
// is in stock again with no extra step. `delivered_at` is only stamped by the
// driver app — an order marked delivered from the board, which is how a pickup
// ends, has none — so a missing time counts as "already gone".
//
// **SKUs are stored as the site spells them.** A scan or a typed SKU is matched
// case-insensitively against products, salvage and earlier moves, and the row is
// written with THAT spelling, so every join below can be a plain equality. A SKU
// the site has never heard of is still accepted: untested stock and units waiting
// for parts live only in the tracker until they're tested, and those are exactly
// the units that get parked in a lane for weeks.
import { hasDb, query, withTransaction } from './db';
import { AREAS, SPOT_CODE_RE, normCode, normSku } from './location-codes';

const MAX_MOVE = 200;          // one skid, one put-away session
const MAX_COUNT = 400;         // one lane's worth of scans
export const UNPLACED_SOLD_DAYS = 45;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS warehouse_locations (
    code       text PRIMARY KEY,
    kind       text NOT NULL,
    area       text NOT NULL,
    section    int,
    level      int,
    purpose    text,
    note       text,
    active     boolean NOT NULL DEFAULT true,
    sort       int NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS unit_moves (
    id            bigserial PRIMARY KEY,
    sku           text NOT NULL,
    location      text,
    moved_by      text,
    moved_by_name text,
    via           text,
    note          text,
    title         text,
    moved_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_unit_moves_sku ON unit_moves(sku, moved_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_unit_moves_sku_upper ON unit_moves(upper(sku));
  CREATE INDEX IF NOT EXISTS idx_unit_moves_location ON unit_moves(location);
  CREATE TABLE IF NOT EXISTS location_audits (
    id              bigserial PRIMARY KEY,
    location        text NOT NULL,
    counted_by      text,
    counted_by_name text,
    expected        int,
    confirmed       int,
    missing         jsonb,
    found           jsonb,
    counted_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_location_audits_loc ON location_audits(location, counted_at DESC);
  CREATE TABLE IF NOT EXISTS warehouse_areas (
    key        text PRIMARY KEY,
    label      text NOT NULL,
    sort       int NOT NULL DEFAULT 0,
    active     boolean NOT NULL DEFAULT true,
    created_by text,
    created_at timestamptz DEFAULT now()
  );
`;

// The building as the owner described it on 2026-09-15. Seeded ONLY into an
// empty table — once anybody has added or retired a spot, the table is the
// layout and this is history.
function defaultLayout() {
  const out = [];
  let sort = 0;
  const rack = (prefix, area, sections, levels) => {
    for (let s = 1; s <= sections; s++) {
      for (let l = 1; l <= levels; l++) {
        out.push({ code: `${prefix}${s}-${l}`, kind: 'rack', area, section: s, level: l, sort: sort++ });
      }
    }
  };
  // Shelves count UP from the floor: L3-1 is the bottom shelf of section 3.
  rack('L', 'left', 7, 3);
  rack('B', 'back', 2, 3);
  rack('R', 'right', 6, 3);
  // The four front lanes are two back-to-back pairs.
  for (let i = 1; i <= 4; i++) {
    out.push({ code: `V${i}`, kind: 'lane', area: 'front', section: i, sort: sort++,
      note: `Back to back with V${i % 2 ? i + 1 : i - 1}` });
  }
  for (let i = 1; i <= 6; i++) out.push({ code: `H${i}`, kind: 'lane', area: 'rear', section: i, sort: sort++ });
  for (const code of ['RECEIVING', 'DELIVERY-STAGING', 'PICKUP-STAGING']) {
    out.push({ code, kind: 'zone', area: 'zone', sort: sort++ });
  }
  return out;
}

let _schema = null;
export function ensureLocationSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = (async () => {
      await query(SCHEMA);
      // The areas started life as a constant (AREAS). They are a table now so an
      // admin can set up a new part of the building without a deploy — seeded from
      // that constant into an EMPTY table only, same rule as the spots below.
      await query(
        `INSERT INTO warehouse_areas (key, label, sort)
         SELECT a.key, a.label, a.sort FROM json_to_recordset($1::json) AS a(key text, label text, sort int)
          WHERE NOT EXISTS (SELECT 1 FROM warehouse_areas)
         ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify(AREAS.map((a, i) => ({ ...a, sort: i })))]
      );
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM warehouse_locations');
      if (!rows[0].n) {
        await withTransaction(async (client) => {
          for (const s of defaultLayout()) {
            await client.query(
              `INSERT INTO warehouse_locations (code, kind, area, section, level, note, sort)
               VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`,
              [s.code, s.kind, s.area, s.section ?? null, s.level ?? null, s.note ?? null, s.sort]
            );
          }
        });
      }
    })().catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// "Where is it now" — the ONE definition. `latest` is each unit's most recent
// move; `here` is the subset that is still in the building (see the header). When
// `filtered`, $1 is the text[] of SKUs to look at.
function hereCte(filtered) {
  return `
    latest AS (
      SELECT DISTINCT ON (m.sku) m.sku, m.location, m.moved_at, m.moved_by_name, m.via
        FROM unit_moves m
       ${filtered ? 'WHERE m.sku = ANY($1::text[])' : ''}
       ORDER BY m.sku, m.moved_at DESC, m.id DESC
    ),
    here AS (
      SELECT l.* FROM latest l
       WHERE l.location IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE oi.sku = l.sku AND COALESCE(oi.kind, 'unit') = 'unit'
              AND o.status = 'delivered' AND COALESCE(o.delivered_at, now()) > l.moved_at)
         AND NOT EXISTS (
           SELECT 1 FROM salvage_units s
            WHERE s.sku = l.sku AND s.status = 'disposed' AND COALESCE(s.disposed_at, now()) > l.moved_at)
    )`;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
const clean = (v, max) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

// The site's own spelling of each SKU, in the order given. A SKU it has never
// seen comes back exactly as typed.
export async function canonicalSkus(list) {
  const raw = (Array.isArray(list) ? list : [list]).map(normSku).filter(Boolean);
  if (!raw.length || !hasDb()) return raw;
  await ensureLocationSchema();
  const { rows } = await query(
    `SELECT w.ord, COALESCE(
        (SELECT p.sku FROM products p WHERE upper(p.sku) = upper(w.raw) LIMIT 1),
        (SELECT s.sku FROM salvage_units s WHERE upper(s.sku) = upper(w.raw) LIMIT 1),
        (SELECT m.sku FROM unit_moves m WHERE upper(m.sku) = upper(w.raw) LIMIT 1),
        w.raw) AS sku
       FROM unnest($1::text[]) WITH ORDINALITY AS w(raw, ord)
      ORDER BY w.ord`,
    [raw]
  );
  return rows.map((r) => r.sku);
}

// Everything the screens show about a unit, for a list of (canonical) SKUs, in
// the order given. Works for a SKU nobody has placed and for one the site has
// never heard of.
export async function describeUnits(skus) {
  const list = [...new Set((Array.isArray(skus) ? skus : []).map(normSku).filter(Boolean))];
  if (!list.length || !hasDb()) return [];
  await ensureLocationSchema();
  const { rows } = await query(
    `WITH want AS (SELECT DISTINCT unnest($1::text[]) AS sku), ${hereCte(true)}
     SELECT w.sku,
            COALESCE(NULLIF(p.title, ''), NULLIF(concat_ws(' ', p.make, p.model), ''),
                     NULLIF(s.title, ''), NULLIF(concat_ws(' ', s.make, s.model), ''),
                     (SELECT m.title FROM unit_moves m
                       WHERE m.sku = w.sku AND m.title IS NOT NULL
                       ORDER BY m.moved_at DESC, m.id DESC LIMIT 1)) AS title,
            COALESCE(p.make, s.make) AS make, COALESCE(p.model, s.model) AS model,
            p.category, p.condition,
            CASE WHEN p.sold_at IS NOT NULL THEN 'sold'
                 WHEN p.active THEN 'for_sale'
                 WHEN s.sku IS NOT NULL AND s.status = 'disposed' THEN 'salvage_gone'
                 WHEN s.sku IS NOT NULL THEN 'salvage'
                 WHEN p.sku IS NOT NULL THEN 'not_listed'
                 ELSE 'unknown' END AS status,
            (SELECT o.order_number FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE oi.sku = w.sku AND o.status NOT IN ('cancelled', 'refunded')
              ORDER BY o.id DESC LIMIT 1) AS order_number,
            h.location, h.moved_at, h.moved_by_name, h.via,
            l.sku IS NOT NULL AS ever_placed,
            (l.sku IS NOT NULL AND h.sku IS NULL) AS gone
       FROM want w
       LEFT JOIN here h ON h.sku = w.sku
       LEFT JOIN latest l ON l.sku = w.sku
       LEFT JOIN products p ON p.sku = w.sku
       LEFT JOIN salvage_units s ON s.sku = w.sku`,
    [list]
  );
  const bySku = new Map(rows.map((r) => [r.sku, {
    sku: r.sku,
    title: r.title || '',
    make: r.make || '',
    model: r.model || '',
    category: r.category || '',
    condition: r.condition || '',
    status: r.status,
    orderNumber: r.order_number || null,
    location: r.location || null,
    movedAt: iso(r.moved_at),
    movedBy: r.moved_by_name || null,
    via: r.via || null,
    everPlaced: !!r.ever_placed,
    gone: !!r.gone
  }]));
  return list.map((sku) => bySku.get(sku)).filter(Boolean);
}

// sku → { code, movedAt } for the units still in the building. For the screens
// that only want to print a spot beside a line (the order board, the packing slip).
export async function currentLocations(skus) {
  const list = [...new Set((Array.isArray(skus) ? skus : []).map(normSku).filter(Boolean))];
  const out = new Map();
  if (!list.length || !hasDb()) return out;
  await ensureLocationSchema();
  const { rows } = await query(`WITH ${hereCte(true)} SELECT sku, location, moved_at FROM here`, [list]);
  for (const r of rows) out.set(r.sku, { code: r.location, movedAt: iso(r.moved_at) });
  return out;
}

export async function listLocations() {
  if (!hasDb()) return [];
  await ensureLocationSchema();
  const { rows } = await query(
    `WITH ${hereCte(false)}
     SELECT w.code, w.kind, w.area, w.section, w.level, w.purpose, w.note, w.active, w.sort,
            COALESCE(c.n, 0)::int AS count, a.counted_at, a.missing_n
       FROM warehouse_locations w
       LEFT JOIN (SELECT location, COUNT(*) AS n FROM here GROUP BY location) c ON c.location = w.code
       LEFT JOIN LATERAL (
         SELECT la.counted_at, jsonb_array_length(COALESCE(la.missing, '[]'::jsonb)) AS missing_n
           FROM location_audits la WHERE la.location = w.code
          ORDER BY la.counted_at DESC LIMIT 1
       ) a ON true
      ORDER BY w.sort, w.code`
  );
  return rows.map((r) => ({
    code: r.code,
    kind: r.kind,
    area: r.area,
    section: r.section,
    level: r.level,
    purpose: r.purpose || '',
    note: r.note || '',
    active: r.active,
    count: r.count,
    lastCountedAt: iso(r.counted_at),
    lastMissing: r.missing_n == null ? null : Number(r.missing_n)
  }));
}

async function getSpot(code) {
  const { rows } = await query('SELECT * FROM warehouse_locations WHERE code = $1', [normCode(code)]);
  return rows[0] || null;
}

async function assertOpenSpot(code) {
  const spot = await getSpot(code);
  if (!spot) throw new Error(`There is no spot called ${code}.`);
  if (!spot.active) throw new Error(`${code} has been retired — pick another spot.`);
  return spot;
}

async function skusAt(code) {
  const { rows } = await query(
    `WITH ${hereCte(false)} SELECT sku FROM here WHERE location = $1 ORDER BY moved_at DESC`,
    [normCode(code)]
  );
  return rows.map((r) => r.sku);
}

export async function locationContents(code) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureLocationSchema();
  const target = normCode(code);
  const spot = (await listLocations()).find((s) => s.code === target);
  if (!spot) throw new Error(`There is no spot called ${target}.`);
  return { spot, units: await describeUnits(await skusAt(target)) };
}

// Clearing a whole bay into another one. A rack gets emptied into a lane in one
// trolley load, and scanning forty units that are all going to the same place is
// exactly the friction that sends people back to remembering.
//
// It moves what is RECORDED in `from`, which is only ever as right as that spot's
// last count — so both screens name the number before they ask, and say to count
// the destination afterwards. Every unit still gets its OWN move row: the history
// is per unit, or "where was this fridge on Tuesday" stops having an answer.
export async function moveSpotContents({ from, to, by = null, byName = null, via = 'bulk', note = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureLocationSchema();
  const src = normCode(from);
  const dst = normCode(to);
  if (!src || !dst) throw new Error('Pick the spot to empty and the spot it is going to.');
  if (src === dst) throw new Error(`${src} is where they already are.`);
  await assertOpenSpot(dst);
  if (!(await getSpot(src))) throw new Error(`There is no spot called ${src}.`);
  const skus = await skusAt(src);
  if (!skus.length) throw new Error(`${src} has nothing recorded in it.`);
  const out = await moveUnits({ skus, code: dst, by, byName, via, note });
  return { from: src, ...out };
}

export async function unitWhere(raw) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  const [sku] = await canonicalSkus([raw]);
  if (!sku) throw new Error('Scan or type a SKU.');
  const [unit] = await describeUnits([sku]);
  const { rows } = await query(
    `SELECT location, moved_at, moved_by_name, via, note FROM unit_moves
      WHERE sku = $1 ORDER BY moved_at DESC, id DESC LIMIT 25`,
    [sku]
  );
  return {
    ...unit,
    history: rows.map((r) => ({
      location: r.location, movedAt: iso(r.moved_at), movedBy: r.moved_by_name || null, via: r.via || null, note: r.note || null
    }))
  };
}

// Search by SKU, make, model or description. Units still in the building first.
export async function findUnits(q) {
  const term = String(q || '').trim();
  if (term.length < 2 || !hasDb()) return [];
  await ensureLocationSchema();
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await query(
    `SELECT sku FROM (
       SELECT sku, MIN(pri) AS pri FROM (
         SELECT p.sku, 1 AS pri FROM products p
          WHERE p.sku ILIKE $1 OR p.model ILIKE $1 OR p.make ILIKE $1 OR p.title ILIKE $1
         UNION ALL
         SELECT s.sku, 2 FROM salvage_units s
          WHERE s.sku ILIKE $1 OR s.model ILIKE $1 OR s.make ILIKE $1 OR s.title ILIKE $1
         UNION ALL
         SELECT m.sku, 3 FROM unit_moves m WHERE m.sku ILIKE $1 OR m.title ILIKE $1
       ) x GROUP BY sku
     ) y ORDER BY pri, sku LIMIT 40`,
    [like]
  );
  const units = await describeUnits(rows.map((r) => r.sku));
  const rank = (u) => (u.location ? 0 : !u.everPlaced ? 1 : 2);
  return units.sort((a, b) => rank(a) - rank(b));
}

// Stock the site knows about that has never been scanned into a spot: on sale,
// salvage not yet disposed, and units sold recently that nothing says have left.
// "Recently" because an old sale with no delivered order is almost always a unit
// that walked out years ago, and a list of those would bury the real ones.
export async function unplacedUnits() {
  if (!hasDb()) return { total: 0, units: [] };
  await ensureLocationSchema();
  const { rows } = await query(
    `WITH stock AS (
       SELECT p.sku FROM products p
        WHERE (p.active = true AND p.sold_at IS NULL)
           OR (p.sold_at > now() - make_interval(days => $1::int)
               AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                                WHERE oi.sku = p.sku AND o.status = 'delivered'))
       UNION
       SELECT s.sku FROM salvage_units s WHERE s.status <> 'disposed'
     )
     SELECT st.sku, COUNT(*) OVER () AS total FROM stock st
      WHERE NOT EXISTS (SELECT 1 FROM unit_moves m WHERE m.sku = st.sku)
      ORDER BY st.sku LIMIT 400`,
    [UNPLACED_SOLD_DAYS]
  );
  return { total: rows.length ? Number(rows[0].total) : 0, units: await describeUnits(rows.map((r) => r.sku)) };
}

// Put units in a spot — or, with `code` null, record that they have left the
// building (returned to a vendor, scrapped). All or nothing: a skid scanned onto
// a lane either lands whole or not at all.
export async function moveUnits({ skus, code, by = null, byName = null, via = 'scan', note = null, titles = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureLocationSchema();
  const target = code == null || String(code).trim() === '' ? null : normCode(code);
  if (target) await assertOpenSpot(target);

  const raw = [...new Set((Array.isArray(skus) ? skus : [skus]).map(normSku).filter(Boolean))];
  if (!raw.length) throw new Error('Scan or type a SKU first.');
  if (raw.length > MAX_MOVE) throw new Error(`That is ${raw.length} units in one go — move ${MAX_MOVE} at a time.`);
  const canon = await canonicalSkus(raw);
  const titleOf = new Map();
  if (titles && typeof titles === 'object') {
    raw.forEach((r, i) => { const t = clean(titles[r], 160); if (t) titleOf.set(canon[i], t); });
  }
  const unique = [...new Set(canon)];

  const before = new Map((await describeUnits(unique)).map((u) => [u.sku, u]));
  const already = new Set();
  await withTransaction(async (client) => {
    for (const sku of unique) {
      const u = before.get(sku);
      // A second scan of the same unit onto the same spot writes nothing: the
      // history is for moves, and a jittery camera is not one.
      const isAlready = target ? u?.location === target : (u?.everPlaced && u?.gone);
      if (isAlready) { already.add(sku); continue; }
      await client.query(
        `INSERT INTO unit_moves (sku, location, moved_by, moved_by_name, via, note, title)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sku, target, by, byName, via, clean(note, 300), titleOf.get(sku) || null]
      );
    }
  });

  const after = await describeUnits(unique);
  return {
    to: target,
    units: after.map((u) => ({
      ...u,
      from: before.get(u.sku)?.location || null,
      wasGone: !!before.get(u.sku)?.gone,
      already: already.has(u.sku)
    }))
  };
}

// Count a spot: the person scans every unit physically in it, and this compares
// that with what the records say. A unit found there that was recorded somewhere
// else IS there, so it is moved. A unit recorded there and not found is NOT moved
// anywhere — nobody knows where it went, and inventing a place for it would make
// the next person look in the wrong one. It stays listed as missing from the count.
export async function countSpot({ code, skus, by = null, byName = null }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureLocationSchema();
  const target = normCode(code);
  await assertOpenSpot(target);
  const list = (Array.isArray(skus) ? skus : []).map(normSku).filter(Boolean);
  if (list.length > MAX_COUNT) throw new Error(`That is ${list.length} scans — count a spot at a time.`);
  const scanned = [...new Set(await canonicalSkus(list))];
  const expected = await skusAt(target);
  const exp = new Set(expected);
  const got = new Set(scanned);
  const confirmed = scanned.filter((s) => exp.has(s));
  const found = scanned.filter((s) => !exp.has(s));
  const missing = expected.filter((s) => !got.has(s));

  const foundUnits = found.length
    ? (await moveUnits({ skus: found, code: target, by, byName, via: 'count' })).units
    : [];
  await query(
    `INSERT INTO location_audits (location, counted_by, counted_by_name, expected, confirmed, missing, found)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [target, by, byName, expected.length, confirmed.length, JSON.stringify(missing), JSON.stringify(found)]
  );
  const [confirmedUnits, missingUnits] = await Promise.all([describeUnits(confirmed), describeUnits(missing)]);
  return { code: target, expected: expected.length, confirmed: confirmedUnits, missing: missingUnits, found: foundUnits };
}

// The parts of the building, in walking order. Every area ever made is returned,
// retired ones included, so a spot left in a retired area still has a heading to
// sit under rather than vanishing from every list that groups by area.
export async function listAreas() {
  if (!hasDb()) return AREAS.map((a, i) => ({ ...a, sort: i, active: true }));
  await ensureLocationSchema();
  const { rows } = await query('SELECT key, label, sort, active FROM warehouse_areas ORDER BY sort, label');
  return rows.map((r) => ({ key: r.key, label: r.label, sort: r.sort, active: r.active }));
}

// A new part of the building ("Parts room"). The key is made from the name, so
// two admins typing the same name get the same area rather than two of them —
// and re-adding a retired area brings it back instead of refusing.
export async function addArea({ label, by = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureLocationSchema();
  const name = String(label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) throw new Error('Give the area a name — like "Parts room".');
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!key) throw new Error('Use letters or numbers in the area name.');
  const { rows: mx } = await query('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM warehouse_areas');
  const { rows } = await query(
    `INSERT INTO warehouse_areas (key, label, sort, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET active = true
     RETURNING key, label, sort, active, (xmax = 0) AS inserted`,
    [key, name, mx[0].s, by]
  );
  const r = rows[0];
  return { area: { key: r.key, label: r.label, sort: r.sort, active: r.active }, created: r.inserted };
}

// Add spots. A rack SECTION is added whole — `R7` with 3 shelves makes R7-1..R7-3
// — because nobody installs one shelf. Re-adding a retired spot brings it back.
export async function addSpots({ kind, area, code, levels, purpose, note }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureLocationSchema();
  if (!['rack', 'lane', 'zone'].includes(kind)) throw new Error('Pick rack, lane or holding area.');
  const base = normCode(code);
  if (!SPOT_CODE_RE.test(base)) throw new Error('A spot code is letters, digits and dashes — like R7, V5 or RETURNS.');
  // A holding area used to be forced into the 'zone' area. It now goes where it
  // is told, so a named spot can sit inside a new area ("PARTS-BENCH" in the parts
  // room); with no area given it still lands in Holding areas.
  const areaKey = String(area || '').trim() || (kind === 'zone' ? 'zone' : '');
  const { rows: known } = await query('SELECT key FROM warehouse_areas WHERE key = $1 AND active', [areaKey]);
  if (!known[0]) throw new Error('Pick which part of the warehouse it is in.');
  let codes = [base];
  if (kind === 'rack') {
    const n = Math.round(Number(levels));
    if (!(n >= 1 && n <= 8)) throw new Error('How many shelves high is it? (1–8)');
    codes = Array.from({ length: n }, (_, i) => `${base}-${i + 1}`);
  }
  const { rows: mx } = await query('SELECT COALESCE(MAX(sort), 0) AS s FROM warehouse_locations');
  let sort = Number(mx[0].s) + 1;
  const section = Number((base.match(/(\d+)$/) || [])[1]) || null;
  const created = [];
  const existing = [];
  await withTransaction(async (client) => {
    for (let i = 0; i < codes.length; i++) {
      const { rows } = await client.query(
        `INSERT INTO warehouse_locations (code, kind, area, section, level, purpose, note, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (code) DO UPDATE SET active = true
         RETURNING code, (xmax = 0) AS inserted`,
        [codes[i], kind, areaKey, section, kind === 'rack' ? i + 1 : null, clean(purpose, 60), clean(note, 200), sort++]
      );
      (rows[0].inserted ? created : existing).push(rows[0].code);
    }
  });
  return { created, existing };
}

// Purpose and note are anybody's; retiring a spot is an admin's, and is refused
// while the records say something is still in it — a retired spot with a fridge
// in it is a fridge nobody can find.
export async function updateSpot(code, patch = {}, { admin = false } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureLocationSchema();
  const target = normCode(code);
  if (!(await getSpot(target))) throw new Error(`There is no spot called ${target}.`);
  const sets = [];
  const vals = [target];
  if ('purpose' in patch) { vals.push(clean(patch.purpose, 60)); sets.push(`purpose = $${vals.length}`); }
  if ('note' in patch) { vals.push(clean(patch.note, 200)); sets.push(`note = $${vals.length}`); }
  if ('active' in patch) {
    if (!admin) throw new Error('Only an admin can retire or bring back a spot.');
    const active = patch.active !== false;
    if (!active) {
      const n = (await skusAt(target)).length;
      if (n) throw new Error(`${target} still has ${n} unit${n === 1 ? '' : 's'} recorded in it — move ${n === 1 ? 'it' : 'them'} out first.`);
      // Parts sit in spots too (lib/parts.js). A retired spot with igniters in it
      // is igniters nobody can find — and the parts screens would stop offering
      // the spot to take them out of. A missing parts table means no parts.
      const parts = await query(
        'SELECT COALESCE(SUM(qty), 0)::int AS n FROM part_moves WHERE location = $1', [target]
      ).then((r) => r.rows[0].n).catch((e) => { if (e?.code === '42P01') return 0; throw e; });
      if (parts > 0) throw new Error(`${target} still has ${parts} part${parts === 1 ? '' : 's'} on it — take ${parts === 1 ? 'it' : 'them'} off first.`);
    }
    vals.push(active);
    sets.push(`active = $${vals.length}`);
  }
  if (sets.length) await query(`UPDATE warehouse_locations SET ${sets.join(', ')} WHERE code = $1`, vals);
  return (await listLocations()).find((s) => s.code === target);
}
