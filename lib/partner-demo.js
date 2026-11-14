// Invented data for /partner/demo: what a partner's dashboard looks like, with no database, no login and no real names.
// Same idea as lib/client-portal-demo.js. Nothing here is a real person, order or figure.
const d = (n) => new Date(Date.now() - n * 86400000).toISOString();
const lead = (id, name, status, statusLabel, wants, sender, sent, changed, extra = {}) => ({
  id, name, phone: `(416) 555-01${String(id).padStart(2, '0')}`, email: '', status, statusLabel, wants, sender, submittedAt: d(sent), changedAt: d(changed), ...extra
});

export const DEMO_ALJO_LEADS = [
  lead(1, 'Maria Gomez', 'sent', 'Sent', 'Fridge, stainless', 'Anna Lopez', 0, 0),
  lead(2, 'Tom Wilcox', 'sent', 'Sent', 'Washer and dryer', 'Ben Ray', 0, 0),
  lead(3, 'Priya Nair', 'with_team', 'With our team', 'Gas range', 'Anna Lopez', 1, 1),
  lead(4, 'Luis Moreno', 'called', 'Called', 'Dishwasher', 'Ben Ray', 2, 1),
  lead(5, 'Jen Kowal', 'talking', 'In conversation', 'Fridge', 'Anna Lopez', 3, 1),
  lead(6, 'Omar Siddiqui', 'sold', 'Sold', 'Washer', 'Anna Lopez', 6, 2, { success: true }),
  lead(7, 'Alicia Brown', 'completed', 'Completed', 'Stove', 'Ben Ray', 9, 3, { success: true }),
  lead(8, 'Sam Tran', 'not_counted', 'Already entered by someone else', 'Fridge', 'Carla Singh', 4, 4)
];
export const DEMO_GEN_LEADS = DEMO_ALJO_LEADS.filter((l) => l.sender === 'Anna Lopez');

export const DEMO_ORGS = {
  aljo: {
    name: 'Aljo Systems', code: 'aljo', customerCode: 'ALJO5', customerPct: 5, basis: 'spread',
    note: 'Everything a customer pays above our member price of the unit is yours (the customer\'s 5% code discount comes out of it). When we sell at member price there is nothing above it, so you earn 10% of the profit on that unit instead. ',
    stats: { clients: 3, orders: 3, sales: 3299, earned: 276, pending: 250, paid: 0 },
    visits: { total: 48, recent: 31, signedUp: 6, applied: 1, approved: 1 },
    clients: [
      { name: 'Omar Siddiqui', contact: 'omar@example.com · (416) 555-0106', via: 'via Anna Lopez', orders: [
        { number: 'BB-4101', date: 'Nov 8, 2026', items: 'Whirlpool front-load washer', how: 'with a code', total: 899, discount: 45, profit: 355, rate: 'Over member price', status: 'Delivered', commission: 256, earned: true }] },
      { name: 'Alicia Brown', contact: 'alicia@example.com', via: 'via Ben Ray', orders: [
        { number: 'BB-4087', date: 'Nov 5, 2026', items: 'GE electric range', how: 'from a lead', total: 750, discount: 0, profit: 200, rate: 'Member price: profit share', status: 'Delivered', commission: 20, earned: true },
        { number: 'BB-4120', date: 'Nov 12, 2026', items: 'LG fridge 28 cu ft', how: 'with a code', total: 1650, discount: 82.5, profit: 650, rate: 'Over member price', status: 'Confirmed', commission: 250, earned: false }] },
      { name: 'Chris Dube', contact: 'No contact details on file', via: 'via Carla Singh', orders: [] }
    ]
  },
  secondshop: {
    name: 'SecondShop', code: 'secondshop', customerCode: 'SECONDSHOP5', customerPct: 5, basis: 'profit', pct: 20, retailPct: 15,
    stats: { clients: 2, orders: 2, sales: 693.24, earned: 92.7, pending: 0, paid: 0 },
    visits: { total: 12, recent: 7, signedUp: 2, applied: 1, approved: 1 },
    clients: [
      { name: 'Roger D.', contact: 'roger@example.com · (905) 555-0142', via: '', orders: [
        { number: 'BB-3990', date: 'Nov 10, 2026', items: 'Frigidaire dishwasher', how: 'reseller', total: 389, discount: 0, profit: 214, rate: '20% of profit', status: 'Delivered', commission: 42.8, earned: true }] },
      { name: 'Tonic Appliances', contact: 'orders@example.com', via: '', orders: [
        { number: 'BB-4012', date: 'Nov 11, 2026', items: 'Samsung microwave', how: 'with a code', total: 304.24, discount: 15.21, profit: 166, rate: '15% of profit', status: 'Delivered', commission: 49.9, earned: true }] }
    ]
  }
};

export const DEMO_UNITS = [
  { sku: 'LG-28F', title: 'LG 28 cu ft French-door fridge', cond: 'Open box', price: 1650, tag: 'NEW' },
  { sku: 'WP-FL', title: 'Whirlpool front-load washer', cond: 'Scratch & dent', price: 899, tag: '' },
  { sku: 'SS-RNG', title: 'Samsung gas range', cond: 'Refurbished', price: 1150, tag: 'SOLD' }
];

// The owner's admin pages, from invented data (/partner/demo/admin).
export const DEMO_ADMIN = {
  partners: [
    { name: 'Aljo Systems', email: 'info@aljosystems.com', pay: 'the spread over member price (10% of profit at member price)', code: 'aljo', customerCode: 'ALJO5', clients: 3, status: 'active' },
    { name: 'SecondShop', email: 'partner@secondshop.example', pay: '20% of profit', code: 'secondshop', customerCode: 'SECONDSHOP5', clients: 2, status: 'active', sales: 693.24, earned: 92.7, paid: 0 }
  ],
  portfolioTotals: { orgs: 2, generators: 4, leads: 8, sold: 2, sales: 3992.24, earned: 368.7 },
  generators: [
    { name: 'Anna Lopez', code: 'ALJO-ANNA', sent: 4, team: 1, called: 1, sold: 1, dups: 0, posting: '6 up, 2 to take down', last: '2 hours ago' },
    { name: 'Ben Ray', code: 'ALJO-BEN', sent: 3, team: 1, called: 1, sold: 1, dups: 0, posting: '4 up', last: 'yesterday' },
    { name: 'Carla Singh', code: 'ALJO-CARLA', sent: 1, team: 0, called: 0, sold: 0, dups: 2, posting: '1 up, 1 late', last: '3 days ago' },
    { name: 'Dev Patel', code: 'ALJO-DEV', sent: 0, team: 0, called: 0, sold: 0, dups: 0, posting: 'none', last: 'never' }
  ],
  changes: [
    ['Today 21:09', 'owner', 'link code aljo2 changed to aljo'],
    ['Today 20:34', 'owner', 'sign-in invite for info@aljosystems.com (emailed)'],
    ['Today 20:34', 'owner', 'partner added: Aljo Systems']
  ],
  queue: [
    { name: 'Maria Gomez', contact: '(416) 555-0101', wants: 'Fridge, stainless', how: 'Facebook message', sender: 'Anna Lopez, Aljo', waiting: '2 h 10 m', late: true },
    { name: 'Tom Wilcox', contact: 'tom@example.com', wants: 'Washer and dryer', how: 'Text', sender: 'Ben Ray, Aljo', waiting: '14 m', late: false }
  ]
};
