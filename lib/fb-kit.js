// Facebook Marketplace listing kit: title, caption and the photo list for a unit.
// Pure functions (no imports from ./db) so the page, the zip route and the test share them.
// Nothing here is written to Facebook - staff copy it and post it by hand.
import { warrantyPhrase, parseTitle } from './specs.js';
import { imageFor, hasRealImage } from './images.js';
import { SITE_URL } from './site.js';

export const FB_TITLE_MAX = 100; // Marketplace's own limit

const abs = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `${SITE_URL}${u.startsWith('/') ? '' : '/'}${u}`);
const money = (n) => '$' + Number(n).toLocaleString('en-CA', { maximumFractionDigits: 0 });

const CONDITION_LINE = {
  'New in Box': 'Brand new, unused, in the original box.',
  'New Open Box': 'New and never used - the box was opened (floor model or return).',
  'New Scratch & Dent': 'Brand new with a cosmetic scratch or dent. Works perfectly.',
  'Scratch & Dent': 'Fully working with a cosmetic scratch or dent.',
  'Refurbished': 'Inspected, repaired where needed and tested back to full working order.',
  'Used': 'Previously owned, tested and working.',
  'Tested & Working': 'Tested and confirmed working.',
};

export function fbTitle(u) {
  const base = String(u.title || `${u.make || ''} ${u.model || ''} ${u.category || ''}`).replace(/\s+/g, ' ').trim();
  const tag = u.condition ? ` - ${u.condition}` : '';
  if ((base + tag).length <= FB_TITLE_MAX) return base + tag;
  if (base.length <= FB_TITLE_MAX) return base;
  return base.slice(0, FB_TITLE_MAX - 1).replace(/\s+\S*$/, '') + '…';
}

export function fbCaption(u) {
  const p = parseTitle(u.title);
  const specs = [p.width, p.capacity, p.finish].filter(Boolean).join(' | ');
  const lines = [];
  lines.push(`${[u.make, u.model].filter(Boolean).join(' ')} ${u.category || ''}`.trim());
  if (specs) lines.push(specs);
  lines.push('');
  lines.push(`Condition: ${u.condition || 'Tested & Working'}. ${CONDITION_LINE[u.condition] || CONDITION_LINE['Tested & Working']}`);
  lines.push(`Backed by our ${warrantyPhrase(u.warrantyMonths)}.`);
  if (u.compareAt && u.compareAt > u.price) lines.push(`Retail ${money(u.compareAt)} - ours ${money(u.price)} + HST.`);
  else lines.push(`${money(u.price)} + HST.`);
  lines.push('');
  lines.push('Pickup: Pickering (1135 Squires Beach Rd). Delivery available across the GTA.');
  lines.push(`Model ${u.model || 'n/a'} | Ref ${u.id}`);
  lines.push('');
  lines.push('Check out my profile to see all of our other listings.');
  lines.push('Message me for more info.');
  return lines.join('\n');
}

// Stock picture first (as on the site), then photos of the actual unit. Each is labelled so staff
// know which they are posting; a unit with real photos should lead with those on Marketplace.
export function fbPhotos(u) {
  const out = [];
  if (hasRealImage(u)) out.push({ kind: 'stock', url: abs(imageFor(u)) });
  for (const p of u.photos || []) if (p?.url) out.push({ kind: 'unit', url: abs(p.url) });
  for (const p of u.rsopsPhotos || []) if (p?.url) out.push({ kind: 'unit', url: abs(p.url) });
  return out;
}

export function fbListing(u) {
  return { sku: u.id, make: u.make, model: u.model, category: u.category, condition: u.condition,
    price: Math.round(Number(u.price)), title: fbTitle(u), caption: fbCaption(u), photos: fbPhotos(u) };
}
