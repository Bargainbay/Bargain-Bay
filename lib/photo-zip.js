// Fetch every photo of one unit and pack them into a zip, for posting. Server-side because manufacturer CDNs send no CORS headers.
// Reads only. Returns { zip, skipped } or { error }. (The staff route in app/api/admin/fb-listings/zip does the same inline.)
import { fbPhotos } from './fb-kit';
import { zipStore } from './zip-lite';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

export async function photoZip(unit, { fetchImpl = fetch } = {}) {
  const photos = fbPhotos(unit);
  const files = []; const skipped = [];
  await Promise.all(photos.map(async (p, i) => {
    try {
      const r = await fetchImpl(p.url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!r.ok || !type.startsWith('image/')) throw new Error(String(r.status));
      files.push({ i, name: `${unit.id}-${String(i + 1).padStart(2, '0')}-${p.kind}.${EXT[type] || 'jpg'}`, data: Buffer.from(await r.arrayBuffer()) });
    } catch { skipped.push(i + 1); }
  }));
  if (!files.length) return { error: 'None of the photos could be fetched. Use "Open" on each photo and save it from there.' };
  files.sort((a, b) => a.i - b.i);
  return { zip: zipStore(files), skipped: skipped.sort((a, b) => a - b) };
}
