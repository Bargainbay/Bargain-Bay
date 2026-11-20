// Loads the Black Friday lots: reads the frozen set from the settings table, choosing and saving it the first time the
// hero renders. Everything fails soft to "no lots" (the caller then shows nothing rather than a wrong banner).
import { getSetting, setSetting } from './settings';
import { chooseLots, lotsToSlides } from './bf-lots';

// One key per sale. A new sale (next year, or a re-pick) uses a new key rather than editing this one.
export const LOTS_KEY = 'bf_lots_2026';

export async function loadSlides(liveUnits = []) {
  let lots = await getSetting(LOTS_KEY, null);
  if (!Array.isArray(lots) || !lots.length) {
    lots = chooseLots(liveUnits, 4);
    if (lots.length) await setSetting(LOTS_KEY, lots).catch(() => {});
  }
  return lotsToSlides(lots, liveUnits);
}
