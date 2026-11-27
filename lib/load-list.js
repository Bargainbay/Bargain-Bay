// What the crew is looking for when they load the van.
//
// A job item is a line of text and sometimes a SKU. A driver does not know what
// an "RF28T5001SR" looks like, so each item is turned into: what kind of
// appliance it is, who makes it, the model and serial to read off the sticker,
// where it is standing, and pictures. The pictures say which they are, always:
// the actual unit, or a stock picture of the model.
//
// Everything here degrades to less detail, never to an error.
import { hasDb, query } from './db';
import { unitsForSkus } from './line-models';
import { modelTokens, modelsMatch } from './stock-match';
import { unitModelImage, modelImage } from './images';
import { warmModelPhotos } from './model-photos';
import { photosBySku } from './unit-photos';
import { rsopsUnitPhotos } from './rsops-unit-photos';
import { currentLocations } from './locations';

const key = (s) => String(s || '').trim().toUpperCase();

// A stock picker writes "Whirlpool fridge (SS-117082-004)". A stop edited by hand
// can lose the SKU column and keep that.
export function skuFromDescription(description) {
  const m = String(description || '').trim().match(/\(([A-Za-z0-9][A-Za-z0-9._-]{4,})\)$/);
  return m && /\d/.test(m[1]) && m[1].includes('-') ? m[1] : '';
}

const soft = async (p, fallback) => {
  try { return await p; } catch (e) { console.error('load list lookup failed', e?.message || e); return fallback; }
};

/**
 * items: [{ id, description, sku }] -> Map(id -> {
 *   sku, make, model, category, serial, location,
 *   photos: [{ url, caption, exact }] })
 * Actual-unit pictures come first.
 */
export async function itemDetails(items = [], { read } = {}) {
  const list = (items || []).filter((it) => it && it.id != null);
  const out = new Map();
  if (!list.length) return out;

  const skuOf = new Map(list.map((it) => [it.id, String(it.sku || '').trim() || skuFromDescription(it.description)]));
  const skus = [...new Set([...skuOf.values()].filter(Boolean))];
  const units = await soft(unitsForSkus(skus, { read }), new Map());

  // Typed lines and other companies' stops: no SKU, but often a model number.
  const tokensOf = new Map(list
    .filter((it) => !units.get(key(skuOf.get(it.id)))?.model)
    .map((it) => [it.id, modelTokens(it.description)]));
  const tokens = [...new Set([...tokensOf.values()].flat().map(key))];
  let byModel = [];
  if (tokens.length && hasDb()) {
    byModel = await soft(query(
      'SELECT DISTINCT make, model, category FROM products WHERE upper(model) = ANY($1::text[])', [tokens]
    ).then((r) => r.rows), []);
  }

  // Photos are stored under the SKU as the site spells it.
  const spelled = skus.map((s) => units.get(key(s))?.sku || s);
  await soft(warmModelPhotos(), null);
  const [own, ops, where] = await Promise.all([
    soft(photosBySku(spelled), new Map()),
    soft(rsopsUnitPhotos(spelled), new Map()),
    soft(currentLocations(spelled), new Map())
  ]);
  const ownByKey = new Map([...own].map(([s, v]) => [key(s), v]));
  const whereByKey = new Map([...where].map(([s, v]) => [key(s), v]));

  for (const it of list) {
    const sku = skuOf.get(it.id);
    const unit = sku ? units.get(key(sku)) : null;
    let make = unit?.make || '';
    let model = unit?.model || '';
    let category = unit?.category || '';
    let stock = model ? unitModelImage({ make, model }) : null;
    if (!model) {
      for (const t of tokensOf.get(it.id) || []) {
        const p = byModel.find((r) => modelsMatch(r.model, t) || key(r.model) === key(t));
        const img = modelImage(p?.model || t) || modelImage(key(t));
        if (!p && !img) continue;     // a postal code looks like a model too
        model = p?.model || t;
        make = make || p?.make || '';
        category = category || p?.category || '';
        stock = img || (p ? unitModelImage(p) : null);
        break;
      }
    }

    const photos = [];
    for (const p of ownByKey.get(key(sku)) || []) photos.push({ url: p.url, caption: 'This exact unit', exact: true });
    const o = sku ? ops.get(key(sku)) : null;
    for (const p of o?.photos || []) {
      const when = o.stage === 'intake' ? ' · when it arrived, before cleaning' : '';
      photos.push({ url: p.url, caption: `This exact unit${p.slot ? ` · ${p.slot}` : ''}${when}`, exact: true });
    }
    if (stock) photos.push({ url: stock, caption: 'Stock picture of this model — not this unit', exact: false });

    out.set(it.id, {
      sku: unit?.sku || sku || '', make, model, category,
      serial: unit?.serial || '', location: whereByKey.get(key(sku))?.code || '', photos
    });
  }
  return out;
}
