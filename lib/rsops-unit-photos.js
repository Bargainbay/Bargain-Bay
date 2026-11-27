// RS Ops' photos of particular units, for people inside the business (the
// driver's loading checklist). The public storefront feed only carries LISTED
// units; most of what goes on a van needs the picture whether or not it was ever
// listed. Key-protected on RS Ops' side, same key as the manifest.
//
// Soft-fails to "no photos" in every case: a stop list must never wait on, or
// break because of, the refurb app.
const BASE = process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca';
const TTL_MS = 10 * 60_000;
const DOWN_MS = 60_000;      // after a failure, don't make every refresh wait again
const TIMEOUT_MS = 3500;

const cache = new Map();     // UPPERCASED sku -> { at, value | null }
let downUntil = 0;

const key = (s) => String(s || '').trim().toUpperCase();

export function resetRsopsPhotoCache() { cache.clear(); downUntil = 0; }

/** Map of UPPERCASED sku -> { stage: 'ready'|'intake', photos: [{ slot, url }] }. */
export async function rsopsUnitPhotos(skus = []) {
  const out = new Map();
  const want = [...new Set((skus || []).map(key).filter(Boolean))];
  if (!want.length || !process.env.RSOPS_INTAKE_KEY) return out;
  const now = Date.now();
  const need = want.filter((s) => !(cache.get(s) && now - cache.get(s).at < TTL_MS));
  if (need.length && now >= downUntil) {
    try {
      for (let i = 0; i < need.length; i += 100) {
        const batch = need.slice(i, i + 100);
        const res = await fetch(`${BASE}/api/intake/unit-photos?ids=${encodeURIComponent(batch.join(','))}`, {
          headers: { 'x-rsops-key': process.env.RSOPS_INTAKE_KEY },
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const found = new Map(Object.entries(body?.units || {}).map(([id, u]) => [key(id), u]));
        for (const s of batch) cache.set(s, { at: now, value: found.get(s) || null });
      }
    } catch (e) {
      downUntil = now + DOWN_MS;
      console.error('rsops unit photos unavailable:', e?.message || e);
    }
  }
  for (const s of want) {
    const hit = cache.get(s)?.value;
    if (hit?.photos?.length) out.set(s, hit);
  }
  return out;
}
