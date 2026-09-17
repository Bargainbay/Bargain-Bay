// The team assistant's hands: what each team may look up, and the few things it
// may DO after reading them back.
//
// Every tool names the teams that get it. The engine only ever shows a person
// the tools for their own teams, so the gate is the tool list itself — the same
// rule Sarah's read-only chats follow.
//
// Reads run straight away. A tool with `prepare` + `execute` is a WRITE: the
// engine calls `prepare`, which checks it can be done and returns the sentence
// that gets read back; `execute` only runs from a later message, through
// confirm_action (lib/assistant/store.js is where that is enforced).
//
// Each write wraps an EXISTING function the screens already call —
// setJobStatus, moveUnits, requestPart. There is no second way to move a unit or
// mark a stop, so the phone, the scanner and the voice can never disagree about
// what happened, and every move still lands in the same history.
//
// Deliberately NOT here, and not an oversight:
// - closing a stop (done / couldn't complete). The signature, the photos and the
//   damage answers are a signed form; they stay on the screen.
// - raising an invoice. It emails a customer, holds stock and books revenue, and
//   the lead source is required on create. The assistant prices a sale out
//   (price_sale) and the rep raises it on the Invoices screen.
// - anything that moves money, and anything cost-derived for a non-admin.
import { executeTool } from '../agent-tools';
import { driverJobs, jobBelongsToDriver } from '../driver-jobs';
import { setJobStatus, noteJobEvent, balancesForOrders, JOB_STATUSES, JOB_SERVICES, SHIPMENT_TYPES } from '../jobs';
import { cashAtTheDoor } from '../cash-at-the-door';
import { findUnits, unitWhere, locationContents, listLocations, describeUnits, canonicalSkus, moveUnits } from '../locations';
import { searchParts, describeParts, requestPart } from '../parts';
import { getOrderByNumber } from '../orders';
import { getMany } from '../inventory';
import { decorate } from '../pricing';
import { unavailableSkus } from '../reservations';
import { sendEmail, esc } from '../email';
import { query } from '../db';
import { money, formatPhone, dispatchDesk, DELIVERY_FEE, HST_RATE, round2, PICKUP_ADDRESS } from '../constants';
import { byWho } from './people';

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const joinAddr = (...parts) => parts.map((p) => str(p)).filter(Boolean).join(', ');

// ── Driver ──────────────────────────────────────────────────────────────────

const OPEN = (s) => !['done', 'failed', 'cancelled'].includes(s.status);

function speakStop(s) {
  const cash = cashAtTheDoor(s);
  const owing = Math.max(0, round2((s.balanceDue || 0) - (s.reported || 0)));
  const transfer = !!s.pickupAddress;
  return {
    jobNumber: s.jobNumber,
    stopNumber: s.helping ? null : s.seq,
    orderNumber: s.orderNumber,
    client: s.clientName || (s.orderNumber ? 'Bargain Bay' : null),
    kind: s.type,
    status: JOB_STATUSES[s.status] || s.status,
    day: s.jobDate,
    window: s.windowStart ? `${s.windowStart}${s.windowEnd ? `–${s.windowEnd}` : ''}` : 'no window set',
    customer: s.customerName || null,
    phone: s.phone ? formatPhone(s.phone) : null,
    dropOff: joinAddr(s.address, s.city, s.postal) || null,
    pickupFrom: transfer ? {
      company: s.pickupCompany || null, contact: s.pickupName || null,
      phone: s.pickupPhone ? formatPhone(s.pickupPhone) : null,
      address: joinAddr(s.pickupAddress, s.pickupCity, s.pickupPostal)
    } : null,
    howFarIn: SHIPMENT_TYPES[s.shipmentType] || null,
    services: (s.services || []).map((k) => JOB_SERVICES[k] || k),
    items: (s.items || []).map((i) => `${Number(i.qty) > 1 ? `${i.qty} x ` : ''}${i.description}${i.sku ? ` (${i.sku})` : ''}`),
    serviceCall: s.ticketNumber ? { ticket: s.ticketNumber, appliance: s.appliance, problem: s.issue } : null,
    collectOnInvoice: owing > 0 ? `${money(owing)} on ${s.invoiceNumber || 'the invoice'}` : null,
    alreadyReportedTaking: s.reported > 0 ? money(s.reported) : null,
    cashAtTheDoor: cash ? {
      amount: money(cash.amount),
      // Read out of the client's notes, not typed by the office. The run sheet
      // says "check it before you ask"; so must the voice.
      certain: cash.typed,
      note: cash.note || null
    } : null,
    tradeInToBringBack: (s.tradeIns || []).map((t) => `${t.description} (we credited ${money(t.allowance)})`),
    tradeInLoaded: !!s.tradeInCollected,
    notes: s.notes || null,
    ridingWith: s.mateName || null,
    youAreSecondDriver: !!s.helping,
    closedBy: s.closedBy || null
  };
}

async function findMyStop(person, jobNumber) {
  const want = str(jobNumber, 30).toUpperCase().replace(/\s+/g, '');
  if (!want) return { error: 'Which stop? Give the RS- job number or the BB- order number.' };
  const day = await driverJobs(person.userId);
  const all = [...day.stops, ...day.earlier, ...day.tomorrow];
  const hit = all.find((s) => String(s.jobNumber || '').toUpperCase() === want || String(s.orderNumber || '').toUpperCase() === want)
    // "stop 3" — only meaningful against today's run.
    || (/^\d+$/.test(want) ? day.stops.find((s) => !s.helping && Number(s.seq) === Number(want)) : null);
  if (!hit) return { error: `${want} isn't on your stops. Ask for the list with my_stops.` };
  if (!(await jobBelongsToDriver(hit.id, person.userId))) return { error: `${want} isn't yours.` };
  return { stop: hit, today: day.today };
}

const driverTools = [
  {
    name: 'my_stops',
    teams: ['driver'],
    description: "The signed-in driver's own stops — today's run in order (with the next open stop called out), tomorrow's for planning, or stops from earlier days that were never closed. Each stop has the customer, phone, address (and pickup end for a transfer), window, what's on the truck, services, white glove vs threshold, notes, money to collect, cash at the door, and any trade-in to bring back. Only ever this driver's stops.",
    input_schema: {
      type: 'object',
      properties: { which: { type: 'string', enum: ['today', 'tomorrow', 'unfinished_earlier'], description: 'Default today.' } }
    },
    async run(input, { person }) {
      const day = await driverJobs(person.userId);
      const which = input.which || 'today';
      const list = which === 'tomorrow' ? day.tomorrow : which === 'unfinished_earlier' ? day.earlier : day.stops;
      const open = list.filter(OPEN);
      const next = which === 'today' ? open.find((s) => !s.helping) || open[0] : null;
      const collect = list.filter(OPEN).reduce((a, s) => a + Math.max(0, (s.balanceDue || 0) - (s.reported || 0)), 0);
      return {
        date: which === 'tomorrow' ? null : day.today,
        which,
        total: list.length,
        stillToGo: open.length,
        moneyToCollectOnInvoices: collect > 0 ? money(collect) : null,
        nextStop: next ? speakStop(next) : null,
        stops: list.map(speakStop),
        unfinishedEarlierCount: which === 'today' ? day.earlier.length : undefined
      };
    }
  },
  {
    name: 'update_stop_status',
    teams: ['driver'],
    write: true,
    description: "Mark one of the driver's own stops 'on_the_way' or 'arrived'. Arriving starts the on-site clock the office costs the stop by. Closing a stop (done or couldn't complete) is NOT available by voice — the signature, photos and damage questions are on the Finish screen in the app; tell them to tap Finish on the stop.",
    input_schema: {
      type: 'object',
      properties: {
        jobNumber: { type: 'string', description: 'RS- job number, BB- order number, or the stop number in today\'s run.' },
        status: { type: 'string', enum: ['on_the_way', 'arrived'] }
      },
      required: ['jobNumber', 'status']
    },
    async prepare(input, { person }) {
      if (!['on_the_way', 'arrived'].includes(input.status)) {
        return { error: 'By voice a stop can only be marked on the way or arrived. Finish it on the Finish screen.' };
      }
      const { stop, error } = await findMyStop(person, input.jobNumber);
      if (error) return { error };
      if (!OPEN(stop)) return { error: `${stop.jobNumber} is already ${JOB_STATUSES[stop.status]} — nothing to change.` };
      if (stop.status === input.status) return { error: `${stop.jobNumber} is already marked ${JOB_STATUSES[stop.status]}.` };
      const label = input.status === 'arrived' ? 'arrived at' : 'on the way to';
      const who = [stop.customerName, joinAddr(stop.address, stop.city)].filter(Boolean).join(', ');
      return {
        input: { jobId: stop.id, jobNumber: stop.jobNumber, status: input.status },
        readback: `Mark you ${label} ${stop.jobNumber}${stop.orderNumber ? ` (${stop.orderNumber})` : ''}${who ? ` — ${who}` : ''}?`
      };
    },
    async execute(input, { person }) {
      if (!(await jobBelongsToDriver(input.jobId, person.userId))) return { error: 'That stop is no longer yours.' };
      const { rows } = await query('SELECT status FROM jobs WHERE id = $1', [input.jobId]);
      if (['done', 'failed', 'cancelled'].includes(rows[0]?.status)) return { ok: true, note: 'The stop was already closed — nothing changed.' };
      await setJobStatus(input.jobId, input.status, { note: 'by voice assistant' }, byWho(person));
      return { ok: true, jobNumber: input.jobNumber, status: JOB_STATUSES[input.status] };
    }
  },
  {
    name: 'message_dispatch',
    teams: ['driver'],
    write: true,
    description: "Send a short message to the dispatch desk (email to the office, and noted on the stop's history if a stop is named). For a problem the office has to act on: customer not home, won't fit, damage found, wrong item, running late. It is a message, not a status change.",
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What the office needs to know, in English, in the driver\'s own words.' },
        jobNumber: { type: 'string', description: 'The stop it is about, if any.' }
      },
      required: ['message']
    },
    async prepare(input, { person }) {
      const message = str(input.message, 600);
      if (!message) return { error: 'What should the office be told?' };
      let stop = null;
      if (str(input.jobNumber)) {
        const r = await findMyStop(person, input.jobNumber);
        if (r.error) return { error: r.error };
        stop = r.stop;
      }
      return {
        input: { message, jobId: stop?.id || null, jobNumber: stop?.jobNumber || null, orderNumber: stop?.orderNumber || null },
        readback: `Tell dispatch${stop ? ` about ${stop.jobNumber}` : ''}: "${message}"?`
      };
    },
    async execute(input, { person }) {
      if (input.jobId) await noteJobEvent(input.jobId, 'note', `Driver message: ${input.message}`, byWho(person));
      const subject = `[Dispatch] ${person.name}${input.jobNumber ? ` — ${input.jobNumber}` : ''}: ${input.message.slice(0, 60)}`;
      const html = `<p><b>${esc(person.name)}</b> sent this from the driver assistant${input.jobNumber ? ` about <b>${esc(input.jobNumber)}</b>${input.orderNumber ? ` (${esc(input.orderNumber)})` : ''}` : ''}:</p>
        <blockquote style="border-left:3px solid #ccc;margin:0;padding:6px 12px">${esc(input.message)}</blockquote>`;
      const sent = await sendEmail({ to: dispatchDesk(), subject, html, brand: 'rs_solutions' });
      if (!sent?.ok && !input.jobId) return { error: 'The office email did not go out. Ring dispatch instead.' };
      return { ok: true, emailed: !!sent?.ok, notedOnStop: !!input.jobId };
    }
  }
];

// ── Warehouse, refurb & parts ───────────────────────────────────────────────

const speakUnit = (u) => ({
  sku: u.sku, title: u.title || [u.make, u.model].filter(Boolean).join(' '),
  make: u.make || null, model: u.model || null, condition: u.condition || null,
  status: ({ for_sale: 'on sale', sold: 'sold', salvage: 'salvage', salvage_gone: 'salvage, gone', not_listed: 'in stock, not listed', unknown: 'not in the system' })[u.status] || u.status,
  where: u.location || (u.gone ? 'left the building' : u.everPlaced ? 'unknown' : 'never scanned into a spot'),
  since: u.movedAt, movedBy: u.movedBy || null, order: u.orderNumber || null
});

const speakPart = (p, admin) => ({
  partId: p.id, partNumber: p.partNumber || null, name: p.name, brand: p.brand || null,
  fits: (p.fits || []).slice(0, 12), onShelf: p.onHand, alreadyRequested: p.held, free: p.available,
  where: (p.spots || []).map((s) => `${s.location || 'no spot'} x${s.qty}`),
  // What a part cost is the owner's (CLAUDE.md, Parts): stripped for everyone else.
  ...(admin ? { valueAtCost: money(p.valueAtCost) } : {})
});

const warehouseTools = [
  {
    name: 'find_unit',
    teams: ['warehouse', 'sales'],
    description: 'Find appliances by SKU, make, model or description and say where each is standing in the warehouse (spot code like L3-2 or V2), whether it is on sale, sold or salvage, and who last moved it. With an exact SKU also returns its recent move history.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(input) {
      const q = str(input.query, 80);
      if (q.length < 2) return { error: 'Give me a SKU, brand or model.' };
      const units = await findUnits(q);
      const exact = units.find((u) => u.sku.toUpperCase() === q.toUpperCase());
      if (exact) {
        const full = await unitWhere(exact.sku);
        return { unit: speakUnit(full), history: (full.history || []).slice(0, 6) };
      }
      return { count: units.length, units: units.slice(0, 10).map(speakUnit), more: units.length > 10 ? units.length - 10 : 0 };
    }
  },
  {
    name: 'spot_contents',
    teams: ['warehouse'],
    description: "What is recorded in one warehouse spot (e.g. L3-2 = left wall section 3 shelf 2 counted up from the floor; V1–V4 front lanes; H1–H6 back lanes; RECEIVING, DELIVERY-STAGING, PICKUP-STAGING). It is only as right as that spot's last count.",
    input_schema: { type: 'object', properties: { spot: { type: 'string' } }, required: ['spot'] },
    async run(input) {
      const { spot, units } = await locationContents(str(input.spot, 30));
      return { spot: spot.code, purpose: spot.purpose || null, count: units.length, units: units.map(speakUnit) };
    }
  },
  {
    name: 'move_units',
    teams: ['warehouse'],
    write: true,
    description: 'Record that units have been put in a spot (up to 20 SKUs at a time). Writes the same move history the scanner does.',
    input_schema: {
      type: 'object',
      properties: {
        skus: { type: 'array', items: { type: 'string' } },
        spot: { type: 'string', description: 'Spot code, e.g. L3-2, V2, RECEIVING.' }
      },
      required: ['skus', 'spot']
    },
    async prepare(input) {
      const skus = [...new Set((Array.isArray(input.skus) ? input.skus : [input.skus]).map((s) => str(s, 40)).filter(Boolean))];
      if (!skus.length) return { error: 'Which SKUs?' };
      if (skus.length > 20) return { error: 'Twenty at a time by voice — use the scanner for a skid.' };
      const code = str(input.spot, 30).toUpperCase().replace(/\s+/g, '');
      const spot = (await listLocations()).find((s) => s.code === code);
      if (!spot) return { error: `There is no spot called ${code}. Ask which spot they meant.` };
      if (!spot.active) return { error: `${code} has been retired.` };
      const canon = await canonicalSkus(skus);
      const units = await describeUnits(canon);
      const unknown = canon.filter((s) => !units.find((u) => u.sku === s && u.status !== 'unknown'));
      const lines = canon.map((s) => {
        const u = units.find((x) => x.sku === s);
        return `${s}${u?.title ? ` ${u.title}` : ''}${u?.location ? ` (now in ${u.location})` : ''}`;
      });
      return {
        input: { skus: canon, spot: code },
        readback: `Put ${canon.length === 1 ? 'this unit' : `these ${canon.length} units`} in ${code}: ${lines.join('; ')}?`
          + (unknown.length ? ` Note: ${unknown.join(', ')} is not a SKU the system knows — check it was heard right.` : '')
      };
    },
    async execute(input, { person }) {
      const r = await moveUnits({ skus: input.skus, code: input.spot, by: person.email, byName: person.name, via: 'assistant' });
      return { ok: true, spot: input.spot, result: r };
    }
  },
  {
    name: 'find_parts',
    teams: ['warehouse'],
    description: 'Search the parts shelf by part number, name, brand, or a model it fits. Says how many are on the shelf, how many are already requested, and which spot they are in.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(input, { person }) {
      const parts = await searchParts(str(input.query, 80), { limit: 10 });
      return { count: parts.length, parts: parts.map((p) => speakPart(p, person.admin)) };
    }
  },
  {
    name: 'request_part',
    teams: ['warehouse'],
    write: true,
    description: 'Ask for a part off the shelf. This HOLDS it and puts it in the admin approval queue; nothing leaves the shelf until an admin approves and somebody picks it. Find the partId with find_parts first.',
    input_schema: {
      type: 'object',
      properties: {
        partId: { type: 'integer' },
        qty: { type: 'integer', description: 'Default 1.' },
        reason: { type: 'string', description: 'What it is for.' },
        jobRef: { type: 'string', description: 'The unit SKU or RS- job it is for, if any.' }
      },
      required: ['partId']
    },
    async prepare(input) {
      const qty = Math.max(1, Math.round(Number(input.qty) || 1));
      const [part] = await describeParts([Number(input.partId)]);
      if (!part) return { error: 'No such part — look it up with find_parts.' };
      if (part.available < qty) {
        return { error: part.onHand === 0 ? `None of ${part.name} on the shelf — it has to be ordered.` : `Only ${part.available} free (${part.held} already requested).` };
      }
      const reason = str(input.reason, 300) || null;
      const jobRef = str(input.jobRef, 40) || null;
      return {
        input: { partId: part.id, qty, reason, jobRef },
        readback: `Request ${qty} x ${part.name}${part.partNumber ? ` (${part.partNumber})` : ''}${jobRef ? ` for ${jobRef}` : ''}${reason ? ` — ${reason}` : ''}? It goes to an admin to approve.`
      };
    },
    async execute(input, { person }) {
      const r = await requestPart({ ...input, by: person.email, byName: person.name });
      return { ok: true, request: r, note: 'Held and waiting for an admin to approve.' };
    }
  }
];

// ── Sales ───────────────────────────────────────────────────────────────────

async function publicUnits(raw) {
  // Spoken SKUs arrive in whatever case the transcript chose.
  const skus = await canonicalSkus(raw);
  const blocked = await unavailableSkus(skus).catch(() => new Set());
  const units = (await getMany(skus)).filter((u) => !blocked.has(u.id));
  // decorate() is the one price resolver (clearance layer included) and it
  // strips cost. No session: this is the price a regular customer pays.
  return decorate(units, null);
}

const salesTools = [
  {
    name: 'find_stock',
    teams: ['sales'],
    description: 'Search what is for sale right now (brand, model, type, "white fridge under 1200"). Returns the price a customer pays today — clearance included — with retail, condition and warranty. Sold and held units are left out.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, maxPrice: { type: 'number' } },
      required: ['query']
    },
    async run(input) {
      const found = await executeTool('search_inventory', { query: str(input.query, 120), limit: 25 }, {});
      if (found.error) return found;
      let units = await publicUnits(found.units.map((u) => u.sku));
      const cap = Number(input.maxPrice);
      if (cap > 0) units = units.filter((u) => u.price <= cap);
      const order = new Map(found.units.map((u, i) => [u.sku, i]));
      units.sort((a, b) => order.get(a.id) - order.get(b.id));
      return {
        count: units.length,
        units: units.slice(0, 10).map((u) => ({
          sku: u.id, title: u.title || `${u.make} ${u.model}`, category: u.category, condition: u.condition,
          price: money(u.price), retail: u.compareAt ? money(u.compareAt) : null,
          onClearance: u.onClearance || undefined, warrantyMonths: u.warrantyMonths
        }))
      };
    }
  },
  {
    name: 'find_customer',
    teams: ['sales'],
    description: 'Look up a customer by name, email or phone: contact details, recent orders, open invoices and quotes.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: (input) => executeTool('lookup_customer', { query: str(input.query, 80) }, {})
  },
  {
    name: 'find_invoices',
    teams: ['sales'],
    description: "Search invoices by INV number, BB order number, customer name/email/phone, SKU or memo. status 'unpaid' = open + partially paid.",
    input_schema: {
      type: 'object',
      properties: { search: { type: 'string' }, status: { type: 'string', enum: ['', 'unpaid', 'open', 'partial', 'paid', 'void', 'refunded'] } }
    },
    run: (input) => executeTool('list_invoices', { search: str(input.search, 80), status: input.status || '', limit: 10 }, {})
  },
  {
    name: 'order_status',
    teams: ['sales'],
    description: 'Where a BB- order is: its status, what is on it, what is still owing, and its delivery — booked day, window, driver and whether the stop is done.',
    input_schema: { type: 'object', properties: { orderNumber: { type: 'string' } }, required: ['orderNumber'] },
    async run(input) {
      let num = str(input.orderNumber, 20).toUpperCase().replace(/\s+/g, '');
      if (/^\d+$/.test(num)) num = `BB-${num}`;
      const o = await getOrderByNumber(num);
      if (!o) return { error: `No order ${num}.` };
      const [balances, jobs] = await Promise.all([
        balancesForOrders([o.id]),
        query(
          `SELECT j.job_number, j.status, j.job_date, j.window_start, j.window_end, COALESCE(u.name, u.email) AS driver
             FROM jobs j LEFT JOIN users u ON u.id = j.driver_id
            WHERE j.order_id = $1 ORDER BY j.id DESC LIMIT 1`,
          [o.id]
        ).then((r) => r.rows).catch(() => [])
      ]);
      const bal = balances.get(o.id);
      const j = jobs[0];
      return {
        order: o.order_number, status: o.status, placed: o.created_at?.toISOString?.().slice(0, 10) || null,
        customer: o.name || o.email, phone: o.phone ? formatPhone(o.phone) : null,
        // Titles and prices only — order_items also carries cost.
        items: (o.items || []).map((i) => `${i.title}${i.sku ? ` (${i.sku})` : ''} ${money(i.price)}`),
        total: money(o.total), stillOwing: bal?.balanceDue > 0 ? money(bal.balanceDue) : null,
        method: o.delivery_method,
        delivery: j ? {
          job: j.job_number, stopStatus: JOB_STATUSES[j.status] || j.status,
          day: j.job_date ? j.job_date.toISOString().slice(0, 10) : 'not scheduled',
          window: j.window_start ? `${String(j.window_start).slice(0, 5)}–${String(j.window_end || '').slice(0, 5)}` : null,
          driver: j.driver || 'not assigned'
        } : (o.delivery_method === 'delivery' ? 'not on the dispatch board yet' : `pickup at ${PICKUP_ADDRESS}`)
      };
    }
  },
  {
    name: 'price_sale',
    teams: ['sales'],
    description: 'Work out what a sale comes to before it is raised: the live price of each SKU (checked available), any extra lines, delivery ($79) or pickup, 13% HST and the total. Creates NOTHING — the rep raises the invoice on the Invoices screen.',
    input_schema: {
      type: 'object',
      properties: {
        skus: { type: 'array', items: { type: 'string' } },
        extraLines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, amount: { type: 'number' } }, required: ['description', 'amount'] } },
        delivery: { type: 'boolean' }
      }
    },
    async run(input) {
      const skus = [...new Set((input.skus || []).map((s) => str(s, 40)).filter(Boolean))];
      const units = skus.length ? await publicUnits(skus) : [];
      const missing = skus.filter((s) => !units.find((u) => u.id.toUpperCase() === s.toUpperCase()));
      const lines = units.map((u) => ({ description: u.title || `${u.make} ${u.model}`, sku: u.id, amount: Number(u.price) }));
      for (const l of input.extraLines || []) {
        const amount = Number(l.amount);
        if (str(l.description) && Number.isFinite(amount)) lines.push({ description: str(l.description, 120), amount });
      }
      if (input.delivery) lines.push({ description: 'Delivery', amount: DELIVERY_FEE });
      const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
      const hst = round2(subtotal * HST_RATE);
      return {
        lines: lines.map((l) => ({ ...l, amount: money(l.amount) })),
        notAvailable: missing.length ? missing : undefined,
        subtotal: money(subtotal), hst: money(hst), total: money(round2(subtotal + hst)),
        note: 'Nothing has been created. Raise it on Admin → Invoices → New, where the lead source is asked.'
      };
    }
  }
];

export const ALL_TOOLS = [...driverTools, ...warehouseTools, ...salesTools];

export const CONFIRM_TOOL = {
  name: 'confirm_action',
  description: "Carry out an action you read back EARLIER and the person has now clearly said yes to (yes / go ahead / do it, in any language). Never call it in the same turn you proposed the action — it will refuse. If they said no, changed a detail, or you are unsure what they agreed to, call cancel_action or propose again instead.",
  input_schema: { type: 'object', properties: { actionId: { type: 'string' } }, required: ['actionId'] }
};
export const CANCEL_TOOL = {
  name: 'cancel_action',
  description: 'Drop an action that is waiting for a yes, because the person said no or wants something different.',
  input_schema: { type: 'object', properties: { actionId: { type: 'string' } }, required: ['actionId'] }
};

export function toolsForPerson(person) {
  const mine = ALL_TOOLS.filter((t) => t.teams.some((team) => person.teams.includes(team)));
  return { mine, hasWrites: mine.some((t) => t.write) };
}

// The wire shape the API wants. Kept in a stable order so the prompt cache holds.
export function apiTools(person) {
  const { mine, hasWrites } = toolsForPerson(person);
  const defs = mine.map((t) => ({
    name: t.name,
    description: t.write ? `${t.description} This is a CHANGE: calling it only prepares a read-back; see confirm_action.` : t.description,
    input_schema: t.input_schema
  }));
  return hasWrites ? [...defs, CONFIRM_TOOL, CANCEL_TOOL] : defs;
}
