// Resolve the catalogue image for a unit. Server-side only (uses fs).
// Priority:
//   1) explicit `image` field from the sheet/catalog
//   2) a real photo dropped into public/images/<UID>/main.jpg
//   3) IMAGES_BASE_URL/<UID>/main.jpg if that env is set (remote photo store)
//   4) branded per-category placeholder in /public/stock
import fs from 'fs';
import path from 'path';

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

export function imageFor(unit) {
  if (unit.image) return unit.image; // explicit override from the sheet
  if (hasLocalPhoto(unit.id)) return `/images/${unit.id}/main.jpg`;
  if (BASE) return `${BASE.replace(/\/$/, '')}/${unit.id}/main.jpg`;
  return stockImage(unit.category);
}
