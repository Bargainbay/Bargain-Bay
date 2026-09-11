// What a tracker sync actually did, in one sentence, for whoever pressed the
// button. Shared by every sync surface so they cannot word it differently.
//
// The part that matters is `skippedNoPrice`: rows the tracker marks Tested
// Working that the importer refused because they have no usable price. Those
// are units the shop believes are for sale and the website will not show, and
// until now nothing anywhere said so — see lib/sheets.readAvailableReport.
//
// `skippedNotTested` is deliberately NOT surfaced. It counts every sold,
// untested and salvage row in the tracker, which is most of it; reporting it
// would be a large alarming number that means nothing is wrong.
//
// No imports — this runs in the browser.
export function syncSummary(d = {}) {
  const r = d.report || {};
  const ok = `Synced ${d.synced ?? 0} available units`
    + (d.deactivated ? `, removed ${d.deactivated} no longer in stock` : '')
    + '.';

  const warnings = [];
  if (r.skippedNoPrice > 0) {
    warnings.push(
      `${r.skippedNoPrice} row${r.skippedNoPrice === 1 ? '' : 's'} in the tracker say "Tested Working" but have no price, `
      + `so they are NOT on the site. Usually the Condition doesn't match a tier on the Settings tab, `
      + `which leaves Condition % and Suggested Sale Price blank.`
    );
  }
  if (r.skippedNoId > 0) {
    warnings.push(`${r.skippedNoId} row${r.skippedNoId === 1 ? '' : 's'} have no Item ID / SKU and were skipped.`);
  }
  // The importer's own guard: it refuses to deactivate a suspiciously large
  // share of the catalog in one pass. If it fired, the read was probably partial
  // and the site is showing stale stock rather than the truth.
  if (d.skippedDeactivation) {
    warnings.push('The read looked partial, so nothing was delisted this time. Sync again; if it repeats, check the tracker.');
  }
  return { ok, warnings };
}
