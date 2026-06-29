// Meta (Facebook/Instagram) Ads spend sync. Dormant until the owner sets
// META_ADS_ACCESS_TOKEN + META_AD_ACCOUNT_ID. Pulls daily campaign spend from
// the Marketing API and upserts it into the ad_spend ledger (source='meta').
import { upsertAdSpend } from './finance';
import { setSetting } from './settings';

const GRAPH = 'https://graph.facebook.com/v19.0';

export function metaConfigured() {
  return !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

// YYYY-MM-DD for `daysAgo` days before now (UTC date is fine for ad reporting).
function ymd(daysAgo = 0) {
  const ms = Date.now() - daysAgo * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Fetch per-campaign, per-day spend over a window.
export async function fetchMetaSpend({ since, until } = {}) {
  if (!metaConfigured()) return { configured: false, rows: [] };
  const acct = process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '');
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
    extId: `meta:${d.date_start}:${d.campaign_id || d.campaign_name || 'acct'}`
  }));
  return { configured: true, rows };
}

// Sync the last `days` of spend into ad_spend. Idempotent.
export async function syncMetaAds({ days = 8 } = {}) {
  if (!metaConfigured()) return { configured: false, synced: 0 };
  const { rows } = await fetchMetaSpend({ since: ymd(days), until: ymd(0) });
  let synced = 0;
  for (const r of rows) {
    if (!(r.spend > 0)) continue;
    await upsertAdSpend({ spentOn: r.date, channel: 'Meta', amount: r.spend, campaign: r.campaign, extId: r.extId, source: 'meta' });
    synced++;
  }
  await setSetting('meta_ads_last_sync', new Date().toISOString());
  return { configured: true, synced };
}
