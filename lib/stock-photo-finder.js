// Finds a manufacturer stock photo for a MODEL by itself, so a unit never sits on
// the site with placeholder art waiting for a person to notice.
//
// Sources, in order (CLAUDE.md "Adding to data/images.json" says why):
//   1. AJ Madison — preferred, because normalizeImg trims and pads every one of
//      its photos onto an identical 1000x1000 canvas.
//   2. Frigidaire Canada's own product-support page (a Frigidaire-family model).
//   3. Canadian Shopify appliance retailers' open product search (any brand).
//   4. A web search (Anthropic's web_search tool), whose result PAGES are then
//      fetched and checked by us exactly like every other source. The model only
//      nominates pages; it never supplies an image URL we would trust.
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
//
// EVERY REFUSAL IS RECORDED (`trace`). A source that said "we don't carry it"
// and a source that refused to answer us are different failures: the second is
// retried soon (lib/catalog-sync.js) and named in the email.
import { setModelPhoto } from './model-photos';

const UA = 'Mozilla/5.0 (compatible; BargainBayCatalog/1.0)';
const TIMEOUT = 8000;
const MIN_IMAGE_BYTES = 8000;
const MAX_PER_RUN = 8;

// A refusal, a rate limit, a server error or no answer at all: worth asking
// again later. 404 / 410 mean "we don't carry it".
const isTransient = (status) => status === 0 || status === 403 || status === 429 || status >= 500;
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url); } };
function noteStatus(trace, where, status) {
  const text = status === 0 ? 'no answer' : status === 404 || status === 410 ? 'does not carry it' : `refused (${status})`;
  trace.push({ where, text, transient: isTransient(status) });
}

async function getText(url, trace) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status !== 200) { if (trace) noteStatus(trace, hostOf(url), res.status); return null; }
    return await res.text();
  } catch { if (trace) noteStatus(trace, hostOf(url), 0); return null; }
}

// The image has to load and be an image — a CDN that 403s or returns an HTML
// error page must not be saved as the model's photo. 'ok' | 'blocked' | 'bad'.
async function checkImage(url, trace) {
  const where = `${hostOf(url)} picture`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status !== 200) {
      noteStatus(trace, where, res.status);
      return isTransient(res.status) ? 'blocked' : 'bad';
    }
    if (!/^image\//i.test(res.headers.get('content-type') || '')) return 'bad';
    const buf = await res.arrayBuffer();
    return buf.byteLength >= MIN_IMAGE_BYTES ? 'ok' : 'bad';
  } catch { noteStatus(trace, where, 0); return 'blocked'; }
}
const imageLoads = async (url, trace) => (await checkImage(url, trace)) === 'ok';

const mentions = (html, model) => html.toUpperCase().includes(String(model).toUpperCase());

async function fromAjMadison(model, trace) {
  if (!/^[A-Za-z0-9-]{4,24}$/.test(model)) return null;
  const html = await getText(`https://www.ajmadison.com/cgi-bin/ajmadison/${encodeURIComponent(model)}.html`, trace);
  if (!html || !mentions(html, model)) return null;
  const og = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
  const path = og?.match(/\/ajmadison\/images\/large_no_watermark\/[^"?\s]+/i)?.[0];
  if (!path) return null;
  // Same CDN form the existing data/images.json entries use, so normalizeImg
  // can trim and pad it.
  const url = `https://assets.ajmadison.com/image/upload/c_limit,f_jpg,q_auto,w_1200/v1${path}`;
  return (await imageLoads(url, trace)) ? { url, source: 'AJ Madison' } : null;
}

const FRIGIDAIRE_FAMILY = /frigidaire|gallery|professional/i;

async function fromFrigidaire(model, make, trace) {
  if (!FRIGIDAIRE_FAMILY.test(make || '') && !/^(F|G|P)[A-Z]{3}\d{3}[A-Z]{3}$/i.test(model)) return null;
  const html = await getText(`https://www.frigidaire.ca/Owner-Centre/Product-Support/${encodeURIComponent(model)}`, trace);
  if (!html || !mentions(html, model)) return null;
  const found = [...new Set(html.match(/https:\/\/frigidaire\.bynder\.com\/transform\/[^"'?\s<>]+/g) || [])]
    .filter((u) => u.toUpperCase().includes(String(model).toUpperCase()));
  // The "HOV" render is the straight-on hero shot on a clean background.
  // Then the angled hero shots (34L, 34R, 34VL...), then anything that is not a
  // dimensions drawing, close-up, lifestyle or feature shot. Frigidaire's naming
  // varies by model; FLCE752CAW has only 34VL and DIM.
  const NOT_A_PRODUCT_SHOT = /(DIM|OE|CRL|EC\d|LSH|HV\d|DCU|OT|F\d|HOVP)(-psd|_psd)?$/i;
  const ordered = [
    ...found.filter((u) => /HOV(-psd)?$/i.test(u)),
    ...found.filter((u) => /34V?[LR](_\d+)?(-psd)?$/i.test(u)),
    ...found.filter((u) => !NOT_A_PRODUCT_SHOT.test(u) && !/HOV(-psd)?$|34V?[LR]/i.test(u)),
  ];
  for (const url of ordered) {
    if (await imageLoads(url, trace)) return { url, source: 'Frigidaire Canada' };
  }
  return null;
}

// ---- 3. Shopify retailers --------------------------------------------------
// Every Shopify store answers /search/suggest.json publicly. These are the
// Canadian appliance stores that answered it when tested (2026-11-19); a host
// that stops answering simply yields nothing.
const SHOPIFY_STORES = [
  'www.townappliance.com', 'www.taappliance.com', 'www.futureappliances.ca',
  'www.leons.ca', 'www.thebrick.com', 'www.coastappliances.ca', 'www.appliancecanada.com',
];
const fold = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// A pair listed under one title ("Washer X & Dryer Y") is a picture of two
// machines, not of this one.
const BUNDLE_TITLE = /\s[&+]\s|\b(bundle|package|pair)\b/i;
const SHOPIFY_CDN = /^https:\/\/cdn\.shopify\.com\//i;

async function fromShopify(model, trace) {
  const key = fold(model);
  if (key.length < 5) return null;
  const q = encodeURIComponent(model);
  const results = await Promise.all(SHOPIFY_STORES.map(async (host) => {
    try {
      const res = await fetch(`https://${host}/search/suggest.json?q=${q}&resources%5Btype%5D=product&resources%5Blimit%5D=4`, {
        headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.status !== 200) { noteStatus(trace, hostOf(`https://${host}`), res.status); return []; }
      const j = await res.json();
      return (j?.resources?.results?.products || []).map((p) => ({ host, title: p.title, image: p.image || p.featured_image?.url }));
    } catch { noteStatus(trace, hostOf(`https://${host}`), 0); return []; }
  }));
  let unchecked = null;
  for (const p of results.flat()) {
    // The TITLE has to name the model, not merely be a search result for it.
    if (!p.image || !fold(p.title).includes(key) || BUNDLE_TITLE.test(p.title)) continue;
    const url = String(p.image).startsWith('//') ? `https:${p.image}` : p.image;
    const check = await checkImage(url, trace);
    const hit = { url, source: p.host.replace(/^www\./, '') };
    if (check === 'ok') return hit;
    // Shopify's picture server sometimes refuses a server that asks for the
    // file, while serving every shopper's browser. The link came out of the
    // store's own live catalogue for this exact model, and we only store the
    // link, so a refusal (never a "not found") does not discard it.
    if (check === 'blocked' && SHOPIFY_CDN.test(url) && !unchecked) unchecked = hit;
  }
  return unchecked;
}

// ---- 4. Web search ---------------------------------------------------------
const NOT_A_PRODUCT_IMAGE = /logo|favicon|sprite|placeholder|default|banner|share|social|icon/i;
// Retailers and manufacturers only; never a forum, marketplace listing or ad.
const SKIP_HOSTS = /(ebay|amazon|facebook|pinterest|youtube|reddit|kijiji|aliexpress|temu|walmart\.ca|google)\./i;

async function pageImage(pageUrl, model, trace) {
  const html = await getText(pageUrl);
  if (!html) return null;
  const key = fold(model);
  const title = (html.match(/<title[^>]*>([^<]*)/i)?.[1] || '') + ' ' + (html.match(/property="og:title"\s+content="([^"]*)"/i)?.[1] || '')
    + ' ' + (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  if (!fold(title).includes(key)) return null;
  let img = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
  if (!img || NOT_A_PRODUCT_IMAGE.test(img)) return null;
  try { img = new URL(img.replace(/&amp;/g, '&'), pageUrl).href; } catch { return null; }
  return (await imageLoads(img, trace)) ? { url: img, source: new URL(pageUrl).hostname.replace(/^www\./, '') } : null;
}

async function fromWebSearch(model, make, trace) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { trace.push({ where: 'web search', text: 'not set up', transient: false }); return null; }
  let pages = [];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.STOCK_PHOTO_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: `Find retailer or manufacturer product pages (Canada preferred) for the ${make || ''} appliance model "${model}". Search for the exact model number. Reply with one line saying which pages you found.` }],
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) { noteStatus(trace, 'web search', res.status); return null; }
    const j = await res.json();
    // Take the pages the SEARCH returned, not URLs the model typed out.
    for (const block of j.content || []) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r?.url) pages.push(r.url);
      }
    }
  } catch { noteStatus(trace, 'web search', 0); return null; }
  pages = [...new Set(pages)].filter((u) => /^https:/i.test(u) && !SKIP_HOSTS.test(u)).slice(0, 6);
  for (const u of pages) {
    const hit = await pageImage(u, model, trace);
    if (hit) return hit;
  }
  trace.push({ where: 'web search', text: `no usable page (${pages.length} checked)`, transient: false });
  return null;
}

// "Laundry Centre" is not a model number: searching for it matches any brand's
// laundry centre and would put somebody else's appliance on our listing.
export function hasModelNumber(model) {
  const m = String(model || '').trim();
  return /\d/.test(m) && !m.startsWith('(no model)') && !/\b(set|washer|dryer|range|stove|fridge|refrigerator|laundry|cent(re|er))\b/i.test(m);
}

export async function findStockPhoto(model, make = '', trace = []) {
  const m = String(model || '').trim();
  if (!hasModelNumber(m)) return null;
  return (await fromAjMadison(m, trace)) || (await fromFrigidaire(m, make, trace)) || (await fromShopify(m, trace)) || (await fromWebSearch(m, make, trace)) || null;
}

// Try each photo-less model. `gaps` is modelsWithoutStockPhoto()'s shape:
// { model, make, skus }. Returns
//   set       [{ model, url, source }]
//   notFound  [model]  — looked, nothing set
//   notTried  [model]  — past the per-run cap; NOT a failure
//   why       { model: { text, transient } }
export async function autoFixStockPhotos(gaps, { createdBy = 'auto (stock photo finder)' } = {}) {
  const set = [];
  const notFound = [];
  const why = {};
  const list = [];
  for (const g of (gaps || []).filter((x) => x && x.model)) {
    if (hasModelNumber(g.model)) { list.push(g); continue; }
    notFound.push(g.model);
    why[g.model] = { text: 'The tracker has no model number for this unit. Add it on the tracker.', transient: false };
  }
  for (const g of list.slice(0, MAX_PER_RUN)) {
    const trace = [];
    try {
      const hit = await findStockPhoto(g.model, g.make, trace);
      if (hit) {
        await setModelPhoto(g.model, { url: hit.url }, { createdBy });
        set.push({ model: g.model, url: hit.url, source: hit.source });
        continue;
      }
    } catch (e) {
      console.error('auto stock photo failed', g.model, e?.message || e);
      trace.push({ where: 'saving', text: 'failed', transient: true });
    }
    notFound.push(g.model);
    const said = [...new Set(trace.map((t) => `${t.where}: ${t.text}`))].join('; ');
    why[g.model] = { text: said ? `Tried: ${said}.` : 'No source had a matching page.', transient: trace.some((t) => t.transient) };
    console.log('stock photo not found', g.model, why[g.model].text);
  }
  // Anything past the per-run cap is picked up by the next pass.
  const notTried = list.slice(MAX_PER_RUN).map((g) => g.model);
  return { set, notFound, notTried, why };
}
