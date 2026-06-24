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
import { appendToPlaybook } from './playbook';

// --- Tool definitions (Anthropic tool-use JSON schemas) --------------------
// READ tools run immediately. WRITE tools (marked below) change live data or
// email a customer — the system prompt instructs the model to confirm those in
// chat before calling them. The tools themselves still do the real thing.
export const TOOLS = [
  {
    name: 'search_inventory',
    description:
      'Search active in-stock units by make, model, title, category, or SKU. Forgiving — it ignores filler words and understands synonyms and plurals (fridge=refrigerator, stove=range=oven, washer, dryer, etc.), and ranks the closest matches first. Just pass the brand, type, and/or model the way the person said it (e.g. "whirlpool fridge", "kitchenaid dishwasher", or a SKU); you don\'t need exact wording. Use it to find the real SKU and current price before invoicing or repricing.',
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
  },
  {
    name: 'remember',
    description:
      'WRITE (owner only) — Save a new piece of guidance, policy, or how-to into the company playbook so you and the team follow it from now on. Use it whenever the owner teaches you how something should be handled (e.g. "for a damaged unit found on delivery, offer 20% off or a swap", "we don\'t deliver past 7pm", "never go below cost without asking me"). Save it, then confirm what you saved.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'The guidance to save, as a clear, self-contained sentence.' } },
      required: ['note']
    }
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

// Filler words to ignore so a natural question ("do we still have any whirlpool
// fridges in stock?") narrows to the words that matter ("whirlpool", "fridge").
const STOPWORDS = new Set(
  ('the a an of to and or do does did we i you our your my have has any some still got get is are was ' +
   'in on for me it that this there they show find list give tell what whats which how much many ' +
   'price priced prices pricing cost costs at with about available stock inventory units unit models model ' +
   'please can could need want looking look left over right now under below above around').split(' ')
);
// Appliance synonyms — so "fridge" finds a "Refrigerator", "stove" finds a "Range", etc.
const SYN_GROUPS = [
  ['fridge', 'refrigerator'],
  ['stove', 'range', 'oven', 'cooktop', 'stovetop'],
  ['washer', 'washing'],
  ['dryer'],
  ['dishwasher'],
  ['microwave'],
  ['freezer'],
  ['hood', 'rangehood', 'vent']
];
const SYN_MAP = {};
for (const g of SYN_GROUPS) for (const w of g) SYN_MAP[w] = g;
function termVariants(t) {
  const set = new Set(SYN_MAP[t] || [t]);
  set.add(t);
  set.add(t.endsWith('s') ? t.slice(0, -1) : t + 's'); // singular/plural
  return [...set];
}

// Forgiving search: ignores filler words, understands synonyms + plurals, and
// SCORES each unit (brand/model match weighs more than category) instead of
// requiring every word to match. Returns the best matches, closest first.
async function search_inventory({ query, limit }) {
  const raw = String(query || '').toLowerCase().replace(/[^\w\s-]/g, ' ');
  const terms = raw.split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
  if (!terms.length) return { error: 'Tell me a brand, model, or type to search for (e.g. "whirlpool fridge").' };

  const all = await getAll();
  const scored = all
    .map((u) => {
      const brandHay = `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.id || ''}`.toLowerCase();
      const catHay = `${u.category || ''}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        const v = termVariants(t);
        if (v.some((x) => brandHay.includes(x))) score += 2;
        else if (v.some((x) => catHay.includes(x))) score += 1;
      }
      return { u, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score - a.score) || ((Number(a.u.price) || 0) - (Number(b.u.price) || 0)));

  const lim = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 25);
  const units = scored.slice(0, lim).map(({ u }) => ({
    sku: u.id,
    title: u.title || `${u.make} ${u.model}`,
    make: u.make, model: u.model, category: u.category,
    condition: u.condition,
    price: Number(u.price) || 0,
    retail: u.compareAt ? Number(u.compareAt) : null
  }));
  return { count: units.length, totalMatches: scored.length, units };
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

async function remember(input) {
  const note = String(input.note || '').trim();
  if (!note) return { error: 'What should I remember?' };
  await appendToPlaybook(note);
  return { ok: true, message: `Saved to the playbook: “${note}”` };
}

const EXECUTORS = {
  search_inventory, inventory_summary, list_invoices, create_invoice,
  mark_invoice_paid, void_invoice, reprice_unit, mark_unit_sold, relist_unit, sync_inventory, remember
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

// Team members (non-owner channels, e.g. the Telegram group) get lookups only —
// no writes, no customer/financial data. The owner + allowlisted admins get the
// full set. Filtering the exposed tools is the gate; the model can't call what
// it can't see.
const TEAM_TOOL_NAMES = ['search_inventory', 'inventory_summary'];
export function toolsFor({ readOnly = false } = {}) {
  return readOnly ? TOOLS.filter((t) => TEAM_TOOL_NAMES.includes(t.name)) : TOOLS;
}
export const READONLY_NOTE = `

IMPORTANT — you are talking to a TEAM MEMBER, not the owner. You can look up inventory (what's in stock, counts, prices) and answer their questions, but you CANNOT create or send invoices, take payments, change prices, or modify stock. If they ask for any of that, explain that only the owner can do it and offer to pass the request along. Keep answers short and helpful.`;

export const SYSTEM_PROMPT = `You are Sarah, the operations brain for Bargain Bay — the liquidation appliance arm of RS Solutions (Hamilton / GTA). You are the owner's AI right hand, and you help the whole team: the owner, the sales staff, and the delivery drivers. You answer their how-to and situational questions (how to handle a delivery problem, a tricky sale, a customer issue), you create invoices and manage inventory, and you keep day-to-day operations moving. You're reached from the /admin portal, WhatsApp, or a Telegram team chat — messages may arrive as text or voice notes (and your replies may be read aloud), so keep them clear and to the point.

HOW THE OWNER RUNS THINGS — YOUR PLAYBOOK
- A section titled "COMPANY PLAYBOOK" may appear at the very end of these instructions. That is the owner's own training: how this business runs and how he wants situations handled. Treat it as the source of truth and answer in line with it, in his practical, no-nonsense voice.
- If the playbook doesn't cover a question, give your best sensible judgment for a liquidation-appliance business, make clear it's your suggestion (not established policy), and offer to save it so the owner can confirm. When the owner teaches you how something should be handled, save it with the remember tool.
- You're advising real staff in the field. Be decisive and concrete — tell them what to do, not just options.

YOUR TONE
- Warm, upbeat, and personable — like a sharp, friendly right-hand who's genuinely glad to help. Positive and can-do. Never curt, cold, robotic, or moody, even when you're being brief. A little warmth and personality goes a long way with the team.
- Concise does NOT mean cold: a friendly opener or a quick positive sign-off ("On it!", "You got it", "Happy to help") makes all the difference. Match the energy of whoever you're talking to, and keep it human.

WHAT YOU CAN DO (via tools)
- Invoicing: search inventory, create & email invoices, list invoices, mark invoices paid, void invoices.
- Inventory: search stock, get a stock summary, reprice (mark down) a unit, mark a unit sold, relist a unit, sync inventory from the master tracker.
- Training: when the owner tells you how something should be handled, save it to the playbook with the remember tool.
- Advising the team: answer delivery, sales, and customer-handling questions using the playbook + good judgment (no tool needed — just answer well).

HOW TO WORK
- READ actions (search_inventory, inventory_summary, list_invoices) — just do them when useful; no need to ask.
- WRITE actions change live data or email a customer: create_invoice (emails the customer), mark_invoice_paid (records money + creates a fulfilment order), void_invoice, reprice_unit, mark_unit_sold, relist_unit, sync_inventory. Before any WRITE action, briefly restate exactly what you're about to do (customer, amounts, SKUs, prices) and ask the owner to confirm. Only call the tool after they say yes. If they've clearly already confirmed the specifics in their message, you may proceed.
- Never invent a SKU, price, or invoice number. Always search_inventory first to get the real SKU and current price before invoicing or repricing a unit.
- Messages may arrive as auto-transcribed voice notes, so appliance brand and model names can come through slightly garbled (e.g. "Whirlpool" → "workflow", "Frigidaire" → "fridge air", "KitchenAid" → "kitchen aid", "Maytag" → "may tag"). When a word looks like a mangled appliance brand or model, infer the most likely intended one from context and proceed; if you take an action on it, state which brand/model you assumed so the owner can correct you.
- Money is in Canadian dollars. Invoices add 13% HST by default unless told otherwise.
- After a WRITE action completes, report the concrete result plainly: the invoice number and total, the new price, the order number, etc.
- Be warm and personable while staying concise and practical — a friendly, sharp right-hand. Lead with the outcome. Keep replies short — a sentence or two is ideal, since they may be heard as a voice note while the owner is driving — but keep them friendly, not clipped. Avoid long lists, tables, links, or SKUs read out character-by-character unless asked. Use the customer's email exactly as given.
- If a tool returns an error, tell the owner what went wrong in plain language and suggest the fix.

Be genuinely helpful across everything operations — advising the team, thinking through problems, drafting messages and replies. You can take real actions on invoicing and inventory with your tools, and save guidance with remember. For things you can't yet do automatically for them (sending emails on the owner's behalf, reaching out to customers directly, pulling reports), still help fully — talk it through, write the wording they need, give the answer — and note that the automated version is on the way rather than refusing.`;
