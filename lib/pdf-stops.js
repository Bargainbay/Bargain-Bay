// Reading a run sheet or a BOL that arrived as a PDF.
//
// A spreadsheet is a table and can be parsed. A bill of lading is a LAYOUT —
// boxes, headers repeated per page, the consignee's address in one corner and
// the shipper's in another — and a parser guessing at one produces wrong
// addresses silently, which is worse than reading none.
//
// So this asks Claude to read the document, exactly as `lib/purchase-intake.js`
// already does for supplier invoices, and hands back the SAME table shape the
// spreadsheet importer produces. Everything downstream is unchanged: the rows
// land in the same preview, with the same problems named, and nothing is written
// until a dispatcher has looked at every one. The model proposes; a person still
// confirms.
const MODEL = () => process.env.INTAKE_MODEL || 'claude-sonnet-5';

// The order the model must answer in. It is also exactly the header row the
// spreadsheet importer knows how to map, so a PDF becomes a pasted table and
// nothing else in the pipeline has to care where it came from.
export const PDF_COLUMNS = [
  'Date', 'Customer', 'Phone', 'Address', 'City', 'Postal code',
  'Items', 'Notes', 'Pickup address', 'Pickup city', 'Reference'
];

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return null; }
}

// A reply cut off at max_tokens is invalid JSON. Trim back to the last complete
// row and re-close it, so a 40-stop manifest gives "the first 31 and a warning"
// rather than a dead upload.
function repairTruncated(text) {
  let t = String(text || '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  t = t.slice(start);
  let cut = t.lastIndexOf(']');
  for (let tries = 0; cut > 0 && tries < 200; tries++) {
    const p = parseJsonLoose(`${t.slice(0, cut + 1)}]}`);
    if (p && Array.isArray(p.stops)) return p;
    cut = t.lastIndexOf(']', cut - 1);
  }
  return null;
}

// { base64, mediaType } — a PDF, or a photo of a paper sheet.
export async function extractStopsFromPdf({ base64, mediaType }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Reading PDFs isn't configured (ANTHROPIC_API_KEY missing).");
  if (!base64) throw new Error('No file provided.');

  const isPdf = (mediaType || '').includes('pdf');
  const docBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } };

  const instruction =
    `This is a DELIVERY document for a courier company — a run sheet, a manifest, or a bill of lading. `
    + `Pull out every STOP: one row per delivery address. Return ONLY JSON, no prose:\n`
    + `{"stops": [[date, customer, phone, address, city, postal, items, notes, pickupAddress, pickupCity, reference], ...], `
    + `"sender": string|null, "pages": number}\n`
    + `Each stop is a compact 11-element array in EXACTLY that order.\n`
    + `Rules:\n`
    + `- "date" is the DELIVERY date as YYYY-MM-DD. If the document shows only one date for the whole sheet, use it for every stop. If there is none, null.\n`
    + `- "address" is the street address the goods are DELIVERED to — the consignee / ship-to / deliver-to. Never the shipper's or the carrier's own address.\n`
    + `- "pickupAddress" is only for a transfer that collects from one address and delivers to another. A depot, terminal or hub NAME with no street number is NOT a pickup address — put it in "notes" instead and leave pickupAddress null.\n`
    + `- "items" is what is being delivered, as a readable description. Join several with " ; " (semicolons, never commas — a comma inside one item makes it look like two).\n`
    + `- "notes" is anything the driver needs: service level, room of choice, weight, piece count, buzzer/unit instructions, appointment text.\n`
    + `- "reference" is the order / BOL / PO / invoice number for that stop.\n`
    + `- Use null for anything the document does not say. NEVER invent, guess or complete an address, a postal code or a phone number. A missing field is fine; a wrong one sends a van to the wrong door.\n`
    + `- Ignore totals, signature blocks, terms and conditions, and repeated page headers.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: 16384,
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: instruction }] }]
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Could not read that PDF (${r.status}).`);
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const hitCap = data.stop_reason === 'max_tokens';

  let parsed = parseJsonLoose(text);
  let truncated = false;
  if ((!parsed || !Array.isArray(parsed.stops)) && hitCap) {
    parsed = repairTruncated(text);
    truncated = !!parsed;
  }
  if (!parsed || !Array.isArray(parsed.stops)) {
    throw new Error(hitCap
      ? 'That document has more stops than can be read in one pass — split the PDF and upload it in parts.'
      : 'Could not find any delivery stops in that file. If it is a scan, a clearer copy usually reads.');
  }

  const clean = (v) => {
    const s = String(v == null ? '' : v).trim();
    return s === 'null' || s === 'N/A' ? '' : s;
  };
  const rows = parsed.stops
    .map((st) => (Array.isArray(st)
      ? st
      : PDF_COLUMNS.map((_, i) => [st?.date, st?.customer, st?.phone, st?.address, st?.city,
        st?.postal, st?.items, st?.notes, st?.pickupAddress, st?.pickupCity, st?.reference][i])))
    .map((st) => PDF_COLUMNS.map((_, i) => clean(st[i])))
    // A row with no address and no customer is a header or a total the model
    // repeated back; it isn't a stop.
    .filter((st) => st[1] || st[3]);

  return {
    headers: PDF_COLUMNS,
    rows,
    sender: clean(parsed.sender) || null,
    truncated,
    warning: truncated
      ? 'The document was longer than one pass — check the last rows, some stops may be missing.'
      : null
  };
}
