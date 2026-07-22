// Real per-unit photos from RS Ops (the internal refurb-processing app).
// Feed: https://rs-ops.vercel.app/api/storefront — only units QA/Admin have
// explicitly listed appear there, each with its 6 assessment photos.
//
// Matching is by SKU ONLY (site SKU == RS Ops unit id, both `SS-<lot>-NNN`).
// We deliberately do NOT fall back to model matching: every unit here is
// one-of-a-kind, and showing another unit's scratches would mislead buyers.
//
// Soft-fails to "no photos" in every error path so the storefront never
// depends on RS Ops being reachable. Feed is cached for 5 minutes.
const FEED = process.env.RSOPS_FEED_URL || 'https://rs-ops.vercel.app/api/storefront';

const SLOT_ORDER = ['Front', 'Left side', 'Right side', 'Back side', 'Top', 'Model sticker'];

async function feedItems() {
  try {
    const res = await fetch(FEED, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    console.error('rsops feed unavailable:', e.message);
    return [];
  }
}

const norm = (s) => String(s || '').trim().toUpperCase();

function sortedPhotos(item) {
  return [...(item.photos || [])]
    .filter((p) => p && p.url)
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}

// Decorate units: when RS Ops has photos for a SKU, attach the gallery as
// `rsopsPhotos`. ADDITIVE ONLY — the manufacturer stock image stays as
// `image` (cards, buy panel, Meta feed, OG metadata are unchanged); the real
// unit photos appear as the product page's "Photos of this exact unit".
export async function withRsopsPhotos(units) {
  if (!units.length) return units;
  const items = await feedItems();
  if (!items.length) return units;
  const bySku = new Map(items.map((i) => [norm(i.id), i]));
  return units.map((u) => {
    const hit = bySku.get(norm(u.id));
    if (!hit) return u;
    const photos = sortedPhotos(hit);
    if (!photos.length) return u;
    return { ...u, rsopsPhotos: photos };
  });
}

export async function withRsopsPhotosOne(unit) {
  if (!unit) return unit;
  const [decorated] = await withRsopsPhotos([unit]);
  return decorated;
}
