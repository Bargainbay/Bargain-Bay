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
  { key: 'customerName', label: 'Customer', aliases: ['customer', 'name', 'consignee', 'client name', 'deliver to', 'receiver', 'company'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'contact', 'phone number'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e mail'] },
  { key: 'address', label: 'Address', aliases: ['address', 'street', 'address1', 'delivery address', 'ship to', 'destination'] },
  { key: 'city', label: 'City', aliases: ['city', 'town', 'municipality'] },
  { key: 'postal', label: 'Postal code', aliases: ['postal', 'postal code', 'postcode', 'zip'] },
  { key: 'jobDate', label: 'Date', aliases: ['date', 'delivery date', 'ship date', 'due', 'day'] },
  { key: 'windowStart', label: 'Window from', aliases: ['window start', 'from', 'start', 'earliest', 'time from', 'appt from'] },
  { key: 'windowEnd', label: 'Window to', aliases: ['window end', 'to', 'end', 'latest', 'time to', 'appt to'] },
  { key: 'items', label: "What's going", aliases: ['item', 'items', 'description', 'goods', 'product', 'unit', 'model', 'commodity', 'pieces'] },
  { key: 'reference', label: 'Reference / PO', aliases: ['ref', 'reference', 'po', 'po number', 'order', 'order number', 'bol', 'load', 'job'] },
  { key: 'notes', label: 'Notes', aliases: ['note', 'notes', 'instructions', 'comments', 'special'] },
  { key: 'pickupName', label: 'Pickup contact', aliases: ['pickup contact', 'shipper', 'pickup name', 'from name', 'origin contact'] },
  { key: 'pickupPhone', label: 'Pickup phone', aliases: ['pickup phone', 'shipper phone', 'from phone', 'origin phone'] },
  { key: 'pickupAddress', label: 'Pickup address', aliases: ['pickup', 'pickup address', 'from', 'from address', 'origin', 'collect from', 'shipper address'] },
  { key: 'pickupCity', label: 'Pickup city', aliases: ['pickup city', 'from city', 'origin city'] },
  { key: 'pickupPostal', label: 'Pickup postal', aliases: ['pickup postal', 'from postal', 'origin postal'] }
];

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
export function guessMapping(headers) {
  const map = {};
  const taken = new Set();
  headers.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    const hit = IMPORT_FIELDS.find((f) => !taken.has(f.key) && (f.aliases.includes(n) || norm(f.label) === n))
      || IMPORT_FIELDS.find((f) => !taken.has(f.key) && f.aliases.some((a) => n.includes(a)));
    if (hit) { map[hit.key] = i; taken.add(hit.key); }
  });
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
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && /\d/.test(s)) return parsed.toISOString().slice(0, 10);
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

// Rows + mapping → job payloads, each carrying whatever is wrong with it. The
// caller shows `problems` next to the row; only rows without a blocking one can
// be imported.
export function toJobs(rows, mapping, defaults = {}) {
  const at = (row, key) => (mapping[key] == null ? '' : String(row[mapping[key]] || '').trim());
  return rows.map((row) => {
    const address = at(row, 'address');
    const reference = at(row, 'reference');
    const notes = [reference ? `Ref ${reference}` : '', at(row, 'notes')].filter(Boolean).join(' · ');
    const pickupAddress = at(row, 'pickupAddress');
    const job = {
      type: 'delivery',
      clientId: defaults.clientId || null,
      customerName: at(row, 'customerName'),
      phone: at(row, 'phone'),
      email: at(row, 'email'),
      address,
      city: at(row, 'city'),
      postal: at(row, 'postal'),
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
      // Split on ; and | only — NOT on commas. "One pallet - radiator, 175 lbs"
      // is one thing, and splitting it puts a phantom "175 lbs" line on a POD
      // the customer signs. A cell that reads "Fridge, Washer" stays one line,
      // which prints fine; an invented line does not.
      items: at(row, 'items').split(/\s*[;|]\s*/).map((d) => d.trim()).filter(Boolean).map((d) => ({ description: d }))
    };
    const problems = [];
    // The one thing a stop cannot be without.
    if (!job.address) problems.push('no address');
    if (!job.jobDate) problems.push('no date — it will wait in “To assign”');
    if (job.windowStart && job.windowEnd && job.windowEnd <= job.windowStart) {
      problems.push('window ends before it starts');
      job.windowStart = null; job.windowEnd = null;
    }
    return { job, problems, blocking: !job.address };
  });
}
