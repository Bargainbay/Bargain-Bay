// Purchase-invoice intake: read a supplier PDF/image with Claude and pull out the
// appliance line items + costs, so they can be written into the master tracker as
// new "Untested" units (no manual spreadsheet typing). The owner reviews the
// extraction before it's written. Reuses the Anthropic API the agent already uses.
const MODEL = () => process.env.INTAKE_MODEL || process.env.AGENT_MODEL || 'claude-opus-4-8';

const CATEGORIES = ['Refrigerator', 'Freezer', 'Washer', 'Dryer', 'Laundry Center', 'Dishwasher', 'Range', 'Wall Oven', 'Microwave', 'Range Hood', 'Cooktop', 'Other'];

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return null; }
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
    `This is a SUPPLIER PURCHASE invoice for an appliance liquidation business (we buy appliances to refurbish/resell). ` +
    `Extract every appliance line item we purchased. Return ONLY JSON, no prose:\n` +
    `{"vendor": string|null, "invoiceNumber": string|null, "date": "YYYY-MM-DD"|null, ` +
    `"items": [{"make": string, "model": string, "category": one of ${JSON.stringify(CATEGORIES)}, ` +
    `"description": string, "retailPrice": number|null, "cost": number, "qty": number, "serial": string|null}]}\n` +
    `Rules: "cost" is the PER-UNIT price WE paid (the unit price on the invoice, not the extended/line total). ` +
    `"retailPrice" is the MSRP/list if shown, else null. "qty" defaults to 1. Pick the closest "category". ` +
    `Ignore non-appliance lines (shipping, tax, fees, pallets). If a field is unknown use null. Numbers are plain (no "$").`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(), max_tokens: 4096,
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: instruction }] }]
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `AI extraction failed (${r.status}).`);
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const parsed = parseJsonLoose(text);
  if (!parsed || !Array.isArray(parsed.items)) throw new Error('Could not read line items from that file — try a clearer scan/PDF.');

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const items = parsed.items
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
    items
  };
}
