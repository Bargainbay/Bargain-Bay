// Tell RS Ops what an invoice bought, the moment it lands in the master tracker.
//
// The TRACKER owns unit identity — RS Ops processes lots for more than one client,
// and two systems minting their own ids is how you end up with unit photos that
// match no product (which is exactly where this was: 0 of 99 RS Ops units matched
// a live SKU). So the SKUs assigned here travel to RS Ops unchanged and become
// its unit ids.
//
// Pre-seeding the lot is also what makes a short delivery visible on day one:
// RS Ops lists every unit the invoice paid for, and anything never checked in is
// missing while the vendor still remembers the shipment.
const BASE = process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca';

export function rsopsPushConfigured() {
  return Boolean(process.env.RSOPS_INTAKE_KEY);
}

// Never throws. Getting stock onto the books is the job; a downstream app being
// unreachable must not fail the intake, exactly like the tax record.
export async function pushManifestToRsOps({ lot, vendor, invoice, clientId, units }) {
  if (!rsopsPushConfigured()) return { ok: false, skipped: 'no RSOPS_INTAKE_KEY' };
  const list = (Array.isArray(units) ? units : []).filter(u => u && u.sku);
  if (!lot || !list.length) return { ok: false, skipped: 'nothing to send' };
  try {
    const res = await fetch(`${BASE}/api/intake/manifest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rsops-key': process.env.RSOPS_INTAKE_KEY },
      body: JSON.stringify({
        lot, vendor: vendor || '', invoice: invoice || '', clientId: clientId || null,
        units: list.map(u => ({
          sku: u.sku, category: u.category || '', make: u.make || '',
          model: u.model || '', description: u.description || '', serial: u.serial || ''
        }))
      }),
      // A slow refurb app must not hold the invoice commit open.
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('rsops manifest push rejected:', res.status, body?.error || '');
      return { ok: false, status: res.status, error: body?.error || `HTTP ${res.status}` };
    }
    return { ok: true, ...body };
  } catch (e) {
    console.error('rsops manifest push failed:', e?.message || e);
    return { ok: false, error: e?.message || 'unreachable' };
  }
}
