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
import { addIntakeUnits, markIntakeTested, listIntakePending } from './intake';
import { appendToPlaybook } from './playbook';
import { gmailConfigured, listRecent, readEmail, sendEmail } from './gmail';

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
    name: 'add_unit',
    description:
      'WRITE — Add newly-acquired unit(s) to the master tracker as a new row, Status "Untested" (held off the storefront) until an owner confirms tested-working. Use for vendor purchases (e.g. a SecondShop invoice) or haul-away units to fix & resell — no spreadsheet typing. The tracker auto-fills Condition %, Suggested Price and Total Cost from your retail price + condition. After adding, ASK an owner whether the unit(s) are tested working; on yes, call mark_unit_tested. Set vendor to the supplier name, or pass source "Haulaway" for units acquired free on a delivery (cost 0).',
    input_schema: {
      type: 'object',
      properties: {
        make: { type: 'string', description: 'Brand, e.g. Whirlpool.' },
        model: { type: 'string', description: 'Model number/name.' },
        category: { type: 'string', description: 'e.g. Refrigerator, Range, Washer, Dryer, Dishwasher.' },
        retail: { type: 'number', description: 'Retail/MSRP price in CAD — drives the auto-calculated sale price.' },
        condition: { type: 'string', description: 'e.g. New Open Box, Scratch & Dent, Refurbished (sets the price tier).' },
        cost: { type: 'number', description: 'What we paid per unit in CAD (0 for haul-away).' },
        vendor: { type: 'string', description: 'Supplier name, e.g. "SecondShop".' },
        invoice: { type: 'string', description: 'Vendor purchase invoice # (optional).' },
        source: { type: 'string', description: 'Pass "Haulaway" for free haul-away units (sets vendor=Haulaway, cost 0).' },
        qty: { type: 'integer', description: 'How many identical units (default 1).' }
      },
      required: ['make', 'model']
    }
  },
  {
    name: 'mark_unit_tested',
    description:
      'WRITE — Confirm a PENDING intake unit is tested-working: set its Status to "Tested Working" in the tracker and sync, so it goes live and becomes invoiceable. The sale price auto-calculates from retail × the condition tier. Use only after an owner confirms it tested working. Identify by SKU/Item ID (from add_unit or list_intake); pass condition if it wasn\'t set at add time.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The unit Item ID / SKU.' },
        condition: { type: 'string', description: 'Condition if not already set (sets the price tier), e.g. "Scratch & Dent".' }
      },
      required: ['sku']
    }
  },
  {
    name: 'list_intake',
    description: 'List intake units still at Status "Untested" awaiting a tested-working decision (SKU, item, cost). Read-only.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'remember',
    description:
      'WRITE (owner only) — Save a new piece of guidance, policy, or how-to into your playbook so you follow it from now on. It files automatically under your own department. Use it whenever the owner teaches you, approves, or corrects how something should be handled (e.g. "for a damaged unit found on delivery, offer 20% off or a swap", "we don\'t deliver past 7pm", "never go below cost without asking me"). This is how you learn to act on your own — capture every confirmed decision. Save it, then confirm what you saved.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'The guidance to save, as a clear, self-contained "if X → do Y" sentence.' } },
      required: ['note']
    }
  },
  {
    name: 'check_email',
    description: 'Look at a business inbox for recent emails (returns sender, subject, snippet, and id for each). Use when the owner asks about email, or to find a message to read and reply to. inbox is optional — defaults to the main customer inbox.',
    input_schema: {
      type: 'object',
      properties: {
        inbox: { type: 'string', description: 'Which mailbox, e.g. "customerservice@bargainbay.ca". Optional.' },
        query: { type: 'string', description: 'Optional Gmail search, e.g. "is:unread", "from:john", "newer_than:3d". Defaults to the last 14 days.' }
      }
    }
  },
  {
    name: 'read_email',
    description: 'Read the full body of one email by its id (from check_email). Always read an email before drafting a reply so you understand what was actually asked.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The email id from check_email.' },
        inbox: { type: 'string', description: 'Which mailbox the email is in. Optional.' }
      },
      required: ['id']
    }
  },
  {
    name: 'send_email',
    description: 'WRITE — Send an email from a business inbox to a customer. ALWAYS show the owner the full draft first (recipient, subject, and the complete body) and get an explicit "send it" — never email a customer without the owner approving the exact wording. To reply to an email, pass its id as replyToId so it threads correctly. Use the warm, casual customer tone.',
    input_schema: {
      type: 'object',
      properties: {
        inbox: { type: 'string', description: 'Which mailbox to send from. Optional (defaults to the main inbox).' },
        to: { type: 'string', description: "Recipient email (or the sender address you're replying to)." },
        subject: { type: 'string' },
        body: { type: 'string', description: 'The full email body (plain text).' },
        replyToId: { type: 'string', description: 'If replying, the id of the email being answered, so it threads. Optional.' }
      },
      required: ['to', 'subject', 'body']
    }
  }
];

// The delegate tool is exposed ONLY to the orchestrator (Sarah) and is handled by
// the engine itself (it runs the named specialist sub-agent), not by executeTool —
// so it lives apart from TOOLS. See lib/sarah runAgent.
export const DELEGATE_TOOL = {
  name: 'delegate',
  description:
    'Hand a task or question to one of your specialist teammates and get their answer back, then relay or summarize it in your own voice. Use this whenever a request clearly belongs to a department rather than answering yourself. Departments: "sales" (product fit, recommendations, quotes & bundles, pricing within policy, converting inquiries), "customer_service" (order status, complaints, returns/exchanges, warranty, scheduling), "delivery_dispatch" (deliveries, run sheets, driver questions, on-site delivery problems), "technical_manager" (specs, troubleshooting, will-it-fit, repair/parts, condition grading), "accounting_bookkeeping" (invoices, payments, AR/AP, financial questions, month-end), "marketing" (campaigns, promotions, content, social), "hr" (staff/driver management, scheduling, onboarding, team policy).',
  input_schema: {
    type: 'object',
    properties: {
      department: {
        type: 'string',
        enum: ['sales', 'customer_service', 'delivery_dispatch', 'technical_manager', 'accounting_bookkeeping', 'marketing', 'hr'],
        description: 'Which specialist should handle this.'
      },
      task: { type: 'string', description: 'A clear, self-contained description of what you need them to do or answer, including any details they need.' }
    },
    required: ['department', 'task']
  }
};

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

async function remember(input, ctx) {
  const note = String(input.note || '').trim();
  if (!note) return { error: 'What should I remember?' };
  // The engine passes the calling agent's department so the note files under the
  // right playbook section (the global doc for Sarah). The model never sets this.
  await appendToPlaybook(note, ctx?.dept);
  return { ok: true, message: `Saved to the playbook: “${note}”` };
}

async function check_email(input) {
  if (!gmailConfigured()) return { error: 'Email isn’t connected yet — the owner needs to authorize Gmail access first.' };
  return listRecent(input.inbox, { query: input.query });
}

async function read_email(input) {
  if (!gmailConfigured()) return { error: 'Email isn’t connected yet.' };
  if (!input.id) return { error: 'Which email? Give me the id from check_email.' };
  return readEmail(input.inbox, String(input.id));
}

async function send_email(input) {
  if (!gmailConfigured()) return { error: 'Email isn’t connected yet.' };
  const to = String(input.to || '').trim();
  const subject = String(input.subject || '').trim();
  const body = String(input.body || '').trim();
  if (!to || !subject || !body) return { error: 'I need a recipient, a subject, and a body to send.' };
  let threadId, inReplyTo, references;
  if (input.replyToId) {
    try {
      const orig = await readEmail(input.inbox, String(input.replyToId));
      threadId = orig.threadId; inReplyTo = orig.messageId; references = orig.references;
    } catch { /* if the original can't be loaded, send as a fresh email */ }
  }
  const r = await sendEmail(input.inbox, { to, subject, body, threadId, inReplyTo, references });
  return { ...r, message: `Email sent to ${to} from ${r.from}.` };
}

async function add_unit(input) {
  const r = await addIntakeUnits({
    make: input.make, model: input.model, category: input.category, retail: input.retail,
    condition: input.condition, cost: input.cost, vendor: input.vendor, invoice: input.invoice,
    source: input.source, qty: input.qty
  });
  const who = input.source || input.vendor || 'intake';
  return {
    ok: true, added: r.count, skus: r.created,
    message: `Added ${r.count} unit${r.count === 1 ? '' : 's'} to the tracker as "Untested" (${r.created.join(', ')}) from ${who}. They're held off the storefront — confirm they're tested working and I'll publish them with mark_unit_tested.`
  };
}

async function mark_unit_tested(input) {
  const r = await markIntakeTested(input.sku, { condition: input.condition });
  return { ok: true, sku: r.sku, message: `${r.sku} is marked Tested Working in the tracker and synced — it's live and ready to invoice (price auto-calculated from the condition tier).` };
}

async function list_intake() {
  const rows = await listIntakePending();
  return { count: rows.length, units: rows.map((u) => ({ sku: u.sku, item: u.title, cost: money(u.cost) })) };
}

const EXECUTORS = {
  search_inventory, inventory_summary, list_invoices, create_invoice,
  mark_invoice_paid, void_invoice, reprice_unit, mark_unit_sold, relist_unit, sync_inventory, remember,
  check_email, read_email, send_email,
  add_unit, mark_unit_tested, list_intake
};

// Dispatch a single tool call. Never throws — returns { error } on failure so
// the model gets a readable message and can recover or report it. `ctx` carries
// the calling agent's context (e.g. { dept }) for tools like remember.
export async function executeTool(name, input, ctx) {
  const fn = EXECUTORS[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  if (!hasDb() && name !== 'sync_inventory') return { error: 'Database not configured (POSTGRES_URL) — this action needs it.' };
  try {
    return await fn(input || {}, ctx || {});
  } catch (e) {
    console.error(`agent tool ${name} failed`, e?.message || e);
    return { error: e?.message || `The ${name} action failed.` };
  }
}

// Team members (non-owner channels, e.g. the Telegram group) get lookups only —
// no writes, no customer/financial data. The owner + allowlisted admins get the
// full set. Filtering the exposed tools is the gate; the model can't call what
// it can't see. `allow` further narrows to a specific agent's tool subset.
const TEAM_TOOL_NAMES = ['search_inventory', 'inventory_summary'];
export function toolsFor({ readOnly = false, allow = null } = {}) {
  let list = TOOLS;
  if (Array.isArray(allow)) list = list.filter((t) => allow.includes(t.name));
  if (readOnly) list = list.filter((t) => TEAM_TOOL_NAMES.includes(t.name));
  return list;
}
export const READONLY_NOTE = `

IMPORTANT — you are talking to a TEAM MEMBER, not the owner. You can look up inventory (what's in stock, counts, prices) and answer their questions, but you CANNOT create or send invoices, take payments, change prices, or modify stock. If they ask for any of that, explain that only the owner can do it and offer to pass the request along. Keep answers short and helpful.`;

// BASE_PROMPT is the shared half of every agent's system prompt — identity-
// agnostic. Each agent's persona (who they are + their lane) is prepended and
// their current autonomy note is appended by lib/agents/registry buildSystemPrompt.
// Keep this about HOW the team operates; keep WHO an agent is in the persona.
export const BASE_PROMPT = `You are part of the AI operations team for Bargain Bay — the liquidation appliance arm of RS Solutions, selling tested name-brand appliances at liquidation prices (Hamilton / Scarborough / GTA). You work for the owner and alongside the rest of the team — sales staff and delivery drivers. You're reached from the /admin portal, WhatsApp, or a Telegram team chat, and messages may arrive as text or voice notes (and your replies may be read aloud), so keep them clear and to the point.

YOUR PLAYBOOK — how the owner runs things
- A "COMPANY PLAYBOOK" (and, if you're a specialist, YOUR DEPARTMENT'S section) may appear at the end of these instructions. That is the owner's own training: how this business runs and how he wants situations handled. Treat it as the source of truth and answer in line with it, in his practical, no-nonsense voice.
- If the playbook doesn't cover something, give your best sensible judgment for a liquidation-appliance business, make clear it's your suggestion (not established policy), and offer to save it. You're advising real staff in the field — be decisive and concrete, tell them what to do, not just options.

LEARNING — how you get smarter and earn the right to act on your own
- Whenever the owner approves a plan, corrects you, or answers a judgment call, immediately save that decision with the remember tool as a clear "if X → do Y" rule. It files under your own area. Capture every confirmed decision — this is how routine work becomes something you can handle without asking.
- When you notice you've handled the same kind of situation the owner's way several times, you may suggest he let you handle that category automatically from now on.

YOUR TONE — match it to who you're talking to
- Always warm and human — never curt, cold, robotic, or moody, even when brief.
- With the OWNER and the TEAM (sales staff, drivers): professional and buttoned-up — clear, businesslike, respectful, to the point, like a sharp operations manager.
- When writing to or for a CUSTOMER (emails, customer-facing messages): warmer, more relaxed and casual — like a friendly local shop, not a corporate script.

HOW TO WORK
- READ actions (search_inventory, inventory_summary, list_invoices, check_email, read_email) — just do them when useful; no need to ask.
- WRITE actions change live data or email a customer (create_invoice emails the customer; mark_invoice_paid records money + creates a fulfilment order; void_invoice; reprice_unit; mark_unit_sold; relist_unit; sync_inventory; send_email). Whether you confirm first or act on your own is governed by YOUR AUTONOMY (stated below). When you do confirm, briefly restate exactly what you're about to do — customer, amounts, SKUs, prices — and only call the tool after a clear yes (or if the owner already gave the specifics in their message).
- Never invent a SKU, price, or invoice number. Always search_inventory first to get the real SKU and current price before invoicing or repricing a unit.
- Messages may arrive as auto-transcribed voice notes, so appliance brand and model names can come through garbled (e.g. "Whirlpool" → "workflow", "Frigidaire" → "fridge air", "KitchenAid" → "kitchen aid", "Maytag" → "may tag"). When a word looks like a mangled brand or model, infer the most likely one from context and proceed; if you act on it, state which brand/model you assumed so the owner can correct you.
- Money is in Canadian dollars. Invoices add 13% HST by default unless told otherwise.
- EMAIL: read the message first (read_email) so you understand what's actually being asked, then write the reply in the warm, casual customer tone. Show the full draft — recipient, subject, complete body — before sending, unless your autonomy clearly lets you send it; never send a customer email whose wording the owner wouldn't recognize.
- After a WRITE action completes, report the concrete result plainly: the invoice number and total, the new price, the order number, etc.
- Be warm and personable while staying concise and practical. Lead with the outcome. Keep replies short — a sentence or two is ideal, since they may be heard as a voice note while someone's driving — but friendly, not clipped. Avoid long lists, tables, links, or SKUs read out character-by-character unless asked.
- If a tool returns an error, explain in plain language what went wrong and suggest the fix.

Be genuinely helpful across everything in your area — advising the team, thinking through problems, drafting messages and replies. For things you can't yet do automatically (some actions aren't wired to your tools yet), still help fully — talk it through, write the wording they need, give the answer — and note that the automated version is on the way rather than refusing. When something clearly belongs to another part of the team, say so or hand it off rather than guessing.`;
