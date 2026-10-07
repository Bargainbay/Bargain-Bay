// lib/bookings.js — public requests to book a service call or price a move.
//
// A request is a QUESTION for the dispatch desk, not work on the board: it can
// be submitted by anyone, so it lands in its own queue and a person turns it
// into a service ticket (or a quote) on purpose. See migration 0014.
import { query, hasDb } from './db';
import { torontoToday, phoneKey } from './constants';
import { openTicket } from './jobs';

export const BOOKING_KINDS = { service: 'Service call', move: 'Moving quote' };
export const BOOKING_STATUSES = { new: 'New', contacted: 'Contacted', converted: 'Booked / quoted', closed: 'Closed' };

export const SERVICE_APPLIANCES = [
  'Refrigerator', 'Freezer', 'Washer', 'Dryer', 'Dishwasher',
  'Range / Stove', 'Wall oven', 'Cooktop', 'Microwave', 'Range hood', 'Other'
];
export const TIME_WINDOWS = { any: 'Any time', morning: 'Morning (8–12)', afternoon: 'Afternoon (12–5)', evening: 'Evening (5–8)' };
export const MOVE_SIZES = ['Studio / 1 room', '1 bedroom', '2 bedrooms', '3 bedrooms', '4+ bedrooms', 'Just a few items'];
export const ACCESS_OPTIONS = { ground: 'Ground floor / no stairs', stairs: 'Stairs', elevator: 'Elevator' };

export const MAX_PER_IP_HOUR = Number(process.env.BOOKING_MAX_PER_IP || 5);
export const MAX_PER_EMAIL_HOUR = Number(process.env.BOOKING_MAX_PER_EMAIL || 3);

const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const cleanBlock = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const oneOf = (v, list) => (list.includes(v) ? v : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Pure, so it can be tested without a database. Returns the row to store or a
// message for the person at the form. Every field is whitelisted: `details` is
// built here from named keys, never copied from the request body.
export function validateBooking(body = {}, today = torontoToday()) {
  const kind = body.kind === 'move' ? 'move' : body.kind === 'service' ? 'service' : '';
  if (!kind) return { ok: false, error: 'Choose what you would like to book.' };

  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 40);
  if (name.length < 2) return { ok: false, error: 'Please enter your name.' };
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter a valid email so we can confirm with you.' };
  if (!phoneKey(phone)) return { ok: false, error: 'Enter a phone number we can reach you on.' };

  const date = clean(body.preferredDate, 10);
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z'))) {
      return { ok: false, error: 'That date does not look right.' };
    }
    if (date < today) return { ok: false, error: 'Pick a date that is today or later.' };
  }
  const window = oneOf(clean(body.preferredWindow, 20), Object.keys(TIME_WINDOWS)) || 'any';
  const note = cleanBlock(body.note, 2000);

  if (kind === 'service') {
    const address = clean(body.address, 300);
    const city = clean(body.city, 120);
    if (!address || !city) return { ok: false, error: 'We need the address where the appliance is.' };
    const issue = cleanBlock(body.issue, 2000);
    if (issue.length < 5) return { ok: false, error: 'Tell us briefly what is wrong with it.' };
    const appliance = oneOf(clean(body.appliance, 60), SERVICE_APPLIANCES);
    if (!appliance) return { ok: false, error: 'Choose the type of appliance.' };
    return {
      ok: true,
      value: {
        kind, name, email, phone, address, city, postal: clean(body.postal, 20).toUpperCase(),
        preferred_date: date || null, preferred_window: window, note,
        details: {
          appliance, brand: clean(body.brand, 80), model: clean(body.model, 80),
          issue, urgent: body.urgent === true
        }
      }
    };
  }

  const fromAddress = clean(body.fromAddress || body.address, 300);
  const toAddress = clean(body.toAddress, 300);
  if (!fromAddress || !toAddress) return { ok: false, error: 'We need both the pick-up and the drop-off address.' };
  const size = oneOf(clean(body.size, 40), MOVE_SIZES);
  if (!size) return { ok: false, error: 'Choose roughly how much is moving.' };
  return {
    ok: true,
    value: {
      kind, name, email, phone, address: fromAddress, city: clean(body.fromCity, 120),
      postal: clean(body.fromPostal, 20).toUpperCase(),
      preferred_date: date || null, preferred_window: window, note,
      details: {
        size, toAddress, toCity: clean(body.toCity, 120), toPostal: clean(body.toPostal, 20).toUpperCase(),
        fromAccess: oneOf(clean(body.fromAccess, 20), Object.keys(ACCESS_OPTIONS)) || 'ground',
        toAccess: oneOf(clean(body.toAccess, 20), Object.keys(ACCESS_OPTIONS)) || 'ground',
        bulky: cleanBlock(body.bulky, 500), packing: body.packing === true,
        flexibleDate: body.flexibleDate === true
      }
    }
  };
}

// How many have come from this IP / email in the last hour. Counted in
// Postgres, not memory: serverless gives each instance its own memory.
// Degrades open — losing a real customer is worse than admitting a junk request,
// and a person reads every one of these before anything happens.
export async function checkBookingRate({ ip, email }) {
  if (!hasDb()) return { ok: true };
  try {
    if (ip && ip !== 'unknown') {
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM booking_requests WHERE ip = $1 AND created_at > now() - interval '1 hour'`, [ip]);
      if (rows[0].n >= MAX_PER_IP_HOUR) return { ok: false };
    }
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM booking_requests WHERE lower(email) = $1 AND created_at > now() - interval '1 hour'`,
      [String(email || '').toLowerCase()]);
    return rows[0].n >= MAX_PER_EMAIL_HOUR ? { ok: false } : { ok: true };
  } catch (e) {
    console.error('booking rate check failed (allowing):', e.message);
    return { ok: true };
  }
}

export async function createBooking(value, { ip = null, userAgent = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query(
    `INSERT INTO booking_requests
       (kind, name, email, phone, address, city, postal, preferred_date, preferred_window,
        note, details, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING id`,
    [value.kind, value.name, value.email, value.phone, value.address, value.city, value.postal,
     value.preferred_date, value.preferred_window, value.note, JSON.stringify(value.details), ip, userAgent]
  );
  const { rows: out } = await query(
    `UPDATE booking_requests SET ref = 'BK-' || (1000 + id) WHERE id = $1
     RETURNING *, to_char(preferred_date, 'YYYY-MM-DD') AS preferred_day`, [rows[0].id]);
  return out[0];
}

export async function listBookings({ status = 'open', limit = 200 } = {}) {
  if (!hasDb()) return { bookings: [], counts: {} };
  const where = status === 'open' ? `status IN ('new','contacted')` : BOOKING_STATUSES[status] ? 'status = $2' : 'TRUE';
  const params = [Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500)];
  if (where.includes('$2')) params.push(status);
  const { rows } = await query(
    `SELECT b.*, to_char(b.preferred_date, 'YYYY-MM-DD') AS preferred_day, t.ticket_number
       FROM booking_requests b LEFT JOIN service_tickets t ON t.id = b.ticket_id
      WHERE ${where.replace(/\bstatus\b/g, 'b.status')}
      ORDER BY (b.status = 'new') DESC, b.created_at DESC LIMIT $1`, params);
  const { rows: c } = await query('SELECT status, count(*)::int AS n FROM booking_requests GROUP BY status');
  return { bookings: rows, counts: Object.fromEntries(c.map((r) => [r.status, r.n])) };
}

export async function setBookingStatus(id, status, by) {
  if (!BOOKING_STATUSES[status]) throw new Error('Unknown status.');
  const { rows } = await query(
    `UPDATE booking_requests SET status = $2, handled_by = COALESCE($3, handled_by), updated_at = now()
      WHERE id = $1 RETURNING id`, [Number(id), status, by || null]);
  if (!rows[0]) throw new Error('Request not found.');
  return true;
}

// The one place a service request becomes work. Opens the ticket that the rest
// of dispatch already understands (the visit is scheduled from the service
// queue), and remembers which request it came from. Refused when one already
// exists, so a double click cannot open two tickets for one fault.
export async function convertToTicket(id, by) {
  const { rows } = await query('SELECT * FROM booking_requests WHERE id = $1', [Number(id)]);
  const b = rows[0];
  if (!b) throw new Error('Request not found.');
  if (b.kind !== 'service') throw new Error('Only service calls become tickets. Price a move from its details.');
  if (b.ticket_id) throw new Error('A service call was already opened for this request.');
  const d = b.details || {};
  const appliance = [d.appliance, d.brand, d.model].filter(Boolean).join(' · ');
  const when = b.preferred_date ? `Customer would like ${String(b.preferred_date).slice(0, 10)}, ${b.preferred_window || 'any time'}.` : '';
  const ticket = await openTicket({
    customerName: b.name, phone: b.phone, email: b.email,
    address: b.address, city: b.city, postal: b.postal,
    appliance, issue: [d.issue, when, b.note, `From online request ${b.ref}.`].filter(Boolean).join('\n'),
    priority: d.urgent ? 'urgent' : 'normal', createdBy: by
  });
  // Claim the row only if nobody beat us to it; losing the race leaves a stray
  // ticket, which is visible and closeable, rather than a lost request.
  const { rows: claimed } = await query(
    `UPDATE booking_requests SET ticket_id = $2, status = 'converted', handled_by = $3, updated_at = now()
      WHERE id = $1 AND ticket_id IS NULL RETURNING id`, [Number(id), ticket.id, by?.email || null]);
  if (!claimed[0]) throw new Error('Another person opened a service call for this request at the same moment.');
  return ticket;
}
