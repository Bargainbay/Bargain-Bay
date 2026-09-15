// Warehouse spot codes, and what a scanner reads off one of our labels.
//
// IMPORTS NOTHING — it runs in the browser (the scan screen), on the server (the
// label sheets, the API), and RS Ops follows the same payload rule. Keep it that
// way, or the scan screen starts dragging server code into the phone.
//
// Every label we print carries a URL, not a bare code:
//   unit sticker  →  https://bargainbay.ca/w/u/<SKU>
//   spot label    →  https://bargainbay.ca/w/l/<CODE>
// Two reasons. An ordinary phone camera pointed at a sticker opens that unit's
// page with no app at all. And the scan screen can tell a PLACE from a UNIT by
// what the label says it is, instead of guessing from the shape of the text —
// `V4` and a SKU like `V4-001` are one dash apart.
//
// A handheld scanner or a person typing still works: that arrives as
// `kind: 'text'`, and the caller resolves it against the list of spots.

export const UNIT_PATH = '/w/u/';
export const SPOT_PATH = '/w/l/';

// The parts of the building, in the order a person walks them. The layout was
// described by the owner on 2026-09-15: racking round the perimeter, vertical
// lanes across the front half of the floor, horizontal lanes across the back.
export const AREAS = [
  { key: 'left', label: 'Left wall racking' },
  { key: 'back', label: 'Back wall racking' },
  { key: 'right', label: 'Right wall racking' },
  { key: 'front', label: 'Front floor — vertical lanes' },
  { key: 'rear', label: 'Back floor — horizontal lanes' },
  { key: 'zone', label: 'Holding areas' }
];

// Suggestions for a spot's purpose. It is free text on the spot; these are only
// what the owner named, so the same idea gets spelled the same way.
export const PURPOSES = ['Overstock', 'Waiting for parts', 'Skids — multiples', 'Ready to sell', 'Salvage', 'Parts'];

// What the site knows about a unit — see describeUnits in lib/locations.js.
export const UNIT_STATUS = {
  for_sale: 'On the site',
  sold: 'Sold',
  not_listed: 'Not on the site',
  salvage: 'Salvage',
  salvage_gone: 'Salvage — disposed',
  unknown: 'Not on the site yet'
};

export const normCode = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
export const normSku = (s) => String(s ?? '').trim();

// Letters, digits and dashes, starting with a letter or digit. Short enough to
// read off a sign across a lane.
export const SPOT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,23}$/;

const trimBase = (base) => String(base || '').replace(/\/+$/, '');
export const unitScanUrl = (base, sku) => `${trimBase(base)}${UNIT_PATH}${encodeURIComponent(normSku(sku))}`;
export const spotScanUrl = (base, code) => `${trimBase(base)}${SPOT_PATH}${encodeURIComponent(normCode(code))}`;

// What did the scanner just read? → { kind: 'unit' | 'location' | 'text', value } or null.
export function parseScan(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  // One of our labels. The host is ignored on purpose: a sticker printed while
  // the site was on its vercel.app address must still scan once it is on
  // bargainbay.ca.
  const m = text.match(/\/w\/([ul])\/([^/?#\s]+)/i);
  if (m) {
    let v = m[2];
    try { v = decodeURIComponent(v); } catch { /* a malformed escape is still the best text we have */ }
    return m[1].toLowerCase() === 'l'
      ? { kind: 'location', value: normCode(v) }
      : { kind: 'unit', value: normSku(v) };
  }
  if (/^LOC:/i.test(text)) return { kind: 'location', value: normCode(text.slice(4)) };
  return { kind: 'text', value: text };
}
