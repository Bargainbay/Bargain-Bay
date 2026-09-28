// The five owner-portal analytics dashboards (dark themed). Shared by the
// DashboardShell (nav) and SiteChrome (which routes these full-bleed + dark).
//
// `built: false` renders a greyed-out "SOON" tag beside the tab. ALL FIVE WERE
// BUILT AND FOUR WERE STILL FLAGGED FALSE (found 2026-09-28): fulfilment,
// customers, financial and marketing each have a real page calling a real
// function in lib/analytics.js, and each one sat behind a tag telling everybody
// not to bother clicking it. The flag is kept for the NEXT dashboard rather
// than deleted — but a page that renders real data must never carry it.
export const DASHBOARD_TABS = [
  { key: 'sales',      label: 'Sales',      href: '/admin/dashboard',  built: true,  blurb: 'Revenue, deals & what’s selling' },
  { key: 'fulfilment', label: 'Fulfilment', href: '/admin/fulfilment', built: true,  blurb: 'Deliveries, pickups & on-time rate' },
  { key: 'customers',  label: 'Customers',  href: '/admin/customers',  built: true,  blurb: 'Retention, segments & geography' },
  { key: 'financial',  label: 'Financial',  href: '/admin/financial',  built: true,  blurb: 'Margin, AR aging & cash health' },
  { key: 'marketing',  label: 'Marketing',  href: '/admin/marketing',  built: true,  blurb: 'Leads, campaigns & ad ROI' }
];

export const DASHBOARD_ROUTES = DASHBOARD_TABS.map((t) => t.href);
