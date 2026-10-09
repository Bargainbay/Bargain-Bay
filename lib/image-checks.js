// The photo pipeline's checks: what a vendor's upload has to survive before it is
// stored. See docs/marketplace/PLAN.md §7.3.
//
// Every upload is DECODED and RE-ENCODED. That is the security control, not a
// nicety: the original bytes (with their EXIF, GPS position, thumbnails and any
// payload tacked on the end) are never stored or served. What we keep is a fresh
// JPEG we produced ourselves.
//
// Image links are never fetched here — a vendor uploads a FILE. Fetching a URL a
// vendor supplied is an SSRF vector, and the manufacturer CDNs 403 servers anyway.
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const HARD_MIN_EDGE = 1000;   // below this the photo is refused
export const SOFT_MIN_EDGE = 1600;   // below this it is accepted with a warning
export const MAX_EDGE = 2400;        // larger is shrunk, not refused
// Laplacian variance on a 512px copy. A sharp photo of an appliance measures in the hundreds; a
// white fridge against a white wall can legitimately sit in the tens (few edges), so only a
// genuinely smeared or featureless picture is refused and a soft one is warned about.
export const BLUR_FLOOR = 15;
export const BLUR_WARN = 40;

const MAGIC = [
  ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47],
  ['webp', (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
  // HEIC/HEIF: an ISO base media file whose first box is `ftyp`
  ['heif', (b) => b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(b.toString('ascii', 8, 12))]
];

/** What the bytes ARE, by signature — never by file extension or declared type. */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  for (const [name, test] of MAGIC) if (test(buf)) return name;
  return null;
}

import { hammingDistance, isSamePicture, SAME_PICTURE_BITS } from './listing-rules';
export { hammingDistance, isSamePicture, SAME_PICTURE_BITS };

// Difference hash: 9x8 greyscale, each bit says whether a pixel is brighter than its right neighbour.
async function dHash(img) {
  const { data } = await img.clone().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

// Variance of the Laplacian on a fixed-size greyscale copy: a sharp picture has strong
// edges, an out-of-focus one has none.
async function sharpness(img) {
  // NB: sharp's .stats() reads the INPUT image and ignores the pipeline, so the filtered pixels
  // have to be pulled out and measured here.
  const { data } = await img.clone().greyscale().resize(512, null, { fit: 'inside' })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  let v = 0;
  for (let i = 0; i < data.length; i++) { const d = data[i] - mean; v += d * d; }
  return Math.round((v / data.length) * 10) / 10;
}

/**
 * Check and clean one uploaded image.
 * Returns { ok:false, problems } to refuse it, or
 * { ok:true, buffer, width, height, bytes, phash, blur, warnings } with a re-encoded JPEG.
 */
export async function processListingImage(input, { lenient = false } = {}) {
  // lenient = evidence photos on a warranty claim: a customer's phone picture of a fault is what it is. It is
  // still decoded and re-encoded (no EXIF/GPS), but a small or soft one is accepted with a warning, not refused.
  const hardMin = lenient ? 400 : HARD_MIN_EDGE;
  const blurFloor = lenient ? 0 : BLUR_FLOOR;
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buf.length) return { ok: false, problems: ['That file is empty.'] };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, problems: ['That photo is over 15 MB.'] };
  const kind = sniffImage(buf);
  if (!kind) return { ok: false, problems: ['That is not a photo we can read. Use JPG, PNG, WebP or HEIC.'] };

  let img;
  let meta;
  try {
    img = sharp(buf, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate(); // apply orientation, then drop it
    meta = await img.metadata();
  } catch {
    return { ok: false, problems: ['That photo could not be read — it may be damaged or in an unsupported format.'] };
  }
  const w = meta.width || 0;
  const h = meta.height || 0;
  const edge = Math.max(w, h);
  const warnings = [];
  if (edge < hardMin) return { ok: false, problems: [`That photo is too small (${w}×${h}). The long edge must be at least ${hardMin}px.`] };
  if (edge < SOFT_MIN_EDGE) warnings.push(`Low resolution (${w}×${h}); ${SOFT_MIN_EDGE}px or more looks better.`);

  try {
    const phash = await dHash(img);
    const blur = await sharpness(img);
    if (blur < blurFloor) return { ok: false, problems: ['That photo looks out of focus. Retake it in good light, holding the phone steady.'] };
    if (blur < BLUR_WARN) warnings.push('This photo is a little soft — a sharper one sells better.');
    // Re-encode: no EXIF, no GPS, no embedded thumbnails, nothing after the image data.
    const out = await img.clone().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return {
      ok: true, buffer: out.data, width: out.info.width, height: out.info.height,
      bytes: out.data.length, phash, blur, warnings
    };
  } catch {
    return { ok: false, problems: ['That photo could not be processed.'] };
  }
}
