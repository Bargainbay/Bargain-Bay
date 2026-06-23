// Ops Copilot — the tool layer. Each tool is a thin, audited wrapper around an
// existing piece of app machinery (invoices, inventory, clearance). The same
// definitions power both the command copilot in /admin/agent and (later) the
// scheduled autopilot routines, so capabilities live in ONE place.
//
// Phase 1 scope: Invoicing + Inventory. Every executor returns a plain object
// that gets JSON-stringified back to the model as a tool_result; on failure it
// returns { error } (never throws) so the model can read the message and adapt.
import { hasDb } from './db';
import { getAll } from './inventory';
import {
  createAndSendInvoice, listInvoices, markInvoicePaid, voidInvoice,
  getInvoiceByNumber, PAYMENT_METHODS
} from './invoices';
import { upsertClearance } from './clearance';
import { markUnitsSold, reactivateUnit, syncInventoryFromTracker } from './catalog-sync';

// --- Tool definitions (Anthropic tool-use JSON schemas) --------------------
// READ tools run immediately. WRITE tools (marked below) change live data or
// email a customer — the system prompt instructs the model to confirm those in
// chat before calling them. The tools themselves still do the real thing.
export const TOOLS = [
  {
    name: 'search_inventory',
    description:
      'Search active in-stock units by make, model, title, category, or SKU. Use this to find the real SKU and current price before adding a unit to an invoice or repricing it. Multi-word queries match across the whole record (e.g. "kitchenaid dishwasher").',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, e.g. "whirlpool fridge" or a SKU.' },
        limit: { type: 'integer', description: 'Max results (default 8).' }
      },
      required: ['query']
    }
  },
  {
    name: 'inventory_summary',
    description: 'Get a high-level snapshot of current stock: total active units, a breakdown by category, and the total list value.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'list_invoices',
    description: 'List the most recent invoices with their number, customer, status (open/paid/void), total, and any linked fulfilment order.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many to return (default 15, max 50).' } }
    }
  },
  {
    name: 'create_invoice',
    description:
      'WRITE — Create and EMAIL an itemized invoice to a customer (they pay by Interac e-transfer or in person). Confirm the customer email, line items, amounts, and HST with the owner before calling. Amounts are in CAD dollars. Attach a unit SKU to a line item (from search_inventory) so the unit is delisted when the invoice is paid.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: "Customer's email — the invoice is sent here." },
        name: { type: 'string', description: "Customer's name (optional)." },
        items: {
          type: 'array',
          description: 'Line items. amount is the dollar price of that line.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              amount: { type: 'number', description: 'Dollar amount (CAD) for this line.' },
              sku: { type: 'string', description: 'Unit SKU if this line is an inventory unit (optional).' }
            },
            required: ['description', 'amount']
          }
        },
        addHst: { type: 'boolean', description: 'Add 13% HST (default true).' },
        daysUntilDue: { type: 'integer', description: 'Days until the invoice is due (default 14).' },
        memo: { type: 'string', description: 'Note shown on the invoice (optional).' },
        deliveryMethod: { type: 'string', enum: ['pickup', 'delivery'], description: 'Fulfilment (default pickup). When the invoice is paid, a matching order is created in Operations.' },
        address: { type: 'string' },
        city: { type: 'string' },
        postal: { type: 'string' },
        phone: { type: 'string' }
      },
      required: ['email', 'items']
    }
  },
  {
    name: 'mark_invoice_paid',
    description:
      'WRITE — Mark an open invoice paid. This records the payment, delists any units on it as sold, and creates a confirmed fulfilment order. Confirm with the owner first. Identify the invoice by invoiceNumber (e.g. "INV-1042") or numeric invoiceId.',
    input_schema: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number like "INV-1042".' },
        invoiceId: { type: 'integer', description: 'Numeric invoice id (alternative to invoiceNumber).' },
        method: { type: 'string', enum: Object.keys(PAYMENT_METHODS), description: 'How it was paid.' }
      },
      required: ['method']
    }
  },
  {
    name: 'void_invoice',
    description: 'WRITE — Void an open invoice that was created in error. Leaves a record; does not touch stock. Confirm with the owner first.',
    input_schema: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number like "INV-1042".' },
        invoiceId: { type: 'integer', description: 'Numeric invoice id (alternative to invoiceNumber).' }
      }
    }
  },
  {
    name: 'reprice_unit',
    description:
      'WRITE — Mark a unit down to a new price. This applies a clearance markdown: the unit shows on the storefront at the new price (the 1-year warranty is unchanged). Confirm the SKU and new price with the owner first. Use search_inventory to get the exact SKU.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The unit SKU.' },
        price: { type: 'number', description: 'New selling price in CAD dollars.' },
        note: { type: 'string', description: 'Short reason shown on the listing (optional).' }
      },
      required: ['sku', 'price']
    }
  },
  {
    name: 'mark_unit_sold',
    description:
      'WRITE — Mark a unit sold outside the website (e.g. a walk-in cash sale with no invoice). Delists it from the storefront and adds it to the tracker reconciliation list. Confirm with the owner first. To invoice a sale instead, use create_invoice.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The unit SKU.' },
        ref: { type: 'string', description: 'Optional reference note for the sale.' }
      },
      required: ['sku']
    }
  },
  {
    name: 'relist_unit',
    description: 'WRITE — Put a unit that was marked sold back on the storefront (undo a sale). Cancels any order holding it. Confirm with the owner first.',
    input_schema: {
      type: 'object',
      properties: { sku: { type: 'string', description: 'The unit SKU.' } },
      required: ['sku']
    }
  },
  {
    name: 'sync_inventory',
    description: 'WRITE — Pull the latest inventory from the master Google tracker into the live site (adds new units, updates prices, removes units no longer listed). Confirm with the owner first.',
    input_schema: { type: 'object', properties: {} }
  }
];

// --- Executors -------------------------------------------------------------
const money = (n) => '$' + (Number(n) || 0).toFixed(2);

// Resolve an invoice reference (number string OR numeric id) to its DB id.
async function resolveInvoiceId({ invoiceId, invoiceNumber }) {
  if (invoiceId) return Number(invoiceId);
  const num = String(invoiceNumber || '').trim();
  if (!num) return null;
  const inv = await getInvoiceByNumber(num);
  return inv ? inv.id : null;
}

async function search_inventory({ query, limit }) {
  const tokens = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { error: 'Provide a search query.' };
  const all = await getAll();
  const matches = all
    .filter((u) => {
      const hay = `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.category || ''} ${u.id || ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, Math.min(Math.max(parseInt(limit, 10) || 8, 1), 25))
    .map((u) => ({
      sku: u.id,
      title: u.title || `${u.make} ${u.model}`,
      make: u.make, model: u.model, category: u.category,
      condition: u.condition,
      price: Number(u.price) || 0,
      retail: u.compareAt ? Number(u.compareAt) : null
    }));
  return { count: matches.length, units: matches };
}

async function inventory_summary() {
  const all = await getAll();
  const byCat = {};
  let value = 0;
  for (const u of all) {
    const c = u.category || 'Uncategorized';
    byCat[c] = (byCat[c] || 0) + 1;
    value += Number(u.price) || 0;
  }
  return {
    activeUnits: all.length,
    totalListValue: money(value),
    byCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }))
  };
}

async function list_invoices({ limit }) {
  const rows = await listInvoices(Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50));
  return {
    count: rows.length,
    invoices: rows.map((r) => ({
      id: r.id, number: r.number, customer: r.name || r.email, email: r.email,
      status: r.status, total: money(r.total), paidVia: r.method || null,
      order: r.orderNumber || null, due: r.due
    }))
  };
}

async function create_invoice(input) {
  const items = (Array.isArray(input.items) ? input.items : []).map((it) => ({
    description: String(it.description || '').trim(),
    amount: Number(it.amount),
    sku: it.sku ? String(it.sku).trim() : undefined
  }));
  const inv = await createAndSendInvoice({
    name: input.name, email: input.email, items,
    addHst: input.addHst !== false,
    daysUntilDue: input.daysUntilDue,
    memo: input.memo,
    deliveryMethod: input.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
    address: input.address, city: input.city, postal: input.postal, phone: input.phone
  });
  return {
    ok: true, invoiceId: inv.id, invoiceNumber: inv.number,
    total: money(inv.total), emailedTo: inv.email,
    message: `Invoice ${inv.number} for ${money(inv.total)} emailed to ${inv.email}.`
  };
}

async function mark_invoice_paid(input) {
  const method = String(input.method || '').trim();
  if (!PAYMENT_METHODS[method]) return { error: `Pick a valid payment method: ${Object.keys(PAYMENT_METHODS).join(', ')}.` };
  const id = await resolveInvoiceId(input);
  if (!id) return { error: 'Invoice not found — give a valid invoiceNumber (e.g. "INV-1042") or invoiceId.' };
  const r = await markInvoicePaid(id, method);
  if (r.status !== 'paid') return { ok: false, status: r.status, message: `Invoice ${r.number} is ${r.status}, not open — nothing changed.` };
  return {
    ok: true, invoiceNumber: r.number, paidVia: r.method, unitsDelisted: r.soldSkus,
    order: r.orderNumber || null,
    message: `Invoice ${r.number} marked paid (${r.method}).` + (r.orderNumber ? ` Fulfilment order ${r.orderNumber} created.` : '')
  };
}

async function void_invoice(input) {
  const id = await resolveInvoiceId(input);
  if (!id) return { error: 'Invoice not found — give a valid invoiceNumber or invoiceId.' };
  const v = await voidInvoice(id);
  if (!v) return { ok: false, message: 'Only an open invoice can be voided — nothing changed.' };
  return { ok: true, invoiceNumber: v.number, message: `Invoice ${v.number} voided.` };
}

async function reprice_unit(input) {
  const sku = String(input.sku || '').trim();
  const price = Number(input.price);
  if (!sku) return { error: 'Provide the unit SKU.' };
  if (!(price > 0)) return { error: 'Provide a positive price.' };
  await upsertClearance({ sku, price, note: input.note, active: true });
  return { ok: true, sku, newPrice: money(price), message: `${sku} repriced to ${money(price)} (clearance markdown applied).` };
}

async function mark_unit_sold(input) {
  const sku = String(input.sku || '').trim();
  if (!sku) return { error: 'Provide the unit SKU.' };
  const r = await markUnitsSold([sku], { channel: 'manual', ref: input.ref || null });
  if (!r.sold) return { ok: false, message: `${sku} wasn't found among active units — nothing changed.` };
  return { ok: true, sku, message: `${sku} marked sold and delisted. It's now on the tracker reconciliation list.` };
}

async function relist_unit(input) {
  const sku = String(input.sku || '').trim();
  if (!sku) return { error: 'Provide the unit SKU.' };
  const r = await reactivateUnit(sku);
  return { ok: !!r.ok, sku, cancelledOrders: r.cancelledOrders || 0, message: `${sku} relisted on the storefront.` };
}

async function sync_inventory() {
  const r = await syncInventoryFromTracker();
  return { ok: true, synced: r.synced, deactivated: r.deactivated, message: `Inventory synced: ${r.synced} units updated, ${r.deactivated} removed.` };
}

const EXECUTORS = {
  search_inventory, inventory_summary, list_invoices, create_invoice,
  mark_invoice_paid, void_invoice, reprice_unit, mark_unit_sold, relist_unit, sync_inventory
};

// Dispatch a single tool call. Never throws — returns { error } on failure so
// the model gets a readable message and can recover or report it.
export async function executeTool(name, input) {
  const fn = EXECUTORS[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  if (!hasDb() && name !== 'sync_inventory') return { error: 'Database not configured (POSTGRES_URL) — this action needs it.' };
  try {
    return await fn(input || {});
  } catch (e) {
    console.error(`agent tool ${name} failed`, e?.message || e);
    return { error: e?.message || `The ${name} action failed.` };
  }
}

export const SYSTEM_PROMPT = `You are the Operations Copilot for Bargain Bay — the liquidation appliance arm of RS Solutions (Hamilton / GTA). You assist the OWNER (an admin) from the /admin portal, helping them create invoices and manage inventory by talking in plain English. You are talking to the business owner, not a customer.

WHAT YOU CAN DO (via tools)
- Invoicing: search inventory, create & email invoices, list invoices, mark invoices paid, void invoices.
- Inventory: search stock, get a stock summary, reprice (mark down) a unit, mark a unit sold, relist a unit, sync inventory from the master tracker.

HOW TO WORK
- READ actions (search_inventory, inventory_summary, list_invoices) — just do them when useful; no need to ask.
- WRITE actions change live data or email a customer: create_invoice (emails the customer), mark_invoice_paid (records money + creates a fulfilment order), void_invoice, reprice_unit, mark_unit_sold, relist_unit, sync_inventory. Before any WRITE action, briefly restate exactly what you're about to do (customer, amounts, SKUs, prices) and ask the owner to confirm. Only call the tool after they say yes. If they've clearly already confirmed the specifics in their message, you may proceed.
- Never invent a SKU, price, or invoice number. Always search_inventory first to get the real SKU and current price before invoicing or repricing a unit.
- Money is in Canadian dollars. Invoices add 13% HST by default unless told otherwise.
- After a WRITE action completes, report the concrete result plainly: the invoice number and total, the new price, the order number, etc.
- Be concise and practical, like a sharp operations assistant. Lead with the outcome. Use the customer's email exactly as given.
- If a tool returns an error, tell the owner what went wrong in plain language and suggest the fix.

You only handle invoicing and inventory right now. If asked for something outside that (deliveries, run sheets, Facebook messages, reports), say it's not wired up yet but is on the roadmap.`;
