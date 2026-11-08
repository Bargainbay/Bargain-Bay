// The owner's overrides for the online add-ons, read from the service price catalog.
// Server-only (it touches the database); the pure rules live in lib/addons.js.
//
// A service in the catalog with the add-on's NAME decides: a new price, or switched off
// (not active). No row at all = the rate-sheet price. A failed read = the rate-sheet
// price too — add-ons are optional extras, so a database blip must never take checkout down
// or, worse, quietly stop charging what the sheet says.
import { hasDb, query } from './db';
import { ADDONS } from './addons';

export async function loadAddonOverrides() {
  if (!hasDb()) return {};
  try {
    const names = ADDONS.map((a) => a.name.toLowerCase());
    const { rows } = await query(
      `SELECT name, default_price, active FROM services WHERE lower(name) = ANY($1) ORDER BY active DESC, id DESC`, [names]);
    const out = {};
    for (const r of rows) {
      const addon = ADDONS.find((a) => a.name.toLowerCase() === String(r.name).toLowerCase());
      if (!addon || out[addon.name]) continue;       // first row wins: an ACTIVE one before an inactive one
      out[addon.name] = { price: r.default_price == null ? null : Number(r.default_price), active: r.active !== false };
    }
    return out;
  } catch {
    return {};
  }
}
