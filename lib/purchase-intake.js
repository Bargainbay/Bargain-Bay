// Purchase-invoice intake: read a supplier PDF/image with Claude and pull out the
// line items + costs, so they can be written into the master tracker as new
// "Untested" units (no manual spreadsheet typing). The owner reviews the
// extraction before it's written. Reuses the Anthropic API the agent already uses.
const MODEL = () => process.env.INTAKE_MODEL || 'claude-sonnet-5';

const CATEGORIES = ['Refrigerator', 'Freezer', 'Washer', 'Dryer', 'Laundry Center', 'Dishwasher', 'Range', 'Wall Oven', 'Microwave', 'Range Hood', 'Cooktop', 'TV', 'Vacuum', 'Small Appliance', 'Other'];

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return null; }
}

// A response cut off at max_tokens is invalid JSON. Rescue the complete items by
// trimming back to the last fully-closed item array and re-closing the JSON, so a
// giant invoice yields "first N items + a warning" instead of a dead upload.
function repairTruncatedJson(text) {
  let t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*)/i);
  if (fence) t = fence[1];
  const start = t.indexOf('{');
  if (start < 0) return null;
  t = t.slice(start);
  let cut = t.lastIndexOf(']');
  for (let tries = 0; cut > 0 && tries < 200; tries++) {
    const p = parseJsonLoose(t.slice(0, cut + 1) + ']}');
    if (p && Array.isArray(p.items)) return p;
    cut = t.lastIndexOf(']', cut - 1);
  }
  return null;
}

// Items come back as compact 8-element arrays (order below) to keep the response
// small — a 60-line invoice in verbose object form blows past any sane token cap.
// Accept objects too in case the model ignores the shape.
function toItemObject(it) {
  if (Array.isArray(it)) {
    const [make, model, category, description, retailPrice, cost, qty, serial] = it;
    return { make, model, category, description, retailPrice, cost, qty, serial };
  }
  return it && typeof it === 'object' ? it : {};
}

// { base64, mediaType } where mediaType is 'application/pdf' or 'image/png' etc.
export async function extractPurchaseInvoice({ base64, mediaType }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI isn\'t configured (ANTHROPIC_API_KEY missing).');
  if (!base64) throw new Error('No file provided.');
  const isPdf = (mediaType || '').includes('pdf');
  const docBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } };

  const instruction =
    `This is a SUPPLIER PURCHASE invoice for a liquidation business (we buy appliances, TVs and other electronics to refurbish/resell). ` +
    `Extract EVERY line item we purchased — invoices can run to 60+ lines across multiple pages; do not stop early. Return ONLY JSON, no prose:\n` +
    `{"vendor": string|null, "invoiceNumber": string|null, "date": "YYYY-MM-DD"|null, ` +
    `"items": [[make, model, category, description, retailPrice, cost, qty, serial], ...]}\n` +
    `Each item is a compact 8-element array in EXACTLY that order (keeps the response small). ` +
    `category is one of ${JSON.stringify(CATEGORIES)}.\n` +
    `"description" must be a clear, searchable retail product title — brand + size/capacity + product TYPE + color/standout feature — NOT just the model number. ` +
    `e.g. "Samsung 77-inch S90D 4K OLED Smart TV" or "Whirlpool 30-inch 19.3 cu ft Top-Freezer Refrigerator, White". Always include the product type word(s) (TV, washer, refrigerator, etc.).\n` +
    `Rules: "cost" is the PER-UNIT amount WE ACTUALLY PAID. If the invoice shows a discount % or a discounted line amount, cost = the discounted line amount ÷ qty — NOT the pre-discount unit price. ` +
    `"retailPrice" is the MSRP/list price, or the pre-discount unit price when a discount is applied; else null. "qty" defaults to 1. Pick the closest "category". ` +
    `"serial" is the unit's serial number if the invoice lists one, else null. ` +
    `Ignore non-product lines (shipping, tax, fees, pallets). If a field is unknown use null. Numbers are plain (no "$", no thousands separators).`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(), max_tokens: 16384,
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: instruction }] }]
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `AI extraction failed (${r.status}).`);
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const hitCap = data.stop_reason === 'max_tokens';
  let parsed = parseJsonLoose(text);
  let truncated = false;
  if ((!parsed || !Array.isArray(parsed.items)) && hitCap) {
    parsed = repairTruncatedJson(text);
    truncated = !!parsed;
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(hitCap
      ? 'That invoice has too many line items to read in one pass — split the PDF and upload it in parts.'
      : 'Could not read line items from that file — try a clearer scan/PDF.');
  }

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const items = parsed.items
    .map(toItemObject)
    .map((it) => ({
      make: String(it.make || '').trim(),
      model: String(it.model || '').trim(),
      category: CATEGORIES.includes(it.category) ? it.category : 'Other',
      description: String(it.description || `${it.make || ''} ${it.model || ''}`).trim().slice(0, 300),
      retail: num(it.retailPrice),
      cost: num(it.cost),
      qty: Math.max(1, Math.round(num(it.qty) || 1)),
      serial: it.serial ? String(it.serial).trim() : null
    }))
    .filter((it) => it.make || it.model);

  return {
    vendor: parsed.vendor ? String(parsed.vendor).trim() : null,
    invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
    date: parsed.date ? String(parsed.date).trim() : null,
    items,
    truncated
  };
}
