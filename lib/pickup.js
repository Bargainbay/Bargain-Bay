// In-app pickup scheduling. Generates 30-minute appointment slots in store-local
// time (America/Toronto), Mon–Fri 10:00–17:00, for the next two weeks, and
// tracks which are already booked. The chosen slot is stored on
// orders.pickup_slot as a local "YYYY-MM-DDTHH:MM" label — no timezone math at
// read time, just display it.
import { hasDb, query } from './db';

export const PICKUP_TZ = 'America/Toronto';
const FIRST_MIN = 10 * 60;            // 10:00 first slot
const LAST_START_MIN = 16 * 60 + 30;  // 16:30 last slot start (ends 17:00)
const SLOT_MIN = 30;
const HORIZON_DAYS = 14;
const BUFFER_MIN = 60;                 // don't offer slots within the next hour

const pad = (n) => String(n).padStart(2, '0');

// Current wall-clock in the store timezone.
function nowInTz() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PICKUP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = (t) => Number(parts.find((x) => x.type === t).value);
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour'), mm: g('minute') };
}

// Friendly label, e.g. "Tue, Jun 23 · 10:00 AM", from a "YYYY-MM-DDTHH:MM" value.
export function pickupLabel(value) {
  if (!value) return '';
  const [date, time] = String(value).split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  // Anchor at noon UTC so the calendar date/weekday are stable regardless of zone.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = dt.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const h12 = ((hh + 11) % 12) + 1;
  return `${wd} · ${h12}:${pad(mm)} ${hh < 12 ? 'AM' : 'PM'}`;
}

// Slots already claimed by a live (non-cancelled) order.
export async function takenSlots() {
  if (!hasDb()) return new Set();
  try {
    const { rows } = await query("SELECT pickup_slot FROM orders WHERE pickup_slot IS NOT NULL AND status <> 'cancelled'");
    return new Set(rows.map((r) => r.pickup_slot));
  } catch {
    return new Set();
  }
}

// All bookable slots over the horizon, minus taken and past ones.
export async function availableSlots() {
  const taken = await takenSlots();
  const now = nowInTz();
  const nowAbs = now.hh * 60 + now.mm;
  const anchor = Date.UTC(now.y, now.m - 1, now.d, 12);
  const out = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const dt = new Date(anchor + i * 86400000);
    const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
    if (dow === 0 || dow === 6) continue; // Mon–Fri only
    const dateStr = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    for (let t = FIRST_MIN; t <= LAST_START_MIN; t += SLOT_MIN) {
      if (i === 0 && t < nowAbs + BUFFER_MIN) continue; // today: future slots only
      const value = `${dateStr}T${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
      if (taken.has(value)) continue;
      out.push({ value, label: pickupLabel(value) });
    }
  }
  return out;
}

export function isValidSlotFormat(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''));
}
