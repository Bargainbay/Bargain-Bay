// Catalog access. data/catalog.json is the synced snapshot of the master
// tracker's available units ({ generatedAt, units: [...] }). Availability
// (sold / reserved) is layered on from Postgres by lib/reservations.
import catalogFile from '../data/catalog.json';
import { imageFor } from './images';
import { unavailableSkus } from './reservations';

const units = Array.isArray(catalogFile) ? catalogFile : catalogFile.units || [];

export function getAll() {
  return units.map((u) => ({ ...u, image: imageFor(u) }));
}

export function getById(id) {
  const u = units.find((x) => x.id === id);
  if (!u) return null;
  return { ...u, image: imageFor(u) };
}

export function getMany(ids) {
  return ids.map((id) => getById(id)).filter(Boolean);
}

// All units that are purchasable right now (DB-aware; falls back to "all").
export async function getAvailable() {
  const blocked = await unavailableSkus();
  return getAll().filter((u) => !blocked.has(u.id));
}

// Last N units in catalog order = most recently added lots.
export function newestArrivals(all, n = 12) {
  return [...all].slice(-n).reverse();
}

export function categories(list = getAll()) {
  return [...new Set(list.map((u) => u.category))].sort();
}

export function brands(list = getAll()) {
  return [...new Set(list.map((u) => u.make))].sort();
}
