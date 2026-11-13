// The owner's backend for every partner organisation: one place that answers "how is each partner doing, what do we owe them,
// and is anything wrong". Read-only; everything is recomputed from the records on each read, nothing is stored here.
//
// It reads the SAME sources the partners' own pages read (partnerReport for money, orgOverview for leads), so this page and
// a partner's page can never disagree. Cost and profit per order are not returned: totals only.
import { hasDb, query } from './db';
import { listPartners, partnerReport } from './referral-partners';
import { orgOverview } from './partner-leads';
import { round2 } from './constants';

const DAY = 86400000;

export async function partnerPortfolio() {
  if (!hasDb()) return { orgs: [], totals: null, changes: [] };
  const partners = (await listPartners()).filter((p) => !p.revoked_at);
  const orgs = [];
  for (const p of partners) {
    const r = await partnerReport(p.email);
    let ov = { generators: [], duplicates: [] };
    try { ov = await orgOverview({ org: p.email, role: 'admin' }); } catch { /* leads tables not provisioned yet: shown as zero */ }
    const team = r.team || [];
    const gens = team.filter((m) => m.role === 'affiliate');
    const sum = (k) => ov.generators.reduce((a, g) => a + (g[k] || 0), 0);
    const leads = { sent: sum('sent'), withTeam: sum('withTeam'), called: sum('called'), sold: sum('sold'), completed: sum('completed'), notCounted: sum('notCounted'), unreachable: sum('unreachable'), dups: sum('dups') };
    const lastLead = ov.generators.reduce((a, g) => (g.last && (!a || g.last > a) ? g.last : a), null);
    const t = r.totals;
    const flags = [];
    if (t.balance > 0.005) flags.push({ level: 'money', text: `We owe this partner $${t.balance.toFixed(2)}` });
    const lateListings = ov.generators.reduce((a, g) => a + (g.posting?.late || 0), 0);
    if (lateListings > 0) flags.push({ level: 'warn', text: `${lateListings} sold listing${lateListings === 1 ? ' has' : 's have'} been up for over a day` });
    if (t.missingCost > 0) flags.push({ level: 'warn', text: `${t.missingCost} unit${t.missingCost === 1 ? '' : 's'} sold have no cost yet, so commission may be low` });
    if (gens.length && (!lastLead || Date.now() - new Date(lastLead).getTime() > 14 * DAY)) flags.push({ level: 'warn', text: 'No leads sent in the last 14 days' });
    const idle = ov.generators.filter((g) => g.sent === 0 && team.find((m) => m.email === g.email && m.added_at && Date.now() - new Date(m.added_at).getTime() > 7 * DAY));
    if (idle.length) flags.push({ level: 'info', text: `${idle.length} generator${idle.length === 1 ? ' has' : 's have'} not sent a lead in over a week` });
    if (leads.sent >= 5 && (leads.notCounted + leads.unreachable) / leads.sent > 0.3) flags.push({ level: 'warn', text: `Quality: ${Math.round(100 * (leads.notCounted + leads.unreachable) / leads.sent)}% of leads were junk or unreachable` });
    orgs.push({
      email: p.email, name: p.name || p.email, since: p.granted_at, pct: p.pct, leadPct: p.lead_pct, customerPct: p.customer_pct, generatorsOn: p.generators,
      admins: team.filter((m) => m.role !== 'affiliate').length, generators: gens.length, clients: r.clients.length, visits: r.visits?.total || 0,
      orders: t.orders, sales: t.sales, commission: t.commission, earned: t.earned, pending: t.pending, paid: t.paid, balance: t.balance,
      leads, lastLead, flags, generatorRows: ov.generators, duplicates: ov.duplicates.slice(0, 10)
    });
  }
  const T = (k) => round2(orgs.reduce((a, o) => a + (o[k] || 0), 0));
  const totals = {
    orgs: orgs.length, generators: orgs.reduce((a, o) => a + o.generators, 0), clients: orgs.reduce((a, o) => a + o.clients, 0), orders: orgs.reduce((a, o) => a + o.orders, 0),
    sales: T('sales'), earned: T('earned'), pending: T('pending'), paid: T('paid'), balance: T('balance'),
    leads: orgs.reduce((a, o) => a + o.leads.sent, 0), leadsSold: orgs.reduce((a, o) => a + o.leads.sold, 0)
  };
  let changes = [];
  try {
    changes = (await query(`SELECT at, actor, action, summary FROM audit_log WHERE action LIKE 'partner.%' ORDER BY id DESC LIMIT 40`)).rows;
  } catch { /* no audit table */ }
  return { orgs, totals, changes };
}
