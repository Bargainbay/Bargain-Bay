// Resolve the catalogue image for a unit. Server-side only (uses fs).
// Priority:
//   1) explicit `image` field from the sheet/catalog
//   2) manufacturer photo by MODEL from data/images.json (AJ Madison CDN)
//   3) a real photo dropped into public/images/<UID>/main.jpg
//   4) IMAGES_BASE_URL/<UID>/main.jpg if that env is set (remote photo store)
//   5) branded per-category placeholder in /public/stock
import fs from 'fs';
import path from 'path';
import modelImages from '../data/images.json';

const BASE = process.env.IMAGES_BASE_URL || '';
const localCache = new Map(); // uid -> boolean (photo exists in public/images)

function hasLocalPhoto(uid) {
  if (localCache.has(uid)) return localCache.get(uid);
  let exists = false;
  try {
    exists = fs.existsSync(path.join(process.cwd(), 'public', 'images', uid, 'main.jpg'));
  } catch {}
  localCache.set(uid, exists);
  return exists;
}

export function slug(category) {
  return (category || 'appliance').toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-');
}

export function stockImage(category) {
  return `/stock/${slug(category)}.svg`;
}

// Manufacturer image for a model (or null). Exported for the merchant feed.
export function modelImage(model) {
  return modelImages[model] || null;
}

export function imageFor(unit) {
  if (unit.image) return unit.image; // explicit override from the sheet
  const m = modelImage(unit.model);
  if (m) return m;
  if (hasLocalPhoto(unit.id)) return `/images/${unit.id}/main.jpg`;
  if (BASE) return `${BASE.replace(/\/$/, '')}/${unit.id}/main.jpg`;
  return stockImage(unit.category);
}

// True when the resolved image is real product photography (not placeholder
// SVG art). The merchant feed skips units without a real image.
export function hasRealImage(unit) {
  const img = imageFor(unit);
  return Boolean(img) && !img.endsWith('.svg');
}
