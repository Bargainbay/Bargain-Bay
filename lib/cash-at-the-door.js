// Cash the driver has to come back with that is NOT an invoice balance.
//
// A client's own spreadsheet said "CUSTOMER OWERS DRIVERS $50" — buried in a run
// of italic notes at the same weight as a reference number, on a sheet a driver
// reads in a van. Money that is invisible on the paperwork is money nobody
// collects, and then it is money the office argues about a week later.
//
// There are two ways a stop can carry it and they are deliberately different:
//
//   · `jobs.collect_cash` — somebody typed it. Authoritative, totalled, shown as
//     a figure.
//   · this reader — nobody typed it, but the CLIENT's text says so. Flagged, and
//     always shown next to the sentence it came from, because a number lifted
//     out of somebody else's prose is a suggestion, not a fact.
//
// The reader exists because the notes it reads are already in the database and
// arrive that way with every import. A structured field alone would be correct
// and would do nothing for the stops that are on the board today.
//
// No imports: this runs on the server for the printed sheet AND in the browser
// for the board and the driver's phone.

// A fragment is one thought. Client notes come in as "A · B · C", and an amount
// in one clause has nothing to do with a keyword in another.
const FRAGMENTS = /[·;\n\r]|(?:(?<=[a-z0-9)])\.\s)/i;

// Words that make an amount money somebody hands over at the door.
// `ow\w*` deliberately covers owe/owes/owed/owing — and `owers`, which is how
// it is actually spelled on the client sheet this was built from.
const OWED = /\b(ow\w*|collect\w*|cod|c\.o\.d|cash|due|payable|pay|pays|paying|driver\w*)\b/i;
// ...and words that mean it has already happened, or is somebody else's problem.
// "Customer already paid the driver $50" must never print as $50 to collect.
const SETTLED = /\b(paid|prepaid|pre-paid|settled|received|refund\w*|credit\w*|no charge|nothing (?:to|owing)|waived|invoiced|deposit)\b/i;

const AMOUNT = /\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)|\b([0-9]{1,4}(?:\.[0-9]{1,2})?)\s?(?:dollars|bucks)\b/i;

/**
 * Read a cash-at-the-door amount out of free text.
 * Returns { amount, phrase } or null. `phrase` is the clause it came from, so
 * whatever renders this can show its own working.
 */
export function cashOwedInNotes(notes) {
  const text = String(notes || '').trim();
  if (!text) return null;
  for (const raw of text.split(FRAGMENTS)) {
    const frag = String(raw || '').trim();
    if (!frag || frag.length > 240) continue;
    if (!OWED.test(frag) || SETTLED.test(frag)) continue;
    const m = frag.match(AMOUNT);
    if (!m) continue;
    const amount = Number(String(m[1] || m[2]).replace(/,/g, ''));
    // A stray year or a model number is not a price, and neither is $0.
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) continue;
    return { amount, phrase: frag };
  }
  return null;
}

/**
 * What a stop wants the driver to come back with, from whichever source knows.
 * An explicitly entered figure always wins over anything read out of prose.
 */
export function cashAtTheDoor(job) {
  if (!job) return null;
  const typed = job.collectCash == null ? null : Number(job.collectCash);
  if (Number.isFinite(typed) && typed > 0) {
    return { amount: typed, note: job.collectCashNote || null, typed: true };
  }
  const found = cashOwedInNotes(job.notes);
  return found ? { amount: found.amount, note: found.phrase, typed: false } : null;
}
