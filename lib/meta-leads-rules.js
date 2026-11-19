// Meta lead forms -> our boards. NO IMPORTS: pure rules, testable without a database.
//
// Where a lead goes is decided by WHICH PAGE it came from and WHICH FORM it was:
//   page marked "rs" + a form with "workshop" in its name -> the RS Solutions workshop Board
//   page marked "rs" + any other form                    -> the Sales Hub lead board (side RS)
//   page marked "bb"                                     -> the Sales Hub lead board (side Bargain Bay)
// The RS Solutions page is the only one wired by default; Bargain Bay's page is added with
// META_LEAD_PAGES (e.g. "656416010891883:rs,<bb page id>:bb") once it has a lead form.

export const DEFAULT_PAGES = '656416010891883:rs';

export function parsePages(text) {
  const out = [];
  for (const part of String(text || DEFAULT_PAGES).split(',')) {
    const [id, side] = part.split(':').map((s) => s.trim());
    if (/^\d{5,}$/.test(id || '') && (side === 'rs' || side === 'bb')) out.push({ id, side });
  }
  return out;
}

export const isWorkshopForm = (name) => /workshop/i.test(String(name || ''));

/** Where a lead from `side` and `formName` is delivered. */
export function destinationFor(side, formName) {
  if (side === 'rs' && isWorkshopForm(formName)) return 'workshop';
  return side === 'bb' ? 'hub-bb' : 'hub-rs';
}

/** A Graph API lead -> the fields the boards need. Meta sends field_data as [{name, values: []}]. */
export function leadFromMeta(raw, formName = '') {
  const f = {};
  for (const x of raw?.field_data || []) f[String(x.name || '').toLowerCase()] = String((x.values || [])[0] ?? '').trim();
  const name = f.full_name || [f.first_name, f.last_name].filter(Boolean).join(' ') || f.name || '';
  const t = Date.parse(raw?.created_time || '');
  return {
    metaId: String(raw?.id || ''),
    name,
    email: (f.email || '').toLowerCase(),
    phone: f.phone_number || f.phone || '',
    createdAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
    campaign: raw?.campaign_name || '',
    formName
  };
}

/** A lead we can act on needs a way to reach them. */
export const reachable = (l) => !!(l.metaId && (l.email || String(l.phone).replace(/\D/g, '').length >= 10) && l.createdAt);
