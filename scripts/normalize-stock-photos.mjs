// Makes every stock photo in data/images.json fill its square tile the same way.
//
//   node scripts/normalize-stock-photos.mjs            # report only
//   node scripts/normalize-stock-photos.mjs --write    # re-host the outliers
//
// WHY: the product tile is a fixed square (.thumb in app/globals.css) and the
// photo is object-fit: contain, so every TILE is the same size — but how big the
// APPLIANCE looks depends on how much white margin its source file carries. An LG
// render is a wide 3:2 canvas with the product in the middle ~58% of it, so it
// reads as a small appliance beside an AJ Madison photo that fills the frame.
// lib/images.js already fixes this for assets.ajmadison.com (trim + pad, done by
// their CDN); every other host is served as-is.
//
// WHAT IT DOES: measures how much of its square each image fills (longest side of
// the non-white content / longest side of the file, i.e. what object-fit: contain
// shows). Anything under MIN_FILL is trimmed of its margin, scaled so the product
// is TARGET_FILL of a 1000x1000 white square, and saved to public/model-photos/,
// and its images.json key is pointed at the local copy. AJ Madison entries are
// left alone (already normalised at request time). Images that are already full
// are left alone, so running it twice changes nothing.
//
// It can only fix what it can download. A host that blocks scripts is reported,
// not skipped silently.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const JSON_PATH = path.join(ROOT, 'data/images.json');
const OUT_DIR = path.join(ROOT, 'public/model-photos');
const SIZE = 1000;
const MIN_FILL = 0.95;     // below this the product looks small beside its neighbours
const TARGET_FILL = 0.98;  // what AJ Madison's trimmed-and-padded images measure
const WHITE = 240;         // a pixel above this on every channel is "background"
const WRITE = process.argv.includes('--write');

const map = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

async function load(url) {
  if (url.startsWith('/')) return fs.readFileSync(path.join(ROOT, 'public', url));
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Bounding box of everything that is not white, on a flattened copy.
async function contentBox(buf) {
  const { data, info } = await sharp(buf).flatten({ background: '#fff' }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      if (data[i] < WHITE || data[i + 1] < WHITE || data[i + 2] < WHITE) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, w, h };
}

const byUrl = new Map(); // source url -> local url (several keys share one photo)
let fixed = 0, fine = 0;
const problems = [];

for (const [key, url] of Object.entries(map)) {
  if (typeof url !== 'string') continue;
  if (/^https?:\/\/assets\.ajmadison\.com\//.test(url)) continue; // normalised by lib/images.js
  if (byUrl.has(url)) { map[key] = byUrl.get(url); continue; }
  try {
    const buf = await load(url);
    const box = await contentBox(buf);
    if (!box) { problems.push(`${key}: image is blank`); continue; }
    const fill = Math.max(box.width, box.height) / Math.max(box.w, box.h);
    if (fill >= MIN_FILL) { fine++; continue; }
    const file = key.replace(/[^A-Za-z0-9._-]/g, '_') + '.jpg';
    console.log(`${fill.toFixed(2)} -> ${TARGET_FILL}  ${key}  (${box.w}x${box.h})`);
    if (WRITE) {
      const inner = Math.round(SIZE * TARGET_FILL);
      const product = await sharp(buf).flatten({ background: '#fff' })
        .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
        .resize(inner, inner, { fit: 'inside', background: '#fff' }).toBuffer();
      await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#fff' } })
        .composite([{ input: product, gravity: 'centre' }])
        .jpeg({ quality: 90 }).toFile(path.join(OUT_DIR, file + '.tmp'));
      fs.renameSync(path.join(OUT_DIR, file + '.tmp'), path.join(OUT_DIR, file));
      byUrl.set(url, `/model-photos/${file}`);
      map[key] = `/model-photos/${file}`;
    }
    fixed++;
  } catch (e) {
    problems.push(`${key}: ${e.message} (${url.slice(0, 70)})`);
  }
}

if (WRITE) fs.writeFileSync(JSON_PATH, JSON.stringify(map, null, 1) + '\n');
console.log(`\n${fixed} ${WRITE ? 'normalised' : 'would be normalised'}, ${fine} already fill their frame.`);
if (problems.length) console.log(`Could not check ${problems.length}:\n  ` + problems.join('\n  '));
