// Bank feed via Plaid — TD (and any other institution the owner links) straight
// into the expense ledger.
//
// WHY PLAID over Flinks: `/transactions/sync` is a cursor endpoint built for
// exactly this shape of problem — thousands of transactions, pulled forward a
// page at a time, with the cursor persisted so a run that times out resumes
// instead of starting again. Plus a webhook that says "there's new data" so the
// feed is current within minutes rather than only after the nightly cron.
//
// WHAT A BANK LINE IS AND ISN'T: it's a gross amount off a statement. It does
// NOT know what tax was inside it — the bank never saw the receipt. So every
// imported row lands with `tax = NULL`, which the remittance panel counts as
// "not reviewed", and the review screen is where a person turns a pile of
// charges into claimable credits. Guessing 13% on import would silently invent
// input tax credits on wages, insurance and US purchases.
//
// Dormant until PLAID_CLIENT_ID + PLAID_SECRET are set; every entry point
// no-ops cleanly so the Financial dashboard renders either way.
import { getSetting, setSetting } from './settings';
import { upsertExpense, deleteExpenseByExtId, getLedgerStart, loadRules, matchRule } from './finance';
import { SITE_URL } from './site';

const ENV = () => (process.env.PLAID_ENV === 'sandbox' ? 'sandbox' : 'production');
const HOST = () => `https://${ENV()}.plaid.com`;
// Money-out rows only, and only ones that are really a cost. A credit-card
// payment or a transfer between the owner's own accounts is the SAME money as
// the purchases it settles — importing both counts every coffee twice.
const SKIP_CATEGORIES = new Set([
  'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'INCOME',
  'BANK_FEES' // kept out of the skip list below on purpose — see PFC_CATEGORY
]);
SKIP_CATEGORIES.delete('BANK_FEES'); // a bank fee IS an operating cost

// Plaid's personal-finance categories → the app's own expense categories, so a
// bank feed lands in the same buckets the owner already types by hand.
const PFC_CATEGORY = {
  RENT_AND_UTILITIES: 'Rent / storage',
  TRANSPORTATION: 'Fuel / delivery',
  TRAVEL: 'Fuel / delivery',
  GENERAL_SERVICES: 'Fees',
  BANK_FEES: 'Fees',
  GENERAL_MERCHANDISE: 'Tools / supplies',
  HOME_IMPROVEMENT: 'Tools / supplies',
  PERSONAL_CARE: 'Other',
  FOOD_AND_DRINK: 'Other',
  ENTERTAINMENT: 'Other',
  MEDICAL: 'Other',
  GOVERNMENT_AND_NON_PROFIT: 'Fees'
};

export function plaidConfigured() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

async function plaid(path, body = {}) {
  if (!plaidConfigured()) throw new Error('Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET).');
  const res = await fetch(`${HOST()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Plaid's own message is the useful one ("this Item requires re-auth"), so
    // surface it rather than a status code nobody can act on.
    throw new Error(data?.error_message || `Plaid ${path} failed (${res.status}).`);
  }
  return data;
}

// ---- linked institutions --------------------------------------------------
// An "item" is one login at one bank, covering every account under it. Stored as
// a list because a business normally has a bank AND a card, often at different
// institutions.
async function items() {
  const v = await getSetting('plaid_items', []).catch(() => []);
  return Array.isArray(v) ? v : [];
}
async function saveItems(list) {
  await setSetting('plaid_items', list);
}

export async function plaidStatus() {
  const list = await items();
  return {
    configured: plaidConfigured(),
    env: ENV(),
    connected: list.length > 0,
    institutions: list.map((i) => ({
      itemId: i.itemId,
      institution: i.institution || 'Bank',
      addedAt: i.addedAt || null,
      lastSync: i.lastSync || null,
      // Set when Plaid tells us the login has stopped working. Until it's
      // cleared the feed is stale, and saying so beats a quietly empty ledger.
      needsReauth: !!i.needsReauth
    })),
    lastSync: await getSetting('plaid_last_sync', null).catch(() => null)
  };
}

// Step 1 of linking: a short-lived token the browser hands to Plaid Link.
export async function createLinkToken({ userId = 'owner', itemId = null } = {}) {
  const base = {
    client_name: 'Bargain Bay',
    country_codes: ['CA'],
    language: 'en',
    user: { client_user_id: String(userId) },
    webhook: `${SITE_URL}/api/plaid/webhook`
  };
  // Re-auth for an existing item: no products, just the access token.
  if (itemId) {
    const found = (await items()).find((i) => i.itemId === itemId);
    if (!found) throw new Error('That bank connection no longer exists.');
    const r = await plaid('/link/token/create', { ...base, access_token: found.accessToken });
    return r.link_token;
  }
  const r = await plaid('/link/token/create', {
    ...base,
    products: ['transactions'],
    // Two years of history on the first pull, so a full year's input tax
    // credits are there to review rather than only what happened since setup.
    transactions: { days_requested: 730 }
  });
  return r.link_token;
}

// Step 2: swap the browser's public token for a long-lived access token.
export async function exchangePublicToken(publicToken) {
  if (!publicToken) throw new Error('No public token.');
  const ex = await plaid('/item/public_token/exchange', { public_token: publicToken });
  let institution = 'Bank';
  try {
    const it = await plaid('/item/get', { access_token: ex.access_token });
    const id = it?.item?.institution_id;
    if (id) {
      const inst = await plaid('/institutions/get_by_id', { institution_id: id, country_codes: ['CA'] });
      institution = inst?.institution?.name || institution;
    }
  } catch { /* cosmetic only — the feed works without a pretty name */ }

  const list = await items();
  // Re-linking the same bank replaces its entry (and its cursor) rather than
  // adding a second copy of every transaction.
  const next = list.filter((i) => i.itemId !== ex.item_id);
  next.push({
    itemId: ex.item_id, accessToken: ex.access_token, institution,
    addedAt: new Date().toISOString(), cursor: null, lastSync: null, needsReauth: false
  });
  await saveItems(next);
  return { itemId: ex.item_id, institution };
}

export async function plaidDisconnect(itemId) {
  const list = await items();
  const found = list.find((i) => i.itemId === itemId);
  if (found) {
    // Tell Plaid too, so the owner stops being billed for a connection nobody
    // reads. A failure here must not strand the row on our side.
    await plaid('/item/remove', { access_token: found.accessToken }).catch(() => {});
  }
  await saveItems(list.filter((i) => i.itemId !== itemId));
  return true;
}

// ---- the feed -------------------------------------------------------------

// One Plaid transaction → an expense-ledger row, or null when it isn't a cost.
// Plaid's sign convention for a depository account: POSITIVE is money leaving.
export function mapTransaction(t, institution, { rules = [], start = null } = {}) {
  if (!t || t.pending) return null; // a pending row is replaced when it posts
  const amount = Number(t.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null; // money in, not out
  const pfc = t.personal_finance_category?.primary || '';
  if (SKIP_CATEGORIES.has(pfc)) return null;
  // Before the books start here, it belongs to the previous system.
  if (start && String(t.date || '') < start) return null;
  const name = t.merchant_name || t.name || 'Bank transaction';
  // A vendor rule beats Plaid's guess: the owner knows their own suppliers, and
  // Plaid has never heard of the appliance wholesaler down the road.
  const hit = matchRule(rules, name, t.name);
  // The charge off the statement is GROSS. What tax was inside it is unknown —
  // unless the owner has written a rule saying so for this supplier, which is
  // their judgement about a vendor they know rather than the system guessing.
  // No rule, no tax figure: the row goes to the review queue, as before.
  const gross = Math.round(amount * 100) / 100;
  let cost = gross;
  let tax = null;
  if (hit?.taxMode === 'hst') {
    cost = Math.round((gross / 1.13) * 100) / 100;
    tax = Math.round((gross - cost) * 100) / 100;
  } else if (hit?.taxMode === 'none') {
    tax = 0;
  }

  return {
    incurredOn: t.date,
    category: hit?.category || PFC_CATEGORY[pfc] || 'Other',
    vendor: String(name).slice(0, 120),
    amount: cost,
    tax,
    note: `${institution || 'Bank'}${t.account_owner ? ` · ${t.account_owner}` : ''}`,
    extId: `plaid:${t.transaction_id}`,
    source: 'plaid'
  };
}

// Pull everything new since the stored cursor, for every linked institution.
//
// The cursor is saved after EVERY page. With thousands of transactions a run can
// hit the function's time limit, and a cursor written only at the end would mean
// starting from scratch each night and never catching up.
export async function syncPlaidTransactions({ maxPages = 40 } = {}) {
  if (!plaidConfigured()) return { configured: false, added: 0, updated: 0, removed: 0 };
  const list = await items();
  if (!list.length) return { configured: true, connected: false, added: 0, updated: 0, removed: 0 };

  const [rules, start] = await Promise.all([loadRules(), getLedgerStart()]);
  const opts = { rules, start };
  let added = 0, updated = 0, removed = 0;
  const errors = [];

  for (const item of list) {
    let pages = 0;
    try {
      for (;;) {
        const r = await plaid('/transactions/sync', {
          access_token: item.accessToken,
          cursor: item.cursor || undefined,
          count: 500
        });
        for (const t of (r.added || [])) {
          const m = mapTransaction(t, item.institution, opts);
          if (m) { await upsertExpense(m); added++; }
        }
        for (const t of (r.modified || [])) {
          const m = mapTransaction(t, item.institution, opts);
          // A row that became skippable (recategorized as a transfer) is taken
          // back out rather than left behind as a phantom cost.
          if (m) { await upsertExpense(m); updated++; }
          else { await deleteExpenseByExtId(`plaid:${t.transaction_id}`); removed++; }
        }
        for (const t of (r.removed || [])) {
          await deleteExpenseByExtId(`plaid:${t.transaction_id}`);
          removed++;
        }
        item.cursor = r.next_cursor;
        item.lastSync = new Date().toISOString();
        item.needsReauth = false;
        await saveItems(list); // persist per page — see above
        pages++;
        if (!r.has_more || pages >= maxPages) break;
      }
    } catch (e) {
      const msg = e?.message || 'sync failed';
      // ITEM_LOGIN_REQUIRED and friends mean the owner has to re-authenticate in
      // Plaid Link. Flagged on the item so the panel can offer the button.
      if (/login|ITEM_LOGIN_REQUIRED|re-?auth|credential/i.test(msg)) {
        item.needsReauth = true;
        await saveItems(list);
      }
      errors.push(`${item.institution}: ${msg}`);
    }
  }

  await setSetting('plaid_last_sync', new Date().toISOString()).catch(() => {});
  return { configured: true, connected: true, added, updated, removed, errors: errors.slice(0, 5) };
}

// Does this webhook belong to a bank we actually linked? The payload is never
// trusted for DATA — it only ever triggers a pull with our own credentials — so
// this is about not letting anyone make us sync on demand.
export async function knownItem(itemId) {
  if (!itemId) return false;
  return (await items()).some((i) => i.itemId === itemId);
}
