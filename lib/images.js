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
import { TRACKER_PHOTOS_ENABLED } from './constants';

// Normalize AJ Madison (Cloudinary) images to a uniform square: e_trim removes
// the baked-in white border, then c_pad re-pads every product to an identical
// 1000x1000 canvas — so all cards render at the same size regardless of source.
function normalizeImg(url) {
  if (!url || url.indexOf('assets.ajmadison.com') === -1) return url;
  return url.replace(
    /\/image\/upload\/[^/]+\/v1\//,
    '/image/upload/e_trim:10/c_pad,w_1000,h_1000,b_white/f_jpg,q_auto/v1/'
  );
}


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
  return normalizeImg(modelImages[model] || null);
}

// A per-unit photo URL from the master tracker. Accepts a direct image URL or a
// Google Drive share link (which we convert to a renderable thumbnail URL).
export function photoUrl(raw) {
  const u = String(raw || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  const drive = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{20,})/);
  if (drive) return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w1000`;
  return u;
}

export function imageFor(unit) {
  // OUR OWN photos of the unit are deliberately NOT consulted here — the same
  // rule RS Ops's gallery has always followed (lib/rsops.js). Every card, every
  // buy panel, the OG tag and the Meta feed lead with the STOCK picture, and the
  // real photographs of the machine come after it on the product page.
  //
  // That is the owner's call and it is about how the shop reads: a wall of
  // studio shots at a consistent angle on a consistent background is what makes
  // a listing page look like a shop, and a phone photo taken at the loading bay
  // next to eleven of them looks like a mistake. The real pictures are what
  // close the sale, and they are one scroll down where a buyer is already
  // looking for them.
  //
  // The cost is stated rather than hidden: a unit with no manufacturer photo
  // falls through to the branded category placeholder, and `hasRealImage` is
  // false for a placeholder, so `/feed` skips it. See CLAUDE.md.
  if (TRACKER_PHOTOS_ENABLED) {
    const tracker = photoUrl(unit.imageUrl); // real per-unit photo from the tracker
    if (tracker) return tracker;
  }
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
