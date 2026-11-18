// Who may see and write in which team channel. NO IMPORTS: the screen uses it too.
//
// The channels are the owner's: General (everybody), Sales, Warehouse, Delivery.
// A person's groups come from the sign-in, never from the request (see
// lib/team-board.js `memberFromSession`), and this file turns groups into rights.

export const CHANNELS = [
  { id: 'general', label: 'General', blurb: 'Everyone, both companies' },
  { id: 'sales', label: 'Sales', blurb: 'Sales team' },
  { id: 'warehouse', label: 'Warehouse', blurb: 'Repair, refurb, cleaning, parts, techs' },
  { id: 'delivery', label: 'Delivery', blurb: 'Drivers and dispatch' }
];
export const CHANNEL_IDS = CHANNELS.map((c) => c.id);

export const MAX_BODY = 4000;
export const MAX_TITLE = 120;
export const RATE_PER_MINUTE = 20;

// group -> channels it can read AND chat in
const CHAT_IN = {
  admin: ['general', 'sales', 'warehouse', 'delivery'],
  staff: ['general', 'sales', 'warehouse', 'delivery'], // sales + back office: they sell it and book its delivery
  dispatcher: ['general', 'delivery', 'warehouse'], // they coordinate with the warehouse; moderate only General + Delivery
  driver: ['general', 'delivery'],
  employee: ['general', 'warehouse'], // /clock employees: refurb, cleaners, techs
  rsops: ['general', 'warehouse']
};

// Who may put up a POST (the important-details board), and pin or remove other
// people's. General's post board is announcements, so only the office writes
// there; every other channel lets its own members post.
const MODERATORS = {
  general: ['admin', 'staff', 'dispatcher'],
  sales: ['admin', 'staff'],
  warehouse: ['admin', 'staff'],
  delivery: ['admin', 'staff', 'dispatcher']
};

/** groups: array of 'admin' | 'staff' | 'dispatcher' | 'driver' | 'employee' | 'rsops' */
export function rightsFor(groups) {
  const out = {};
  for (const ch of CHANNEL_IDS) {
    const chat = groups.some((g) => (CHAT_IN[g] || []).includes(ch));
    if (!chat) continue;
    const moderate = groups.some((g) => (MODERATORS[ch] || []).includes(g));
    out[ch] = {
      read: true,
      chat: true,
      post: ch === 'general' ? moderate : true,
      moderate
    };
  }
  return out;
}

export const channelLabel = (id) => CHANNELS.find((c) => c.id === id)?.label || id;
