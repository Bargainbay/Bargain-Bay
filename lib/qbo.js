// QuickBooks Online integration — automatic expense tracking. The owner connects
// his bank + credit cards to QBO once (Banking → Link account); QBO's bank feed
// captures and categorizes every transaction; we pull the money-out side
// (Purchases + Bills) nightly into the app's expense ledger. Result: expenses,
// net profit, and the Monday finance brief stay current with ZERO manual entry.
//
// Dormant until the owner creates an Intuit app and sets QBO_CLIENT_ID +
// QBO_CLIENT_SECRET in Vercel (QBO_ENV=sandbox for testing; production default).
// One-time browser step after that: /admin/financial → "Connect QuickBooks".
//
// Token model (Intuit OAuth2): access tokens live ~1h; refresh tokens ROTATE on
// every refresh and the old one dies — so the rotated refresh token is persisted
// (settings key 'qbo_tokens') immediately, before the new access token is used.
import { getSetting, setSetting } from './settings';
import { upsertExpense } from './finance';
import { SITE_URL } from './site';

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR = 'minorversion=75';
const apiHost = () => (process.env.QBO_ENV === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com');

export function qboConfigured() {
  return !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
}
export function qboRedirectUri() {
  return `${SITE_URL}/api/admin/qbo/callback`;
}
export function qboAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: qboRedirectUri(),
    state
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(params) {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams(params)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QuickBooks token error ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function saveTokens(data, realmId) {
  const prev = (await getSetting('qbo_tokens', null)) || {};
  await setSetting('qbo_tokens', {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId: realmId || prev.realmId,
    // Refresh 5 min early; refresh tokens themselves last ~100 days of disuse.
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 5 * 60 * 1000
  });
}

// Exchange the OAuth callback code. Also fetches + stores the company name so
// the dashboard can show which books we're connected to.
export async function qboExchangeCode(code, realmId) {
  const data = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: qboRedirectUri() });
  await saveTokens(data, realmId);
  try {
    const info = await qboGet(`/v3/company/${realmId}/companyinfo/${realmId}?${MINOR}`);
    const name = info?.CompanyInfo?.CompanyName;
    if (name) await setSetting('qbo_company', name);
  } catch { /* cosmetic only */ }
  return true;
}

// A valid access token, refreshing (and persisting the rotated refresh token)
// when expired. Throws when not connected — callers surface "connect first".
async function accessToken() {
  const t = await getSetting('qbo_tokens', null);
  if (!t?.refreshToken) throw new Error('QuickBooks is not connected yet.');
  if (t.accessToken && Date.now() < Number(t.expiresAt || 0)) return { token: t.accessToken, realmId: t.realmId };
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken });
  await saveTokens(data, t.realmId);
  return { token: data.access_token, realmId: t.realmId };
}

async function qboGet(path) {
  const { token } = await accessToken();
  const res = await fetch(`${apiHost()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`QuickBooks API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function qboQuery(sql) {
  const { realmId } = await accessToken();
  return qboGet(`/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&${MINOR}`);
}

export async function qboStatus() {
  const t = await getSetting('qbo_tokens', null).catch(() => null);
  return {
    configured: qboConfigured(),
    connected: !!t?.refreshToken,
    company: await getSetting('qbo_company', null).catch(() => null),
    lastSync: await getSetting('qbo_last_sync', null).catch(() => null)
  };
}

// Disconnect (drop stored tokens). The Intuit-side grant can also be revoked
// from the owner's Intuit account page.
export async function qboDisconnect() {
  await setSetting('qbo_tokens', null);
  await setSetting('qbo_company', null);
  return true;
}

const ymd = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

// Accounts that must NOT land in the operating-expense ledger:
//  - inventory / COGS: unit purchases are already costed per-unit via the master
//    tracker and counted as COGS when the unit sells — importing them here would
//    double-count every appliance bought
//  - tax payable / loan / owner draws / transfers: money out, but not an
//    operating expense
const EXCLUDE_ACCOUNT = /cost of goods|cogs|inventory|payable|loan|owner|draw|equity|transfer|uncategori[sz]ed asset/i;

// Map one QBO money-out transaction to an expense-ledger row. Uses line-level
// amounts (pre-tax — HST paid is a recoverable input credit, not a cost) and
// keeps only real operating-expense lines; returns null when nothing qualifies.
//
// The tax is no longer discarded. It IS the input tax credit, and throwing it
// away is why a remittance figure was impossible. QBO reports it once for the
// whole transaction, so when only some of the lines survive EXCLUDE_ACCOUNT the
// credit is pro-rated onto the share that did — claiming the tax on an
// inventory line we deliberately skipped would inflate the claim.
function mapTxn(entity, t) {
  const lines = (t.Line || []).filter((l) => l.AccountBasedExpenseLineDetail || l.ItemBasedExpenseLineDetail);
  let amount = 0;
  let allLines = 0;
  let category = null;
  if (lines.length) {
    for (const l of lines) {
      const acct = l.AccountBasedExpenseLineDetail?.AccountRef?.name
        || l.ItemBasedExpenseLineDetail?.ItemRef?.name || '';
      allLines += Number(l.Amount) || 0;
      if (acct && EXCLUDE_ACCOUNT.test(acct)) continue;
      amount += Number(l.Amount) || 0;
      if (!category && acct) category = acct;
    }
  } else {
    amount = Number(t.TotalAmt) || 0;
    allLines = amount;
  }
  if (!(amount > 0)) return null;

  // Tax on the kept share. A transaction QBO reports no tax on records 0 rather
  // than null — QBO has looked, and the answer is none.
  const totalTax = Number(t.TxnTaxDetail?.TotalTax);
  const share = allLines > 0 ? Math.min(1, amount / allLines) : 1;
  const tax = Number.isFinite(totalTax) && totalTax >= 0
    ? Math.round(totalTax * share * 100) / 100
    : null;
  return {
    incurredOn: t.TxnDate,
    category: String(category || 'Other').slice(0, 80),
    vendor: t.EntityRef?.name || t.VendorRef?.name || null,
    // A Purchase with Credit=true is a refund/return — count it AGAINST expenses.
    amount: t.Credit === true ? -amount : amount,
    // A refund/return gives the credit back too.
    tax: tax == null ? null : (t.Credit === true ? -tax : tax),
    note: `QuickBooks ${entity}${t.PaymentType ? ` (${t.PaymentType})` : ''}`,
    extId: `qbo:${entity}:${t.Id}`
  };
}

// Pull the last `days` of money-out transactions from QBO into the expense
// ledger. Purchases = direct spends (cash/cheque/credit-card — what bank feeds
// create); Bills = entered payables (counted on bill date; BillPayments are NOT
// pulled, so nothing double-counts). Idempotent via expenses.ext_id, so edits
// made in QBO (recategorized txns) update here on the next sync.
export async function syncQboExpenses({ days = 35 } = {}) {
  if (!qboConfigured()) return { configured: false, synced: 0 };
  const since = ymd(days);
  let synced = 0;
  const errors = [];

  for (const entity of ['Purchase', 'Bill']) {
    let start = 1;
    for (;;) {
      const sql = `SELECT * FROM ${entity} WHERE TxnDate >= '${since}' ORDERBY TxnDate STARTPOSITION ${start} MAXRESULTS 100`;
      let page;
      try { page = await qboQuery(sql); }
      catch (e) { errors.push(`${entity}: ${e.message}`); break; }
      const rows = page?.QueryResponse?.[entity] || [];
      for (const t of rows) {
        const m = mapTxn(entity, t);
        if (!m || !m.incurredOn) continue;
        try { await upsertExpense(m); synced++; }
        catch (e) { errors.push(`${m.extId}: ${e.message}`); }
      }
      if (rows.length < 100) break;
      start += 100;
      if (start > 2000) break; // sanity cap per run; nightly runs catch the rest
    }
  }

  await setSetting('qbo_last_sync', new Date().toISOString()).catch(() => {});
  return { configured: true, synced, since, errors: errors.slice(0, 5) };
}
