// Reads a photographed receipt so the form arrives filled in. THE MODEL PROPOSES; A PERSON CONFIRMS every
// time (the form shows what it read, editable), because a misread total is money in the books.
import { EXPENSE_CATEGORIES } from './finance';

const MODEL = () => process.env.INTAKE_MODEL || 'claude-sonnet-5';

export async function readReceipt({ base64, mediaType }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Reading photos is not set up (ANTHROPIC_API_KEY). Type the details instead.');
  if (!base64) throw new Error('No photo.');
  const instruction =
    `This is a photo of a RECEIPT for a purchase by a small appliance business in Ontario, Canada. Return ONLY JSON, no prose:\n` +
    `{"vendor": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, "tax": number|null, "category": string|null}\n` +
    `"total" is the final amount charged including tax. "tax" is the HST/GST/PST shown on the receipt (add several together), ` +
    `0 if it plainly shows none, null if you cannot see it. "category" is the closest of ${JSON.stringify(EXPENSE_CATEGORIES)}, else null. ` +
    `Never guess a figure you cannot read: use null. Numbers are plain (no "$", no commas).`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(), max_tokens: 600,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } },
        { type: 'text', text: instruction }] }]
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Could not read that photo (${r.status}).`);
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return cleanRead(text);
}

// Pure: whatever the model said → fields the form can trust the SHAPE of.
export function cleanRead(text) {
  let o = null;
  try { o = JSON.parse(String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)); } catch { /* unreadable */ }
  if (!o || typeof o !== 'object') return { vendor: null, date: null, total: null, tax: null, category: null };
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
  const total = num(o.total);
  let tax = num(o.tax);
  if (tax != null && (tax < 0 || (total != null && tax > total))) tax = null;
  return {
    vendor: o.vendor ? String(o.vendor).slice(0, 120) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '')) ? o.date : null,
    total: total != null && total > 0 ? total : null,
    tax,
    category: EXPENSE_CATEGORIES.includes(o.category) ? o.category : null
  };
}
