// Turning a client's spreadsheet into stops on the board.
//
// The work arrives as an Excel attachment, as rows typed into an email, and as
// PDF run sheets — three formats, one shape underneath: a table where each row
// is a stop. This module is only that: text in, job payloads out. It knows
// nothing about the page it's called from, so the email inbox can hand it the
// same rows later without any of this moving.
//
// Deliberately not clever. No AI, no guessing at prose — a dispatcher confirms
// the column mapping once and can see every row before anything is written,
// because a stop invented by a parser is a van sent to the wrong address.

// One row of a pasted table, split on whatever the sender used. Excel's
// clipboard is TAB-separated, a saved file is usually comma, and European
// exports are semicolons — sniffing beats asking.
function sniffDelimiter(line) {
  const counts = [['\t', 0], [',', 0], [';', 0], ['|', 0]].map(([d]) => [d, line.split(d).length - 1]);
  const [best] = counts.sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : '\t';
}

// A real CSV splitter: quoted fields can contain the delimiter, and "" is an
// escaped quote. Addresses are full of commas, so a naive split loses the city.
function splitRow(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { quoted = false; }
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      out.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// The fields a stop can be built from, and the header names people actually
// use for them. Matching is loose (lowercased, punctuation stripped) because
// every client names their columns differently and nobody will rename them.
export const IMPORT_FIELDS = [
  { key: 'customerName', label: 'Customer', aliases: ['customer', 'customer name', 'name', 'consignee', 'client name', 'deliver to', 'receiver', 'company'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'phone 1', 'tel', 'telephone', 'mobile', 'cell', 'contact', 'phone number'] },
  // A second number is worth keeping — it is the one that answers when the
  // first doesn't — but it belongs in the notes, not pretending to be the
  // number the driver taps.
  { key: 'phone2', label: 'Second phone', aliases: ['phone 2', 'alt phone', 'other phone', 'phone2', 'mobile 2'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e mail'] },
  { key: 'address', label: 'Address', aliases: ['address', 'street', 'address1', 'delivery address', 'ship to', 'destination'] },
  // Unit / buzzer / suite. Its own column on every client sheet, and the part
  // a driver is standing outside without.
  { key: 'address2', label: 'Unit / extra address', aliases: ['additional address info', 'address 2', 'address2', 'unit', 'suite', 'apt', 'apartment', 'buzzer'] },
  { key: 'city', label: 'City', aliases: ['city', 'town', 'municipality'] },
  { key: 'postal', label: 'Postal code', aliases: ['postal', 'postal code', 'postalcode', 'postcode', 'zip'] },
  { key: 'jobDate', label: 'Date', aliases: ['date', 'delivery date', 'ship date', 'due', 'day'] },
  { key: 'windowStart', label: 'Window from', aliases: ['window start', 'from', 'start', 'earliest', 'time from', 'appt from'] },
  { key: 'windowEnd', label: 'Window to', aliases: ['window end', 'to', 'end', 'latest', 'time to', 'appt to'] },
  { key: 'items', label: "What's going", aliases: ['product description', 'item', 'items', 'description', 'goods', 'product', 'model', 'commodity', 'pieces'] },
  { key: 'reference', label: 'Reference / PO', aliases: ['ref', 'reference', 'po', 'po number', 'invoice', 'invoice #', 'invoice number', 'order', 'order number', 'bol', 'load', 'job'] },
  { key: 'notes', label: 'Notes', aliases: ['note', 'notes', 'instructions', 'comments', 'special', 'remarks'] },
  // Client sheets carry the how — "Drop Off, Room Of Choice", "In House
  // Delivery", "750 Lbs". It changes how the stop is worked, so it rides along
  // in the notes rather than being dropped for not fitting a field.
  { key: 'service', label: 'Service / order type', aliases: ['services', 'service', 'order type', 'service level', 'delivery type'] },
  { key: 'weight', label: 'Weight', aliases: ['weight', 'gross weight', 'gross weight lb', 'lbs', 'total weight'] },
  { key: 'extra', label: 'Anything else (into notes)', aliases: ['order type', 'type', 'origin hub', 'hub', 'qty', 'quantity', 'pieces', 'pcs'] },
  { key: 'pickupName', label: 'Pickup contact', aliases: ['pickup contact', 'shipper', 'pickup name', 'from name', 'origin contact'] },
  { key: 'pickupPhone', label: 'Pickup phone', aliases: ['pickup phone', 'shipper phone', 'from phone', 'origin phone'] },
  { key: 'pickupAddress', label: 'Pickup address', aliases: ['pickup', 'pickup address', 'from', 'from address', 'origin', 'collect from', 'shipper address'] },
  { key: 'pickupCity', label: 'Pickup city', aliases: ['pickup city', 'from city', 'origin city'] },
  { key: 'pickupPostal', label: 'Pickup postal', aliases: ['pickup postal', 'from postal', 'origin postal'] },
  { key: 'province', label: 'Province', aliases: ['province', 'prov', 'state', 'prov state', 'province state'] }
];

// #VALUE!, #N/A and friends are Excel telling itself something went wrong in a
// formula. They are not an address, and appending one puts "#VALUE!" on a run
// sheet a driver is reading in a van.
const EXCEL_ERRORS = /^#(value|n\/a|ref|div\/0|name|null|num)[!?]?$/i;
const cell = (v) => {
  const t = String(v == null ? '' : v).trim();
  return EXCEL_ERRORS.test(t) ? '' : t;
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Does this first row look like headings rather than a stop? If half of it
// matches a known column name, it's a header; a sheet that starts straight into
// data keeps all its rows.
function looksLikeHeader(cells) {
  const known = cells.filter((c) => {
    const n = norm(c);
    return n && IMPORT_FIELDS.some((f) => f.aliases.includes(n) || norm(f.label) === n);
  }).length;
  return known >= Math.max(2, Math.ceil(cells.length / 3));
}

export function parseTable(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };
  const delim = sniffDelimiter(lines[0]);
  const grid = lines.map((l) => splitRow(l, delim));
  const width = Math.max(...grid.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] || '');

  if (looksLikeHeader(grid[0])) {
    return { headers: pad(grid[0]), rows: grid.slice(1).map(pad) };
  }
  return { headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows: grid.map(pad) };
}

// Best guess at which column is which, so the common case is "looks right,
// import". Every guess is shown and overridable — the dispatcher confirms.
// Walk the FIELDS, not the headers, and let the strongest alias win.
//
// Header order used to decide it, which is how a sheet with both "Model" and
// "Product Description" put the SKU in the item line and threw the description
// away — Model simply came first. Now each field takes its best available
// header: an exact match on an early alias beats a loose match on a late one.
export function guessMapping(headers) {
  const map = {};
  const taken = new Set();
  const cols = headers.map((h) => norm(h));

  const score = (field, n) => {
    if (!n) return Infinity;
    if (norm(field.label) === n) return -1;                  // the field's own name
    const exact = field.aliases.indexOf(n);
    if (exact >= 0) return exact;                            // earlier alias = stronger
    const loose = field.aliases.findIndex((a) => n.includes(a) || a.includes(n));
    return loose >= 0 ? 100 + loose : Infinity;
  };

  for (const field of IMPORT_FIELDS) {
    let best = -1;
    let bestScore = Infinity;
    cols.forEach((n, i) => {
      if (taken.has(i)) return;
      const sc = score(field, n);
      if (sc < bestScore) { bestScore = sc; best = i; }
    });
    if (best >= 0 && bestScore < Infinity) { map[field.key] = best; taken.add(best); }
  }
  return map;
}

// Dates arrive as 2026-08-26, 26/08/2026, Aug 26 and Excel's own serial number.
// Anything we can't read with certainty is left blank rather than guessed at —
// a stop with no date waits in "To assign", which is visible; a stop on the
// wrong day is not.
export function normalizeDateCell(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Excel serial: days since 1899-12-30.
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let [, a, b, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    // Ambiguous past the 12th: 08/09 could be either. Canada writes month
    // first often enough that we take the US reading and let the preview show
    // it — the dispatcher sees the date before anything is written.
    const month = Number(a) > 12 ? b : a;
    const day = Number(a) > 12 ? a : b;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // "Jul - 04 - 2026", "Jul-04-2026", "July 4 2026" — a real client sheet writes
  // it with spaced hyphens, which Date() refuses outright.
  const cleaned = s.replace(/\s*-\s*/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const mdy = cleaned.match(/^([a-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/i);
  if (mdy) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mi = months.indexOf(mdy[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return `${mdy[3]}-${String(mi + 1).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}`;
  }
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime()) && /\d/.test(cleaned)) return parsed.toISOString().slice(0, 10);
  return '';
}

// 8, 8:00, 08:00, 8am, 0800 → 08:00. Blank when it isn't a time.
export function normalizeTimeCell(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Where a Quebec-bound load actually goes.
//
// The owner's rule: "if you ever see a BOL that's going to Montreal or Quebec we
// just do the pick up, and drop it off to Burlington." So the DOCUMENT says
// Vaudreuil-Dorion QC, and the JOB is a transfer — collect from the shipper,
// drop at the cross-dock — with the real consignee kept in the notes because
// that is what the paperwork and the phone call will both refer to.
//
// The address is a constant rather than a guess: it is the drop already on the
// board for every one of these loads. Overridable, because a cross-dock can
// move and a code change should not be the way that gets fixed.
export const QUEBEC_DROP = {
  address: process.env.NEXT_PUBLIC_QC_DROP_ADDRESS || '1213 International Boulevard',
  city: process.env.NEXT_PUBLIC_QC_DROP_CITY || 'Burlington',
  postal: process.env.NEXT_PUBLIC_QC_DROP_POSTAL || 'L7L 0K3'
};

const QC_HINT = /\b(qc|quebec|québec)\b/i;
const QC_CITIES = /\b(montr[eé]al|laval|longueuil|gatineau|sherbrooke|trois[- ]rivi[eè]res|qu[eé]bec city|vaudreuil|dorval|brossard|terrebonne|lévis|levis)\b/i;

// Is this load bound for Quebec? Province first — it is the field that means it
// — then the city, because plenty of BOLs leave the province column blank.
export function isQuebecBound({ province, city, address }) {
  if (province && QC_HINT.test(province)) return true;
  if (province && province.trim()) return false;       // it said ON, believe it
  return QC_CITIES.test(city || '') || QC_HINT.test(city || '') || QC_HINT.test(address || '');
}

// Rows + mapping → job payloads, each carrying whatever is wrong with it. The
// caller shows `problems` next to the row; only rows without a blocking one can
// be imported.
export function toJobs(rows, mapping, defaults = {}) {
  const at = (row, key) => (mapping[key] == null ? '' : cell(row[mapping[key]]));
  return rows.map((row) => {
    // A unit number is part of the address, not a footnote — the driver is
    // standing at the door with it.
    const address = [at(row, 'address'), at(row, 'address2')].filter(Boolean).join(', ');
    const reference = at(row, 'reference');
    // A pickup has to be somewhere a van can stop. Freight sheets put a HUB name
    // in the origin column — "Kitchener" — and taking that as an address turns
    // every stop into a transfer to nowhere. A street number is the test.
    const rawPickup = at(row, 'pickupAddress');
    const pickupAddress = /\d/.test(rawPickup) ? rawPickup : '';
    const pickupNote = rawPickup && !pickupAddress ? `from ${rawPickup}` : '';
    // A QC-bound load is OUR pickup and a drop at the cross-dock — not a drive to
    // Quebec. Applied only when the caller asks for it, and always visible in
    // the row's problems so nobody imports a redirected stop without seeing it.
    const province = at(row, 'province');
    const qc = defaults.quebecRule !== false
      && isQuebecBound({ province, city: at(row, 'city'), address });
    const qcNote = qc
      ? `QC load — final consignee ${[at(row, 'customerName'), address, at(row, 'city'), province].filter(Boolean).join(', ')}`
      : '';

    const notes = [
      reference ? `Ref ${reference}` : '',
      qcNote,
      pickupNote,
      at(row, 'service'),
      at(row, 'extra'),
      at(row, 'weight') ? `${at(row, 'weight')}` : '',
      at(row, 'phone2') ? `alt ${at(row, 'phone2')}` : '',
      at(row, 'notes')
    ].filter(Boolean).join(' · ');
    const job = {
      type: 'delivery',
      clientId: defaults.clientId || null,
      customerName: at(row, 'customerName'),
      phone: at(row, 'phone'),
      email: at(row, 'email'),
      address: qc ? QUEBEC_DROP.address : address,
      city: qc ? QUEBEC_DROP.city : at(row, 'city'),
      postal: qc ? QUEBEC_DROP.postal : at(row, 'postal'),
      jobDate: normalizeDateCell(at(row, 'jobDate')) || defaults.jobDate || null,
      windowStart: normalizeTimeCell(at(row, 'windowStart')) || null,
      windowEnd: normalizeTimeCell(at(row, 'windowEnd')) || null,
      shipmentType: defaults.shipmentType || null,
      services: defaults.services || [],
      notes: notes || null,
      pickupName: pickupAddress ? at(row, 'pickupName') : null,
      pickupPhone: pickupAddress ? at(row, 'pickupPhone') : null,
      pickupAddress: pickupAddress || null,
      pickupCity: pickupAddress ? at(row, 'pickupCity') : null,
      pickupPostal: pickupAddress ? at(row, 'pickupPostal') : null,
      // A redirected load is a transfer whether the sheet called it one or not.
      quebec: qc,
      // Split on ; and | only — NOT on commas. "One pallet - radiator, 175 lbs"
      // is one thing, and splitting it puts a phantom "175 lbs" line on a POD
      // the customer signs. A cell that reads "Fridge, Washer" stays one line,
      // which prints fine; an invented line does not.
      items: at(row, 'items').split(/\s*[;|]\s*/).map((d) => d.trim()).filter(Boolean).map((d) => ({ description: d }))
    };
    const problems = [];
    if (qc) {
      problems.push(`Quebec load → pickup only, dropping at ${QUEBEC_DROP.city}`);
      // Redirected to a cross-dock with nowhere to collect from is not a job.
      if (!job.pickupAddress) problems.push('no pickup address on the BOL');
    }
    // The one thing a stop cannot be without.
    if (!job.address) problems.push('no address');
    if (!job.jobDate) problems.push('no date — it will wait in “To assign”');
    if (job.windowStart && job.windowEnd && job.windowEnd <= job.windowStart) {
      problems.push('window ends before it starts');
      job.windowStart = null; job.windowEnd = null;
    }
    return { job, problems, blocking: !job.address || (qc && !job.pickupAddress) };
  });
}
