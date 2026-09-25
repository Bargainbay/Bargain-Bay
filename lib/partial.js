// A read that is allowed to fail, but NOT allowed to fail quietly.
//
// THE BUG THIS EXISTS FOR, because it is not obvious and it is expensive:
//
// lib/ledger.js and lib/books.js both wrapped every query in
// `catch { return [] }`. lib/db.js sets `statement_timeout: 10000`. So a
// year-end ledger run whose slowest query takes eleven seconds did not fail —
// it returned NO ROWS, and the page rendered a confident, complete-looking set
// of financial statements with a section of the business silently missing.
//
// The trial balance cannot catch this. `journal()` emits every entry as a
// balanced debit/credit pair, so dropping an entire query drops both sides
// together: debits still equal credits, `outOfBalance` is still 0.00, and the
// page still prints "balances" in green. The one check that was supposed to
// prove the numbers is structurally incapable of detecting the most likely way
// they go wrong. Somebody could file a return off that.
//
// So: the same soft-fail — a report that renders is better than a report that
// 500s — but the failure is COUNTED, REPORTED to lib/observe, and RETURNED to
// the caller so the page can say which section is missing. Degrade open, then
// say so. That is the pattern this codebase already reaches for by hand
// (`syncSummary`, the sync's skippedNoPrice, the P&L's coverage warnings); this
// is the same idea for reads that fall over.
import { query } from './db';
import { captureError } from './observe';

/**
 * A collector for one page-load's worth of reads.
 *
 *   const read = reader('ledger');
 *   const rows = await read('invoices raised', sql, args);
 *   ...
 *   return { rows, problems: read.problems, incomplete: read.incomplete };
 */
// A statement_timeout arrives as a perfectly ordinary error. Naming it matters:
// "the read timed out, try a shorter period" and "that table does not exist"
// send whoever is looking in opposite directions. lib/db sets
// statement_timeout to 10s, and a year-end ledger run is the realistic way to
// hit it — which is exactly when the figures matter most.
//
// Exported so it can be tested against the strings Postgres actually sends
// without standing up a database to be slow at.
export function isTimeout(message) {
  return /statement timeout|canceling statement|query_canceled|57014/i.test(String(message || ''));
}

export function reader(where) {
  const problems = [];

  const read = async (label, sql, args = []) => {
    try {
      return (await query(sql, args)).rows;
    } catch (e) {
      const message = String(e && e.message || e);
      const timedOut = isTimeout(message);
      problems.push({ label, message, timedOut });

      captureError(e, {
        tags: { where, section: label },
        extra: { timedOut },
        // One issue per section, not one per page load.
        fingerprint: `partial-read:${where}:${label}`
      }).catch(() => {});

      return [];
    }
  };

  // Defined as properties so a caller can read them AFTER the awaits, and so
  // `read` stays callable as a plain function.
  Object.defineProperties(read, {
    problems: { get: () => problems },
    incomplete: { get: () => problems.length > 0 }
  });

  return read;
}

/** One line a page can print without knowing anything about the failures. */
export function partialWarning(problems) {
  if (!problems || !problems.length) return null;
  const names = problems.map((p) => p.label);
  const timedOut = problems.some((p) => p.timedOut);
  return {
    sections: names,
    timedOut,
    text:
      `${names.length === 1 ? 'One section' : `${names.length} sections`} could not be read ` +
      `(${names.join(', ')}). The figures below are INCOMPLETE and must not be filed or ` +
      `reported from.` + (timedOut
        ? ' The read timed out — try a shorter period.'
        : '')
  };
}
