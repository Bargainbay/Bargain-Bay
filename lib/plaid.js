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
import { mapDeposit, recordDeposit } from './deposit-match';
import { upsertExpense, fillExpenseDetails, deleteExpenseByExtId, getLedgerStart, loadRules, matchRule, splitExtIds } from './finance';
import { SITE_URL } from './site';
import { mapActivity, recordActivity, deleteActivity, hasExpense, isDecidedExpense } from './bank-activity';

// Bump to make every linked bank re-send its history once (see syncPlaidTransactions).
// 3: also keep every non-expense line (pending, money in, transfers) for the live transaction list.
const DETAILS_V = 3;
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
  GENERAL_SERVICES: 'Card & bank fees',
  BANK_FEES: 'Card & bank fees',
  GENERAL_MERCHANDISE: 'Tools / supplies',
  HOME_IMPROVEMENT: 'Tools / supplies',
  PERSONAL_CARE: 'Other',
  FOOD_AND_DRINK: 'Other',
  ENTERTAINMENT: 'Other',
  MEDICAL: 'Other',
  GOVERNMENT_AND_NON_PROFIT: 'Card & bank fees'
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
    const code = data?.error_code || '';
    const raw = data?.error_message || `Plaid ${path} failed (${res.status}).`;
    // A quota / plan problem is on Plaid's account, not in this app, and the raw
    // message does not say what to do about it.
    if (/quota|free|limit|billing|plan|pay.?as.?you.?go|not.*enabled|not.*approved|production access|RATE_LIMIT|ADDITIONAL_CONSENT|PRODUCT_NOT_ENABLED|INVALID_PRODUCT/i.test(`${code} ${raw}`)
        && !/ITEM_LOGIN_REQUIRED/.test(code)) {
      const e = new Error(`Plaid account problem (${code || res.status}): ${raw} — this is a plan/billing limit on the Plaid account, not the app. In the Plaid Dashboard move the account to Pay as you go, then press Pull now.`);
      e.plaidCode = code;
      throw e;
    }
    const e = new Error(code ? `${raw} (${code})` : raw);
    e.plaidCode = code;
    throw e;
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
export function mapTransaction(t, institution, { rules = [], start = null, accounts = null } = {}) {
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

  // Everything the bank told us about who and what, kept so a person can see it
  // when deciding. TD's e-transfer lines carry little (a reference code and the
  // memo the sender typed), others carry a merchant and counterparty.
  const pm = t.payment_meta || {};
  const cps = Array.isArray(t.counterparties) ? t.counterparties.filter((c) => c && c.name) : [];
  const payee = (cps.find((c) => c.type === 'merchant') || cps[0] || {}).name || t.merchant_name || null;
  const acct = accounts && t.account_id ? accounts.get(t.account_id) : null;
  const bank = {
    name: t.name || null,
    merchant_name: t.merchant_name || null,
    original_description: t.original_description || null,
    counterparties: cps.map((c) => ({ name: c.name, type: c.type || null })),
    payment_meta: Object.fromEntries(Object.entries(pm).filter(([, v]) => v != null && v !== '')),
    payment_channel: t.payment_channel || null,
    category: t.personal_finance_category ? {
      primary: t.personal_finance_category.primary || null,
      detailed: t.personal_finance_category.detailed || null,
      confidence: t.personal_finance_category.confidence_level || null
    } : null,
    location: t.location ? { city: t.location.city || null, region: t.location.region || null } : null,
    check_number: t.check_number || null,
    authorized_date: t.authorized_date || null
  };

  return {
    incurredOn: t.date,
    category: hit?.category || PFC_CATEGORY[pfc] || 'Other',
    vendor: String(name).slice(0, 120),
    amount: cost,
    tax,
    note: `${institution || 'Bank'}${t.account_owner ? ` · ${t.account_owner}` : ''}`,
    extId: `plaid:${t.transaction_id}`,
    source: 'plaid',
    payee: payee ? String(payee).slice(0, 120) : null,
    bankDesc: String(t.original_description || t.name || '').slice(0, 300) || null,
    // The memo the bank carries, when it carries one.
    memo: pm.reason ? String(pm.reason).slice(0, 300) : null,
    bank,
    accountLabel: acct || null,
    // A rule is the owner's own decision; anything else is the bank's guess.
    catSource: hit?.category ? 'rule' : 'guess'
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
  // Bank lines a person has split into several: the feed must not write the
  // full amount back over the first part, or the charge is counted twice.
  const guarded = await splitExtIds().catch(() => new Set());
  let added = 0, updated = 0, removed = 0;
  const errors = [];

  for (const item of list) {
    let pages = 0;
    // Rows imported before the payee / memo / account fields were kept have none
    // of them. Starting this bank's cursor over re-sends every line once (the
    // upsert fills the new fields in and leaves categories a person set alone).
    // While that re-send runs, lines we already hold only get their details filled in. A
    // line somebody deleted must not come back, and nothing a person decided is touched.
    const refill = item.detailsV !== DETAILS_V;
    if (refill) item.cursor = null;
    const accounts = new Map();
    try {
      for (;;) {
        const r = await plaid('/transactions/sync', {
          access_token: item.accessToken,
          cursor: item.cursor || undefined,
          count: 500,
          options: { include_original_description: true, include_personal_finance_category: true }
        });
        for (const a of (r.accounts || [])) {
          accounts.set(a.account_id, `${a.official_name || a.name || 'Account'}${a.mask ? ` ····${a.mask}` : ''}`);
        }
        opts.accounts = accounts;
        for (const t of (r.added || [])) {
          if (guarded.has(`plaid:${t.transaction_id}`)) continue;
          const m = mapTransaction(t, item.institution, opts);
          if (m && refill) { if (await fillExpenseDetails(m)) updated++; }
          else if (m) { await upsertExpense(m); added++; await deleteActivity(m.extId).catch(() => {}); }
          else if (!start || String(t.date || '') >= start) {
            // Everything that is not an expense still belongs on the live list (pending, money in, transfers).
            // (A line a person already turned into an expense stays only that.)
            try { if (!(await hasExpense(`plaid:${t.transaction_id}`))) await recordActivity(mapActivity(t, accounts)); } catch (e) { console.error('activity capture failed', e?.message || e); }
            // Money IN is not an expense, but an incoming e-transfer is what pays an order: keep it so it can be
            // matched (lib/deposit-match). Best-effort: it must never stop the expense sync.
            try { const d = mapDeposit(t); if (d) await recordDeposit(d); } catch (e) { console.error('deposit capture failed', e?.message || e); }
          }
        }
        for (const t of (r.modified || [])) {
          const m = mapTransaction(t, item.institution, opts);
          // A row that became skippable (recategorized as a transfer) is taken
          // back out rather than left behind as a phantom cost.
          if (m && guarded.has(m.extId)) continue; // split by hand: keep the split
          if (m) { await upsertExpense(m); updated++; await deleteActivity(m.extId).catch(() => {}); }
          else if (await isDecidedExpense(`plaid:${t.transaction_id}`).catch(() => false)) {
            // A person turned this transfer into an expense, or sorted it: the bank re-sending it changes nothing.
          } else {
            await deleteExpenseByExtId(`plaid:${t.transaction_id}`); removed++;
            if (!start || String(t.date || '') >= start) { try { await recordActivity(mapActivity(t, accounts)); } catch { /* best effort */ } }
          }
        }
        for (const t of (r.removed || [])) {
          await deleteExpenseByExtId(`plaid:${t.transaction_id}`);
          await deleteActivity(`plaid:${t.transaction_id}`).catch(() => {});
          removed++;
        }
        item.cursor = r.next_cursor;
        item.lastSync = new Date().toISOString();
        item.needsReauth = false;
        if (!r.has_more) item.detailsV = DETAILS_V; // the re-pull has finished
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

// Current balance of every linked account. /accounts/get returns the balance
// Plaid last saw (refreshed with each transactions update, several times a day)
// and carries no per-call charge, unlike /accounts/balance/get, which asks the
// bank live and is billed. `asOf` says how fresh each figure is.
export async function plaidBalances() {
  if (!plaidConfigured()) return { accounts: [], errors: [] };
  const list = await items();
  const accounts = [];
  const errors = [];
  for (const item of list) {
    try {
      const r = await plaid('/accounts/get', { access_token: item.accessToken });
      for (const a of (r.accounts || [])) {
        const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
        accounts.push({
          itemId: item.itemId,
          institution: item.institution || 'Bank',
          accountId: a.account_id,
          name: a.official_name || a.name || 'Account',
          mask: a.mask || '',
          type: a.type || '',
          subtype: a.subtype || '',
          current: num(a.balances?.current),
          available: num(a.balances?.available),
          currency: a.balances?.iso_currency_code || 'CAD',
          asOf: a.balances?.last_updated_datetime || null
        });
      }
    } catch (e) {
      errors.push(`${item.institution || 'Bank'}: ${e?.message || 'could not read balances'}`);
    }
  }
  return { accounts, errors };
}

// ---- asking the bank NOW ---------------------------------------------------
// Plaid keeps its own copy of the bank's data and only re-reads the bank every so often (TD: about
// once a day). Calling /transactions/sync just hands back that copy, which is why "Pull now" used to
// say "already up to date" while the account was $3,900 out. Two things actually go to the bank:
//   /transactions/refresh  asks Plaid to re-read the bank's transactions (new lines then arrive by
//                          webhook, and on the next sync);
//   /accounts/balance/get  asks the bank for the balance this minute (billed per call).
// Both are best-effort and each failure is reported in words, never swallowed.
export async function refreshFromBank() {
  const list = await items();
  const notes = [];
  for (const item of list) {
    try { await plaid('/transactions/refresh', { access_token: item.accessToken }); }
    catch (e) { notes.push(`${item.institution || 'Bank'} refresh: ${e?.message || 'refused'}`); }
  }
  return notes;
}

export async function liveBalances() {
  if (!plaidConfigured()) return { accounts: [], errors: [], at: null };
  const list = await items();
  const accounts = [];
  const errors = [];
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  for (const item of list) {
    try {
      const r = await plaid('/accounts/balance/get', { access_token: item.accessToken });
      for (const a of (r.accounts || [])) {
        accounts.push({
          itemId: item.itemId, institution: item.institution || 'Bank', accountId: a.account_id,
          name: a.official_name || a.name || 'Account', mask: a.mask || '', type: a.type || '', subtype: a.subtype || '',
          current: num(a.balances?.current), available: num(a.balances?.available),
          currency: a.balances?.iso_currency_code || 'CAD', asOf: a.balances?.last_updated_datetime || null
        });
      }
    } catch (e) {
      errors.push(`${item.institution || 'Bank'}: ${e?.message || 'could not read the live balance'}`);
    }
  }
  const at = accounts.length ? new Date().toISOString() : null;
  // Kept so the Bankroll page can show the last figure the bank gave us, and when.
  if (at) await setSetting('bank_balance_snapshot', { at, accounts }).catch(() => {});
  return { accounts, errors, at };
}

export async function lastBalanceSnapshot() {
  const v = await getSetting('bank_balance_snapshot', null).catch(() => null);
  return v && v.at && Array.isArray(v.accounts) ? v : null;
}

// Does this webhook belong to a bank we actually linked? The payload is never
// trusted for DATA — it only ever triggers a pull with our own credentials — so
// this is about not letting anyone make us sync on demand.
export async function knownItem(itemId) {
  if (!itemId) return false;
  return (await items()).some((i) => i.itemId === itemId);
}
