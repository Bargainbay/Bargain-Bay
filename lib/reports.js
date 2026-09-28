// Every report this system produces, in one list.
//
// WHY THIS FILE EXISTS: the reports were all built and most of them were
// unreachable. `/admin/reports/pnl`, `/admin/reports/ledger` and
// `/admin/financial` were in the ACCOUNTANT's nav and in nobody else's, so the
// owner — whose business they describe — could only open them by typing the
// URL. Four fully-built analytics dashboards were flagged `built: false` and
// rendered greyed out with a "SOON" tag beside them.
//
// A report nobody can find is a report nobody reads, and "type this URL" is not
// something to hand a client. So the list lives here, one entry per report, and
// the hub at /admin/reports renders it.
//
// Each entry says WHAT QUESTION IT ANSWERS rather than what it is called. "P&L"
// is a name; "did we make money, and on what" is why somebody clicks.
export const REPORT_GROUPS = [
  {
    key: 'money',
    title: 'The money',
    blurb: 'What the business earned, owes and is owed.',
    reports: [
      { key: 'pnl', label: 'Profit & loss', href: '/admin/reports/pnl',
        asks: 'Did we make money this period, and where did it go?',
        note: 'Revenue → cost of goods → gross profit → expenses by category, against the period before.' },
      { key: 'ledger', label: 'General ledger', href: '/admin/reports/ledger',
        asks: 'What does the business own and owe?',
        note: 'Double-entry journal, trial balance and balance sheet — derived from the documents, never typed.' },
      { key: 'books', label: 'The books', href: '/admin/reports/books',
        asks: 'Everything an accountant asks for, downloadable.',
        note: 'Sales, payments, refunds, expenses and stock purchases for a period, each as CSV.' },
      { key: 'financial', label: 'Financial dashboard', href: '/admin/financial',
        asks: 'Margin, cash health and what is still unsorted.',
        note: 'Expenses, the HST review queue, and the bank and QuickBooks feeds.' }
    ]
  },
  {
    key: 'buying',
    title: 'Buying & suppliers',
    blurb: 'What we ordered, what it cost and who we bought it from.',
    reports: [
      { key: 'spend', label: 'Supplier spend', href: '/admin/reports/suppliers',
        asks: 'What have we spent with each supplier, month by month?',
        note: 'Pre-tax, from purchase invoices, with what is owed and when it falls due.' },
      { key: 'onorder', label: 'On order', href: '/admin/operations#on-order',
        asks: 'What have we ordered that has not arrived?',
        note: 'Outstanding purchase orders, what is late, and the three-way match against invoices.' },
      { key: 'reorder', label: 'Parts to reorder', href: '/admin/parts',
        asks: 'What is about to run out?',
        note: 'Parts at or below their level, counted on what is available rather than what is on the shelf.' }
    ]
  },
  {
    key: 'selling',
    title: 'Selling',
    blurb: 'Revenue, customers and where the leads come from.',
    reports: [
      { key: 'sales', label: 'Sales dashboard', href: '/admin/dashboard',
        asks: 'What is selling, for how much, and who closed it?',
        note: 'Revenue, deals, top sellers, per-rep and per-lead-source.' },
      { key: 'customers', label: 'Customers', href: '/admin/customers',
        asks: 'Who buys from us, and do they come back?',
        note: 'Retention, segments, geography and the full customer list.' },
      { key: 'marketing', label: 'Marketing', href: '/admin/marketing',
        asks: 'Are the ads paying for themselves?',
        note: 'Campaigns, ad spend and return on ad spend by channel.' }
    ]
  },
  {
    key: 'operations',
    title: 'Operations',
    blurb: 'Getting it out of the door, and what that costs.',
    reports: [
      { key: 'fulfilment', label: 'Fulfilment', href: '/admin/fulfilment',
        asks: 'Are deliveries going out on time?',
        note: 'Deliveries, pickups and the on-time rate.' },
      { key: 'dispatch', label: 'Dispatch profit', href: '/admin/dispatch',
        asks: 'Does the delivery side make money?',
        note: 'Revenue against driver pay and fuel, per day, week and month — on the Profit tab.' },
      { key: 'payroll', label: 'Payroll', href: '/admin/payroll',
        asks: 'What are we paying people?',
        note: 'Piece rate for shop work and per-delivery for drivers.' },
      { key: 'gaps', label: 'Stock gaps', href: '/admin/inventory-gaps',
        asks: 'Where do RS Ops, the tracker and the invoices disagree?',
        note: 'Units with no invoice, sales with no unit, and fills waiting for approval.' }
    ]
  }
];

export const ALL_REPORTS = REPORT_GROUPS.flatMap((g) => g.reports);
