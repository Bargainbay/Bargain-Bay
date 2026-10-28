// What a member's dashboard remembers about them: the stock they had already seen, and the brands,
// models or categories they asked to be told about. One settings row per member
// (`member_prefs:<user id>`), so there is no table and no migration.
//
// "NEW SINCE YOUR LAST VISIT" IS A COMPARISON OF SKUS, NOT OF DATES. A product row has no arrival
// date — `synced_at` is rewritten on every tracker sync — but every unit is one of a kind and a
// SKU never comes back once it has gone. So the dashboard remembers which SKUs were in stock at
// the last visit and calls anything else new.
//
//   - The FIRST visit has nothing to compare with, so nothing is "new". Calling the whole shop new
//     would teach the member to ignore the badge on day one.
//   - The baseline only moves forward when the last visit is more than SEEN_REFRESH_MS old, so
//     reloading the page (or coming back after lunch) does not wipe the badges the member has not
//     had time to look at yet. A visit that flagged something must not also mark it as seen.
//   - A failed READ never writes. Treating "could not read" as "never visited" and saving over it
//     would empty somebody's watchlist because the database blinked.
import { getSettingStrict, setSetting } from './settings';

export const SEEN_REFRESH_MS = 6 * 60 * 60 * 1000;
export const MAX_SEEN = 5000;
export const MAX_WATCH = 30;
export const MAX_TERM = 40;

const key = (userId) => `member_prefs:${Number(userId)}`;

// A watch term is matched as a lower-case substring of make, model, category and title. Folded and
// de-duplicated here so "LG", "lg " and "Lg" are one entry.
export function normalizeWatch(input) {
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const t = String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_TERM);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_WATCH) break;
  }
  return out;
}

// Two remembered sets, because the badges have to survive a reload:
//   seen  = the BASELINE a visit is compared against (what they had seen before this session began)
//   last  = the stock at the most recent visit, which becomes the baseline once the session is over
async function read(userId) {
  const v = await getSettingStrict(key(userId), null);
  const list = (x) => (Array.isArray(x) ? x.map(String) : null);
  return { watch: normalizeWatch(v?.watch), seen: list(v?.seen), last: list(v?.last), seenAt: Number(v?.seenAt) || 0 };
}

export async function getWatch(userId) {
  try { return (await read(userId)).watch; } catch { return []; }
}

// Throws if the stored value cannot be read, so a save never overwrites what it could not see.
export async function saveWatch(userId, terms) {
  const cur = await read(userId);
  const watch = normalizeWatch(terms);
  await setSetting(key(userId), { ...cur, watch });
  return watch;
}

// Called once per dashboard render with the SKUs in stock right now.
// Returns { watch, newSkus, firstVisit }. Never throws: a dashboard without these is still a dashboard.
export async function recordVisit(userId, skus, now = Date.now()) {
  let cur;
  try { cur = await read(userId); } catch { return { watch: [], newSkus: [], firstVisit: false, unavailable: true }; }
  const firstVisit = cur.seen === null;
  const sessionOver = !firstVisit && now - cur.seenAt > SEEN_REFRESH_MS;
  // A new session compares against where the last one ended; a reload keeps the old baseline.
  const baseline = firstVisit ? skus : sessionOver ? (cur.last || cur.seen) : cur.seen;
  const had = new Set(baseline);
  const newSkus = firstVisit ? [] : skus.filter((s) => !had.has(s));
  if (firstVisit || sessionOver) {
    try { await setSetting(key(userId), { watch: cur.watch, seen: baseline.slice(0, MAX_SEEN), last: skus.slice(0, MAX_SEEN), seenAt: now }); }
    catch { /* the badges just carry over to the next visit */ }
  } else {
    try { await setSetting(key(userId), { watch: cur.watch, seen: cur.seen, last: skus.slice(0, MAX_SEEN), seenAt: cur.seenAt }); }
    catch { /* same */ }
  }
  return { watch: cur.watch, newSkus, firstVisit };
}
