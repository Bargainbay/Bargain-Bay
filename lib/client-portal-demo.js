// Sample data for /client/demo — so the owner can see exactly what a client will
// see before any real link is sent. Invented names and addresses; no database.
const svg = (label, a, b) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="300" y="310" font-family="Arial" font-size="34" fill="white" text-anchor="middle">${label}</text></svg>`)}`;
const sig = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="110"><path d="M10 80 C40 10 60 110 90 50 S130 20 150 70 S200 100 230 40 S290 90 330 55 S380 60 410 30" fill="none" stroke="#1a2b6b" stroke-width="3"/></svg>')}`;

export const DEMO_CLIENT = { id: 'demo', name: 'Canadian Discount Appliances', contact_name: 'Matt' };
export const demoImage = (kind, id) => (kind === 'sig' ? sig
  : [svg('Fridge in place', '#4a6fa5', '#2c3e50'), svg('Hallway clear', '#6b8e7f', '#2f4f4f'), svg('Old unit loaded', '#a0785a', '#5b3a29')][Number(id) % 3]);

const base = {
  phone: '(519) 555-0142', pickup: null, services: [], shipmentType: 'white_glove', notes: null, chargeNote: null,
  requestedByClient: false, driverName: 'Ruban', driver2Name: 'Ardy', failReason: null, items: [], invoiceNumber: null,
  podForm: null, hasPod: false, hasSignature: false, photoIds: [], minutesOnSite: null, timeIn: null, timeOut: null,
  leftAt: null, arrivedAt: null, completedAt: null, windowStart: null, windowEnd: null, createdAt: null
};
const done = (o) => ({
  ...base, type: 'delivery', typeLabel: 'Delivery', status: 'done', statusLabel: 'Done', hasPod: true, hasSignature: true,
  podForm: { productDamageFree: 'yes', propertyDamageFree: 'yes', printName: o.customerName, explanation: '',
    items: o.items.map((i) => ({ description: i.description, serial: 'SN' + (1000 + o.id * 7), delivered: true, notes: '' })) },
  ...o
});

export const DEMO_JOBS = [
  { ...base, id: 11, jobNumber: 'RS-1011', orderNumber: '202403201', type: 'delivery', typeLabel: 'Delivery', status: 'unscheduled',
    statusLabel: 'Requested — awaiting scheduling', requestedByClient: true, customerName: 'Priya Nair', address: '41 Maple Crescent, Waterloo, N2L 3G1',
    date: null, services: ['Delivery', 'Haul away'], items: [{ description: 'LG LDFN4542S dishwasher', sku: null, qty: 1, delivered: null }], notes: 'Preferred date: 2026-11-12.' },
  { ...base, id: 10, jobNumber: 'RS-1010', orderNumber: '202403188', type: 'delivery', typeLabel: 'Delivery', status: 'scheduled', statusLabel: 'Scheduled',
    customerName: 'Daniel Okafor', address: '12 Birchwood Dr, Cambridge, N1R 5T2', date: '2026-11-05', windowStart: '09:00', windowEnd: '12:00',
    services: ['Delivery', 'Install'], items: [{ description: 'Samsung NE63T8511SS range', sku: null, qty: 1, delivered: null }] },
  { ...base, id: 9, jobNumber: 'RS-1009', orderNumber: '202403175', type: 'delivery', typeLabel: 'Delivery', status: 'on_the_way', statusLabel: 'On the way',
    customerName: 'Linda Fraser', address: '88 King St W, Kitchener, N2G 1A7', date: '2026-11-02', leftAt: '2026-11-02T14:05:00Z',
    services: ['Delivery'], items: [{ description: 'Whirlpool WRF535SWHZ refrigerator', sku: null, qty: 1, delivered: null }] },
  done({ id: 8, jobNumber: 'RS-1008', orderNumber: '202402961', customerName: 'Carol Ann Crozier', address: '5 Lakeview Ave, Guelph, N1H 4B7', date: '2026-10-26',
    leftAt: '2026-10-26T13:10:00Z', arrivedAt: '2026-10-26T13:52:00Z', timeIn: '2026-10-26T13:52:00Z', timeOut: '2026-10-26T14:31:00Z', completedAt: '2026-10-26T14:31:00Z',
    minutesOnSite: 39, services: ['Delivery'], items: [{ description: 'GE GTE18GTNRWW refrigerator', sku: null, qty: 1, delivered: true }], photoIds: [0, 1], invoiceNumber: 'INV-DEMO' }),
  done({ id: 7, jobNumber: 'RS-1007', orderNumber: '2023122720', customerName: 'Nathan Joseph', address: '230 Queen St S, Kitchener, N2G 1W1', date: '2026-10-26',
    leftAt: '2026-10-26T15:00:00Z', arrivedAt: '2026-10-26T15:20:00Z', timeIn: '2026-10-26T15:20:00Z', timeOut: '2026-10-26T16:22:00Z', completedAt: '2026-10-26T16:22:00Z',
    minutesOnSite: 62, services: ['Delivery', 'Haul away', 'Door removal / replace'], items: [{ description: 'Frigidaire FFSS2615TS refrigerator', sku: null, qty: 1, delivered: true }], photoIds: [0, 1, 2], invoiceNumber: 'INV-DEMO' }),
  { ...base, id: 6, jobNumber: 'RS-1006', orderNumber: '168219', type: 'delivery', typeLabel: 'Delivery', status: 'failed', statusLabel: "Couldn't complete", failReason: 'Nobody home',
    customerName: 'Bill Meadus', address: '19 Cedar Ct, Elmira, N3B 2K1', date: '2026-10-22', arrivedAt: '2026-10-22T17:10:00Z', timeIn: '2026-10-22T17:10:00Z',
    timeOut: '2026-10-22T17:25:00Z', completedAt: '2026-10-22T17:25:00Z', minutesOnSite: 15, services: ['Delivery'], items: [{ description: 'Maytag MVW6230HW washer', sku: null, qty: 1, delivered: false }], photoIds: [2] }
];
