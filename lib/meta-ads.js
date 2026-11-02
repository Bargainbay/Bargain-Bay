// Meta (Facebook/Instagram) Ads spend sync. Dormant until the owner sets
// META_ADS_ACCESS_TOKEN + META_AD_ACCOUNT_ID. Pulls daily campaign spend from
// the Marketing API and upserts it into the ad_spend ledger (source='meta').
import { upsertAdSpend } from './finance';
import { setSetting } from './settings';

const GRAPH = 'https://graph.facebook.com/v19.0';

// Accounts to pull. META_AD_ACCOUNTS="act_111:rs_solutions,act_222:bargain_bay"
// tags each account's spend with its business; the single-account form
// (META_AD_ACCOUNT_ID, optional META_AD_BRAND) still works.
export function metaAccounts() {
  const multi = (process.env.META_AD_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((p) => { const [id, brand] = p.split(':'); return { id: id.replace(/^act_/, ''), brand: brand || null }; });
  if (multi.length) return multi;
  if (process.env.META_AD_ACCOUNT_ID) return [{ id: process.env.META_AD_ACCOUNT_ID.replace(/^act_/, ''), brand: process.env.META_AD_BRAND || null }];
  return [];
}

export function metaConfigured() {
  return !!(process.env.META_ADS_ACCESS_TOKEN && metaAccounts().length);
}

// YYYY-MM-DD for `daysAgo` days before now (UTC date is fine for ad reporting).
function ymd(daysAgo = 0) {
  const ms = Date.now() - daysAgo * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Fetch per-campaign, per-day spend over a window.
export async function fetchMetaSpend({ since, until } = {}) {
  if (!metaConfigured()) return { configured: false, rows: [] };
  const all = [];
  for (const a of metaAccounts()) all.push(...(await fetchAccount(a, { since, until })));
  return { configured: true, rows: all };
}

async function fetchAccount({ id: acct, brand }, { since, until }) {
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'spend,impressions,clicks,campaign_id,campaign_name',
    time_increment: '1',
    time_range: JSON.stringify({ since: since || ymd(7), until: until || ymd(0) }),
    limit: '500',
    access_token: process.env.META_ADS_ACCESS_TOKEN
  });
  const res = await fetch(`${GRAPH}/act_${acct}/insights?${params}`, { cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Meta API ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const rows = (data.data || []).map((d) => ({
    date: d.date_start,
    campaign: d.campaign_name || null,
    spend: Number(d.spend || 0),
    brand,
    extId: `meta:${d.date_start}:${d.campaign_id || d.campaign_name || 'acct'}`
  }));
  return rows;
}

// Sync the last `days` of spend into ad_spend. Idempotent.
export async function syncMetaAds({ days = 8 } = {}) {
  if (!metaConfigured()) return { configured: false, synced: 0 };
  const { rows } = await fetchMetaSpend({ since: ymd(days), until: ymd(0) });
  let synced = 0;
  for (const r of rows) {
    if (!(r.spend > 0)) continue;
    await upsertAdSpend({ spentOn: r.date, channel: 'Meta', amount: r.spend, campaign: r.campaign, extId: r.extId, source: 'meta', brand: r.brand });
    synced++;
  }
  await setSetting('meta_ads_last_sync', new Date().toISOString());
  return { configured: true, synced };
}
