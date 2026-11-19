// Finds a manufacturer stock photo for a MODEL by itself, so a unit never sits on
// the site with placeholder art waiting for a person to notice.
//
// Sources, in order (CLAUDE.md "Adding to data/images.json" says why):
//   1. AJ Madison — preferred, because normalizeImg trims and pads every one of
//      its photos onto an identical 1000x1000 canvas.
//   2. Frigidaire Canada's own product-support page (a Frigidaire-family model).
//
// What makes this safe to run unattended:
//   - A page only counts if it answers 200 AND names the model in its text. AJ
//     Madison answers 410 and Frigidaire 404 for a model they don't carry, but
//     the text check also stops a "did you mean" page being taken for a match.
//   - The image itself is fetched and must be a real image of a plausible size.
//   - Nothing is guessed: no match means NO photo is set and the model stays on
//     the "needs a photo" list for a person. A wrong appliance on a listing is
//     worse than placeholder art.
// Every request has a short timeout; this runs inside the inventory sync.
import { setModelPhoto } from './model-photos';

const UA = 'Mozilla/5.0 (compatible; BargainBayCatalog/1.0)';
const TIMEOUT = 8000;
const MIN_IMAGE_BYTES = 8000;
const MAX_PER_RUN = 8;

async function getText(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status !== 200) return null;
    return await res.text();
  } catch { return null; }
}

// The image has to load and be an image — a CDN that 403s or returns an HTML
// error page must not be saved as the model's photo.
async function imageLoads(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status !== 200) return false;
    if (!/^image\//i.test(res.headers.get('content-type') || '')) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength >= MIN_IMAGE_BYTES;
  } catch { return false; }
}

const mentions = (html, model) => html.toUpperCase().includes(String(model).toUpperCase());

async function fromAjMadison(model) {
  if (!/^[A-Za-z0-9-]{4,24}$/.test(model)) return null;
  const html = await getText(`https://www.ajmadison.com/cgi-bin/ajmadison/${encodeURIComponent(model)}.html`);
  if (!html || !mentions(html, model)) return null;
  const og = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
  const path = og?.match(/\/ajmadison\/images\/large_no_watermark\/[^"?\s]+/i)?.[0];
  if (!path) return null;
  // Same CDN form the existing data/images.json entries use, so normalizeImg
  // can trim and pad it.
  const url = `https://assets.ajmadison.com/image/upload/c_limit,f_jpg,q_auto,w_1200/v1${path}`;
  return (await imageLoads(url)) ? { url, source: 'AJ Madison' } : null;
}

const FRIGIDAIRE_FAMILY = /frigidaire|gallery|professional/i;

async function fromFrigidaire(model, make) {
  if (!FRIGIDAIRE_FAMILY.test(make || '') && !/^(F|G|P)[A-Z]{3}\d{3}[A-Z]{3}$/i.test(model)) return null;
  const html = await getText(`https://www.frigidaire.ca/Owner-Centre/Product-Support/${encodeURIComponent(model)}`);
  if (!html || !mentions(html, model)) return null;
  const found = [...new Set(html.match(/https:\/\/frigidaire\.bynder\.com\/transform\/[^"'?\s<>]+/g) || [])]
    .filter((u) => u.toUpperCase().includes(String(model).toUpperCase()));
  // The "HOV" render is the straight-on hero shot on a clean background.
  const ordered = [...found.filter((u) => /HOV(-psd)?$/i.test(u)), ...found.filter((u) => /34[LR]/i.test(u))];
  for (const url of ordered) {
    if (await imageLoads(url)) return { url, source: 'Frigidaire Canada' };
  }
  return null;
}

export async function findStockPhoto(model, make = '') {
  const m = String(model || '').trim();
  if (!m) return null;
  return (await fromAjMadison(m)) || (await fromFrigidaire(m, make)) || null;
}

// Try each photo-less model. Returns { set: [{model,url,source}], notFound: [model] }.
// `gaps` is modelsWithoutStockPhoto()'s shape: { model, make, skus }.
export async function autoFixStockPhotos(gaps, { createdBy = 'auto (stock photo finder)' } = {}) {
  const set = [];
  const notFound = [];
  const list = (gaps || []).filter((g) => g && g.model && !String(g.model).startsWith('(no model)'));
  for (const g of list.slice(0, MAX_PER_RUN)) {
    try {
      const hit = await findStockPhoto(g.model, g.make);
      if (!hit) { notFound.push(g.model); continue; }
      await setModelPhoto(g.model, { url: hit.url }, { createdBy });
      set.push({ model: g.model, url: hit.url, source: hit.source });
    } catch (e) {
      console.error('auto stock photo failed', g.model, e?.message || e);
      notFound.push(g.model);
    }
  }
  // Anything past the per-run cap is picked up by the next sync.
  for (const g of list.slice(MAX_PER_RUN)) notFound.push(g.model);
  return { set, notFound };
}
