// The five owner-portal analytics dashboards (dark themed). `built` flips to true
// as each phase ships; un-built tabs render a "coming next" stub. Shared by the
// DashboardShell (nav) and SiteChrome (which routes these full-bleed + dark).
export const DASHBOARD_TABS = [
  { key: 'sales',      label: 'Sales',      href: '/admin/dashboard',  built: true,  blurb: 'Revenue, deals & what’s selling' },
  { key: 'fulfilment', label: 'Fulfilment', href: '/admin/fulfilment', built: false, blurb: 'Deliveries, pickups & on-time rate' },
  { key: 'customers',  label: 'Customers',  href: '/admin/customers',  built: false, blurb: 'Retention, segments & geography' },
  { key: 'financial',  label: 'Financial',  href: '/admin/financial',  built: false, blurb: 'Margin, AR aging & cash health' },
  { key: 'marketing',  label: 'Marketing',  href: '/admin/marketing',  built: false, blurb: 'Leads, campaigns & ad ROI' }
];

export const DASHBOARD_ROUTES = DASHBOARD_TABS.map((t) => t.href);
