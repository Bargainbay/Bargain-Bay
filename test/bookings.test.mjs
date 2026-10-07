// lib/bookings.js — public requests to book a service call or price a move.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  bookingCorsHeaders, validateBooking, createBooking, checkBookingRate, listBookings, convertToTicket, setBookingStatus
} from '../lib/bookings.js';

const TODAY = '2026-10-07';
const person = { name: 'Sam Lee', email: 'sam@example.com', phone: '416-555-0100' };
const service = {
  kind: 'service', ...person, appliance: 'Refrigerator', issue: 'Not cooling at all',
  address: '1 Main St', city: 'Pickering', urgent: true
};
const move = {
  kind: 'move', ...person, size: '2 bedrooms', address: '1 Main St', fromCity: 'Pickering',
  toAddress: '9 Elm Ave', toCity: 'Oshawa', bulky: 'Piano', preferredDate: '2026-11-01'
};

suite('Bookings — validation');

test('a complete service request validates, and details are whitelisted', () => {
  const r = validateBooking({ ...service, evil: 'x', details: { admin: true } }, TODAY);
  assert(r.ok, r.error);
  equal(r.value.details.appliance, 'Refrigerator');
  equal(r.value.details.urgent, true);
  assert(!('evil' in r.value.details) && !('admin' in r.value.details), 'unknown keys are dropped');
});

test('a complete move request validates and maps the pick-up to the address', () => {
  const r = validateBooking(move, TODAY);
  assert(r.ok, r.error);
  equal(r.value.address, '1 Main St');
  equal(r.value.details.toCity, 'Oshawa');
});

test('missing or bad fields are refused with a message', () => {
  assert(!validateBooking({ ...service, email: 'nope' }, TODAY).ok);
  assert(!validateBooking({ ...service, phone: 'abc' }, TODAY).ok);
  assert(!validateBooking({ ...service, issue: '' }, TODAY).ok);
  assert(!validateBooking({ ...service, appliance: 'Spaceship' }, TODAY).ok);
  assert(!validateBooking({ ...move, toAddress: '' }, TODAY).ok);
  assert(!validateBooking({ ...service, kind: 'other' }, TODAY).ok);
});

test('a date in the past is refused; today is fine', () => {
  assert(!validateBooking({ ...service, preferredDate: '2026-10-06' }, TODAY).ok);
  assert(validateBooking({ ...service, preferredDate: TODAY }, TODAY).ok);
});

suite('Bookings — storage and queue');

test('a request is stored, numbered, and listed as open', async () => {
  const { done } = await withTestDb();
  try {
    const r = await createBooking(validateBooking(service, TODAY).value, { ip: '1.1.1.1' });
    assert(/^BK-\d+$/.test(r.ref), 'has a BK- reference');
    const { bookings, counts } = await listBookings({ status: 'open' });
    equal(bookings.length, 1);
    equal(counts.new, 1);
    await setBookingStatus(r.id, 'closed', 'a@b.ca');
    equal((await listBookings({ status: 'open' })).bookings.length, 0);
  } finally { done(); }
});

test('the rate limit counts per IP', async () => {
  const { done } = await withTestDb();
  try {
    for (let i = 0; i < 5; i++) {
      await createBooking(validateBooking({ ...service, email: `p${i}@example.com` }, TODAY).value, { ip: '2.2.2.2' });
    }
    equal((await checkBookingRate({ ip: '2.2.2.2', email: 'new@example.com' })).ok, false);
    equal((await checkBookingRate({ ip: '3.3.3.3', email: 'new@example.com' })).ok, true);
  } finally { done(); }
});

test('a move cannot become a ticket; a service call becomes exactly one', async () => {
  const { done } = await withTestDb();
  try {
    const m = await createBooking(validateBooking(move, TODAY).value, {});
    let err = '';
    try { await convertToTicket(m.id, { email: 'a@b.ca', name: 'A' }); } catch (e) { err = e.message; }
    assert(/Only service calls/.test(err), err);

    const s = await createBooking(validateBooking(service, TODAY).value, {});
    const t = await convertToTicket(s.id, { email: 'a@b.ca', name: 'A' });
    assert(/^SC-/.test(t.ticket_number));
    err = '';
    try { await convertToTicket(s.id, { email: 'a@b.ca', name: 'A' }); } catch (e) { err = e.message; }
    assert(/already opened/.test(err), 'a second click is refused');
    const row = (await listBookings({ status: 'converted' })).bookings[0];
    equal(row.ticket_number, t.ticket_number);
  } finally { done(); }
});

suite('Bookings — who may post from a browser');

test('rssolutions.ca is allowed; any other origin gets no CORS headers', () => {
  equal(bookingCorsHeaders('https://rssolutions.ca')['Access-Control-Allow-Origin'], 'https://rssolutions.ca');
  equal(bookingCorsHeaders('https://www.rssolutions.ca')['Access-Control-Allow-Origin'], 'https://www.rssolutions.ca');
  assert(!('Access-Control-Allow-Origin' in bookingCorsHeaders('https://evil.example')), 'other origin refused');
  assert(!('Access-Control-Allow-Origin' in bookingCorsHeaders('https://rssolutions.ca.evil.example')), 'suffix tricks refused');
  assert(!('Access-Control-Allow-Origin' in bookingCorsHeaders(null)), 'no origin, no headers');
});
