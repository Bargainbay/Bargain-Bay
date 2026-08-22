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
  createAndSendInvoice, listInvoices, markInvoicePaid, recordInvoicePayment, voidInvoice, refundInvoice, refundInvoiceItems, deleteInvoice,
  backfillInvoiceOrder, backfillAllInvoiceOrders, getInvoiceByNumber, PAYMENT_METHODS
} from './invoices';
import { upsertClearance } from './clearance';
import { markUnitsSold, reactivateUnit, syncInventoryFromTracker } from './catalog-sync';
import { addIntakeUnits, markIntakeTested, listIntakePending } from './intake';
import { logLabor, payrollReport } from './payroll';
import { addExpense, listExpenses, addRecurringExpense, listRecurringExpenses, EXPENSE_CATEGORIES } from './finance';
import { weeklyPnl } from './finance-report';
import { appendToPlaybook } from './playbook';
import { gmailConfigured, listRecent, readEmail, sendEmail } from './gmail';
import { listCustomers, getCustomerProfile } from './customers';
import { refundOrder } from './orders';

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
    description:
      'List or SEARCH invoices — number, customer, status (open/partial/paid/void/refunded), total, and any linked BB fulfilment order. With no arguments it returns the most recent. Pass `search` to look through EVERY invoice ever raised (matches the INV- number, the BB- order number, customer name/email/phone, the memo, and any line item\'s description or SKU) and `status` to narrow it — use status "unpaid" for everything still owing money.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Free text: an INV-/BB- number, customer name, email, phone, or an appliance/SKU on the invoice.' },
        status: { type: 'string', enum: ['unpaid', 'open', 'partial', 'paid', 'refunded', 'void'], description: 'Narrow to one status. "unpaid" = open + partly paid (anything still owing).' },
        limit: { type: 'integer', description: 'How many to return (default 15, max 50).' }
      }
    }
  },
  {
    name: 'lookup_customer',
    description:
      'Look a client up in the customer database by name, email, or phone. Returns their contact details (incl. last known delivery address), lifetime spend, order count, owner notes, and their recent orders / open invoices. Use it to answer "what has X bought from us", to grab a customer\'s email/phone/address before invoicing or quoting them, or to check purchase history before a deal.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name, email, or phone (or a fragment), e.g. "theva" or "905-555".' } },
      required: ['query']
    }
  },
  {
    name: 'create_invoice',
    description:
      'WRITE — Create and EMAIL an itemized invoice to a customer (they pay by Interac e-transfer or in person). Confirm the customer email, line items, amounts, and HST with the owner before calling. Amounts are in CAD dollars. For any line that is an inventory unit, FIRST call search_inventory and use the real internal SKU it returns (e.g. "RS-0608-083") — a manufacturer model number (e.g. "KRSF536RPS") is NOT a SKU and will not link the unit\'s cost. If a unit isn\'t in inventory (a fresh purchase not yet in the tracker), get the purchase invoice # and cost from the owner and add_unit FIRST, then invoice. Lines with no SKU are treated as ad-hoc/service lines (delivery, install).',
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
              sku: { type: 'string', description: 'Real internal inventory SKU (from search_inventory) if this line is a stocked unit.' },
              cost: { type: 'number', description: 'Your cost for this unit (CAD). Provide this for a unit that ISN\'T in inventory yet (a fresh purchase) so the sale\'s margin is correct.' }
            },
            required: ['description', 'amount']
          }
        },
        addHst: { type: 'boolean', description: 'Add 13% HST (default true).' },
        daysUntilDue: { type: 'integer', description: 'Days until the invoice is due (default 14).' },
        invoiceDate: { type: 'string', description: 'Backdate the invoice to this date, "YYYY-MM-DD" (for a sale rung up late). Past dates only, up to 2 years back. Revenue counts on the PAID date — pass paidDate to mark_invoice_paid too for a backdated sale.' },
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
      'WRITE — Mark an open invoice paid. This records the payment, delists any units on it as sold, and creates a confirmed fulfilment order. Confirm with the owner first. Identify the invoice by invoiceNumber (e.g. "INV-1042") or numeric invoiceId. For a sale that happened on an earlier day, pass paidDate — that is the day the revenue counts on. On an ALREADY-paid invoice, calling this with a paidDate re-dates the payment (fixes a sale recorded on the wrong day).',
    input_schema: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number like "INV-1042".' },
        invoiceId: { type: 'integer', description: 'Numeric invoice id (alternative to invoiceNumber).' },
        method: { type: 'string', enum: Object.keys(PAYMENT_METHODS), description: 'How it was paid.' },
        paidDate: { type: 'string', description: 'When the money actually landed, "YYYY-MM-DD" (default today). Backdate for a late-recorded sale so revenue lands on the right day.' }
      },
      required: ['method']
    }
  },
  {
    name: 'record_invoice_payment',
    description:
      'WRITE — Record a PARTIAL payment (deposit / instalment) on an open invoice. The customer gets a receipt showing the amount received and the balance still owing; the invoice shows as "partial" until payments reach the total, at which point it automatically completes as fully paid (delists units, creates the fulfilment order, counts as revenue). If the amount equals the remaining balance this is the same as mark_invoice_paid. Confirm the amount and method before calling.',
    input_schema: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number like "INV-1061".' },
        invoiceId: { type: 'integer', description: 'Numeric invoice id (alternative to invoiceNumber).' },
        amount: { type: 'number', description: 'Dollar amount received (CAD). Must not exceed the balance owing.' },
        method: { type: 'string', enum: Object.keys(PAYMENT_METHODS), description: 'How it was paid.' },
        paidDate: { type: 'string', description: 'When the money landed, "YYYY-MM-DD" (default today). Backdate for a late-recorded payment.' },
        note: { type: 'string', description: 'Optional note, e.g. "deposit to hold until Friday".' }
      },
      required: ['amount', 'method']
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
    name: 'refund_invoice',
    description: 'WRITE — Refund a PAID invoice, fully or per-unit. With no skus, the WHOLE invoice is refunded: unit(s) relisted, linked fulfilment order cancelled, invoice marked refunded. Pass skus to refund ONLY those unit(s) (e.g. one appliance out of three comes back): they are relisted and their money (incl. HST share) comes off the recorded sale; the rest of the invoice stays paid. Confirm with the owner first.',
    input_schema: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number like "INV-1042".' },
        invoiceId: { type: 'integer', description: 'Numeric invoice id (alternative to invoiceNumber).' },
        skus: { type: 'array', items: { type: 'string' }, description: 'Refund only the line(s) with these SKUs (per-unit refund). Omit to refund the entire invoice.' }
      }
    }
  },
  {
    name: 'refund_order',
    description: 'WRITE — Refund a paid storefront ORDER (BB-####), fully or per-unit. With no skus the whole order is refunded (status → refunded, all units relisted, money off the dashboard); pass skus to refund only those unit(s). Orders that were created from an INVOICE are refused — use refund_invoice on that invoice instead (it syncs its order itself). Confirm with the owner first.',
    input_schema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string', description: 'Order number like "BB-1057".' },
        skus: { type: 'array', items: { type: 'string' }, description: 'Refund only the unit(s) with these SKUs. Omit to refund the entire order.' }
      },
      required: ['orderNumber']
    }
  },
  {
    name: 'delete_invoice',
    description: 'WRITE — Permanently delete an invoice created in error. Only works for UNPAID invoices (open or void). Paid invoices must be refunded instead, never deleted. Confirm with the owner first.',
    input_schema: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number like "INV-1042".' },
        invoiceId: { type: 'integer', description: 'Numeric invoice id (alternative to invoiceNumber).' }
      }
    }
  },
  {
    name: 'fix_invoice_dashboard',
    description: 'WRITE — Make a paid invoice show up in the revenue dashboard by back-filling its missing fulfilment order. The dashboard counts orders, so a paid invoice that never created one is invisible. Give an invoiceNumber to fix one, or set all=true to fix every paid invoice missing an order.',
    input_schema: {
      type: 'object',
      properties: {
        invoiceNumber: { type: 'string', description: 'Invoice number like "INV-1007" to fix just that one.' },
        all: { type: 'boolean', description: 'Fix every paid invoice that is missing an order.' }
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
    name: 'log_labor',
    description:
      "WRITE — Log a team member's work for payroll when they report it (e.g. \"tested 6, cleaned 4 today\" or \"worked 8 hours\"). Record unit counts (tested/cleaned/repaired) and/or hours. If the worker doesn't say a name and you don't otherwise know it, the message sender is used automatically. Don't log drivers' deliveries — those are counted automatically from the delivery records.",
    input_schema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: "The worker's name. Omit to use the person who sent the message." },
        tested: { type: 'integer', description: 'Units tested.' },
        cleaned: { type: 'integer', description: 'Units cleaned.' },
        repaired: { type: 'integer', description: 'Units repaired.' },
        hours: { type: 'number', description: 'Hours worked (optional).' },
        date: { type: 'string', description: 'Work date YYYY-MM-DD (default today).' },
        note: { type: 'string', description: 'Optional note.' }
      }
    }
  },
  {
    name: 'payroll_report',
    description: 'Get this week\'s payroll so far — per worker: units tested/cleaned/repaired, hours, deliveries, and pay owed (Mon–Sun). Pass weekOffset -1 for last week. Read-only.',
    input_schema: {
      type: 'object',
      properties: { weekOffset: { type: 'integer', description: '0 = this week (default), -1 = last week.' } }
    }
  },
  {
    name: 'log_expense',
    description:
      'WRITE — Record a business expense in the ledger (fuel, parts, storage, fees…) so it counts against profit on the Financial dashboard. Use when the owner says things like "log $80 gas" or "paid $200 for shelving". For a FIXED cost that repeats (rent, storage, a subscription), set recurring so it posts itself every cycle without being asked again.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Dollar amount (CAD).' },
        category: { type: 'string', enum: EXPENSE_CATEGORIES, description: 'Expense category. Pick the closest.' },
        vendor: { type: 'string', description: 'Who was paid (optional).' },
        date: { type: 'string', description: 'When it was incurred, YYYY-MM-DD (default today). Ignored for recurring.' },
        note: { type: 'string', description: 'Optional note.' },
        recurring: { type: 'string', enum: ['weekly', 'monthly'], description: 'Set to make this a repeating fixed cost instead of a one-off. Weekly posts every Monday; monthly posts on dayOf.' },
        dayOf: { type: 'integer', description: 'For recurring monthly: day of month it\'s due (1–28, default 1).' }
      },
      required: ['amount']
    }
  },
  {
    name: 'list_expenses',
    description: 'List recent logged expenses and the active recurring (auto-posting) ones. Read-only.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many recent expenses (default 20, max 100).' } }
    }
  },
  {
    name: 'finance_report',
    description:
      'Get the weekly P&L — what the business actually made: revenue, cost of goods, gross profit, labor (payroll), expenses, ad spend, and NET profit for a Mon–Sun week, plus what customers still owe. Use when the owner asks "how did we do this week", "what did I net", "what are my expenses", etc. Read-only.',
    input_schema: {
      type: 'object',
      properties: { weekOffset: { type: 'integer', description: '0 = this week so far (default), -1 = last week, -2 = two weeks ago…' } }
    }
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

// Specialist → Sarah escalation. A department manager uses this when a decision
// is beyond their authority or the playbook doesn't cover it. Sarah answers from
// the playbook if she can, otherwise asks the owners and relays their call back.
export const ESCALATE_TOOL = {
  name: 'escalate',
  description:
    "Bring a decision up to Sarah (your Chief of Staff) when it's beyond your authority or the playbook doesn't cover it — e.g. an unusually deep discount, an out-of-policy request, a money-or-relationship judgment call. Sarah will decide if she can, or ask the owners and relay their answer back to this chat. Don't use this for routine work you can handle yourself.",
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'A clear, self-contained summary of the decision needed and the relevant details, written so Sarah (and the owner) can answer without more back-and-forth.' }
    },
    required: ['question']
  }
};

// Sarah → owners. Sarah uses this when a manager's escalation genuinely needs an
// owner's call. It posts the question to the Management group; the owner's reply
// is relayed back to the originating chat (and saved to the playbook).
export const ASK_OWNER_TOOL = {
  name: 'ask_owner',
  description:
    "Ask the owners for a decision you can't make from the playbook. Posts the question to the Management group where the owners answer; their reply is relayed back to whoever raised it. Use only for genuine owner-level calls (money, policy not covered, unusual deals); answer from the playbook yourself whenever you can.",
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The decision needed, summarised clearly with the relevant details for the owner.' }
    },
    required: ['question']
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

  let all;
  try { all = await getAll({ strict: true }); }
  catch { return { error: "I can't reach the live inventory right now, so I won't guess from old data — give me a moment and ask again. (Don't tell the customer we're out of something based on this.)" }; }
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
  let all;
  try { all = await getAll({ strict: true }); }
  catch { return { error: "I can't reach the live inventory right now — try again in a moment (I won't report stale numbers)." }; }
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

async function list_invoices({ limit, search, status }) {
  const { invoices: rows, total, owing } = await listInvoices({
    limit: Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50),
    q: search || '',
    status: status || ''
  });
  return {
    count: rows.length,
    matching: total,
    stillOwing: money(owing),
    invoices: rows.map((r) => ({
      id: r.id, number: r.number, customer: r.name || r.email, email: r.email,
      status: r.status, total: money(r.total), paidVia: r.method || null,
      order: r.orderNumber || null, due: r.due
    }))
  };
}

async function refund_order({ orderNumber, skus }) {
  const number = String(orderNumber || '').trim();
  if (!number) return { error: 'Which order? Give me the BB- order number.' };
  const r = await refundOrder(number, { skus: Array.isArray(skus) ? skus : [] });
  return {
    ok: true, order: r.orderNumber, status: r.status,
    refunded: money(r.refundAmount), relisted: r.relisted,
    note: r.fullyRefunded
      ? 'Fully refunded — units are back on sale and the sale is off the books.'
      : `Refunded ${r.refundedItems} unit(s); the rest of the order stays as sold.`
  };
}

async function lookup_customer({ query: q }) {
  const needle = String(q || '').trim();
  if (needle.length < 2) return { error: 'Give me at least 2 characters of a name, email, or phone to search for.' };
  const matches = await listCustomers({ q: needle, limit: 5 });
  if (!matches.length) return { found: 0, message: `No customer matching "${needle}" in the client database.` };

  // Full detail for the best match; the rest come back as a short disambiguation list.
  const top = await getCustomerProfile(matches[0].id).catch(() => null);
  return {
    found: matches.length,
    customers: matches.map((c) => ({
      name: c.name || '(no name)', email: c.email, phone: c.phone || null, city: c.city || null,
      orders: c.orders, totalSpent: money(c.spent),
      lastOrder: c.lastOrder ? c.lastOrder.slice(0, 10) : null,
      member: c.memberStatus === 'approved' || undefined
    })),
    topMatch: top ? {
      name: top.name || null, email: top.email, phone: top.phone || null,
      address: [top.address, top.city, top.postal].filter(Boolean).join(', ') || null,
      notes: top.notes || null,
      totalSpent: money(top.spent), orders: top.orders,
      recentOrders: top.history.orders.slice(0, 5).map((o) => ({
        number: o.number, status: o.status, total: money(o.total),
        date: o.createdAt ? o.createdAt.slice(0, 10) : null,
        items: (o.items || []).map((it) => it.title).join(' · ')
      })),
      openInvoices: top.history.invoices.filter((i) => i.status === 'open')
        .map((i) => ({ number: i.number, total: money(i.total) })),
      openQuotes: top.history.quotes.filter((x) => x.status === 'open')
        .map((x) => ({ number: x.number, total: money(x.total) }))
    } : null
  };
}

async function create_invoice(input) {
  // Resolve each UNIT line (one carrying a sku) against live inventory so a model
  // number typed as a SKU is corrected to the real internal SKU (and its cost
  // links). A unit we can't match is NOT invoiced silently — Sarah is told to pick
  // the real unit, or capture the purchase invoice # + cost and add_unit first.
  let stock = [];
  try { stock = await getAll(); } catch { stock = []; }
  const norm = (s) => String(s || '').trim().toLowerCase();
  const resolve = (sku, desc) => {
    const s = norm(sku);
    if (!s) return { ok: true };
    const exact = stock.find((u) => norm(u.id) === s);
    if (exact) return { ok: true, sku: exact.id };
    const byModel = stock.filter((u) => norm(u.model) === s || (s.length >= 4 && norm(u.title).includes(s)));
    if (byModel.length === 1) return { ok: true, sku: byModel[0].id };
    if (byModel.length > 1) return { ok: false, ambiguous: byModel.slice(0, 5).map((u) => ({ sku: u.id, title: u.title })) };
    return { ok: false };
  };

  const items = [];
  const unresolved = [];
  for (const it of (Array.isArray(input.items) ? input.items : [])) {
    const c = Number(it.cost);
    const line = {
      description: String(it.description || '').trim(),
      amount: Number(it.amount),
      sku: it.sku ? String(it.sku).trim() : undefined,
      cost: Number.isFinite(c) && c >= 0 ? c : undefined
    };
    if (line.sku) {
      const r = resolve(line.sku, line.description);
      if (r.ok) line.sku = r.sku || line.sku;
      // Unmatched unit: allow ONLY if a cost was captured for it (off-tracker
      // unit). Otherwise refuse so a model-number-as-SKU never slips through.
      else if (line.cost == null) { unresolved.push({ sku: line.sku, description: line.description, ambiguous: r.ambiguous }); continue; }
    }
    items.push(line);
  }
  if (unresolved.length) {
    return {
      ok: false, needsResolution: unresolved,
      error: `I couldn't match ${unresolved.map((u) => `"${u.sku}"`).join(', ')} to a unit in inventory — a manufacturer model number is NOT a SKU. ` +
        `For a unit we stock, find it with search_inventory and use its real internal SKU (e.g. RS-0608-083). ` +
        `If it's a unit just purchased and not in the tracker yet, ask the owner for the purchase invoice # and the unit cost, then re-call create_invoice including that cost on the line (and add_unit so it's logged in the tracker). I did NOT create this invoice.`
    };
  }

  const inv = await createAndSendInvoice({
    name: input.name, email: input.email, items,
    addHst: input.addHst !== false,
    daysUntilDue: input.daysUntilDue,
    memo: input.memo,
    deliveryMethod: input.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
    address: input.address, city: input.city, postal: input.postal, phone: input.phone,
    invoiceDate: input.invoiceDate
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
  const r = await markInvoicePaid(id, method, input.paidDate);
  if (r.status !== 'paid') return { ok: false, status: r.status, message: `Invoice ${r.number} is ${r.status}, not open — nothing changed.` };
  return {
    ok: true, invoiceNumber: r.number, paidVia: r.method, unitsDelisted: r.soldSkus,
    order: r.orderNumber || null,
    message: `Invoice ${r.number} marked paid (${r.method}).` + (r.orderNumber ? ` Fulfilment order ${r.orderNumber} created.` : '')
  };
}

async function record_invoice_payment(input) {
  const id = await resolveInvoiceId(input);
  if (!id) return { error: 'Invoice not found — give a valid invoiceNumber (e.g. "INV-1061") or invoiceId.' };
  const r = await recordInvoicePayment(id, {
    amount: input.amount, method: String(input.method || '').trim(),
    paidDate: input.paidDate, note: input.note
  });
  if (r.fullyPaid) {
    return {
      ok: true, invoiceNumber: r.number, status: 'paid', order: r.orderNumber || null,
      message: `That covered the full balance — invoice ${r.number} is now PAID (${r.method}).` + (r.orderNumber ? ` Fulfilment order ${r.orderNumber} created.` : '')
    };
  }
  return {
    ok: true, invoiceNumber: r.number, status: 'partial', amountReceived: money(r.amount),
    paidToDate: money(r.amountPaid), balanceOwing: money(r.balance),
    message: `Recorded ${money(r.amount)} (${r.method}) on ${r.number} — ${money(r.balance)} still owing. Receipt with the balance emailed to the customer.`
  };
}

async function void_invoice(input) {
  const id = await resolveInvoiceId(input);
  if (!id) return { error: 'Invoice not found — give a valid invoiceNumber or invoiceId.' };
  const v = await voidInvoice(id);
  if (!v) return { ok: false, message: 'Only an open invoice can be voided — nothing changed.' };
  return { ok: true, invoiceNumber: v.number, message: `Invoice ${v.number} voided.` };
}

async function refund_invoice(input) {
  const id = await resolveInvoiceId(input);
  if (!id) return { error: 'Invoice not found — give a valid invoiceNumber or invoiceId.' };
  const skus = Array.isArray(input.skus) ? input.skus.map((s) => String(s).trim()).filter(Boolean) : [];
  try {
    // Per-unit refund: only the named SKU line(s) come back; the rest stays paid.
    // (Escalates to a full refund automatically when the skus cover every line.)
    if (skus.length) {
      const r = await refundInvoiceItems(id, { skus });
      if (r.fullyRefunded || r.status === 'refunded') {
        return { ok: true, invoiceNumber: r.number, status: 'refunded', fullyRefunded: true,
          message: `Those were the only line(s) left on ${r.number}, so the whole invoice is now refunded and its order cancelled.` };
      }
      return {
        ok: true, invoiceNumber: r.number, status: r.status, fullyRefunded: false,
        refundedItems: r.refundedItems, refundAmount: money(r.refundAmount), unitsRelisted: r.relisted,
        message: `Refunded ${r.refundedItems} line(s) of ${r.number} for ${money(r.refundAmount)} — unit(s) relisted, sale reduced accordingly. The rest of the invoice stays paid.`
      };
    }
    const r = await refundInvoice(id);
    return {
      ok: true, invoiceNumber: r.number, status: r.status, unitsRelisted: r.relisted, orderCancelled: r.orderCancelled,
      message: `Invoice ${r.number} refunded${r.orderCancelled ? ' and its order cancelled (removed from revenue)' : ''}.` + (r.relisted ? ` ${r.relisted} unit(s) relisted.` : '')
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function delete_invoice(input) {
  const id = await resolveInvoiceId(input);
  if (!id) return { error: 'Invoice not found — give a valid invoiceNumber or invoiceId.' };
  try {
    const r = await deleteInvoice(id);
    return { ok: true, invoiceNumber: r.number, message: `Invoice ${r.number} deleted permanently.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function fix_invoice_dashboard(input) {
  try {
    if (input.all) {
      const r = await backfillAllInvoiceOrders();
      return { ok: true, fixed: r.fixed, created: r.created,
        message: r.fixed ? `Added ${r.fixed} paid invoice(s) to the dashboard: ${r.created.map((c) => `${c.invoice}→${c.order}`).join(', ')}.` : 'All paid invoices already show in the dashboard.' };
    }
    const id = await resolveInvoiceId(input);
    if (!id) return { error: 'Give an invoiceNumber (e.g. "INV-1007") or set all=true.' };
    const r = await backfillInvoiceOrder(id);
    return { ok: true, invoiceNumber: r.number, order: r.orderNumber,
      message: r.alreadyLinked ? `Invoice ${r.number} already has order ${r.orderNumber} — it should be in the dashboard.` : `Invoice ${r.number} added to the dashboard as order ${r.orderNumber}.` };
  } catch (e) {
    return { error: e.message };
  }
}

async function reprice_unit(input) {
  const sku = String(input.sku || '').trim();
  const price = Number(input.price);
  if (!sku) return { error: 'Provide the unit SKU.' };
  if (!(price > 0)) return { error: 'Provide a positive price.' };
  const r = await upsertClearance({ sku, price, note: input.note, active: true });
  if (!r.found) return { ok: false, error: `No unit with SKU ${sku} exists — double-check the SKU (use search_inventory). Nothing was changed.` };
  return {
    ok: true, sku, newPrice: money(price),
    message: `${sku} repriced to ${money(price)} (clearance markdown applied).` + (r.productActive ? '' : ` Heads up: ${sku} isn't currently active on the storefront, so the markdown won't show until it's relisted.`)
  };
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
  if (!r.ok) return { ok: false, sku, message: `${sku} wasn't found in inventory — nothing was relisted. Check the SKU.` };
  return { ok: true, sku, cancelledOrders: r.cancelledOrders || 0, message: `${sku} relisted on the storefront.` };
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

async function log_labor(input, ctx) {
  const worker = input.worker || ctx?.senderName;
  const r = await logLabor({ worker, tested: input.tested, cleaned: input.cleaned, repaired: input.repaired, hours: input.hours, date: input.date, note: input.note, source: 'telegram' });
  const bits = [];
  if (input.tested) bits.push(`${input.tested} tested`);
  if (input.cleaned) bits.push(`${input.cleaned} cleaned`);
  if (input.repaired) bits.push(`${input.repaired} repaired`);
  if (input.hours) bits.push(`${input.hours}h`);
  return { ok: true, worker: r.worker, date: r.date, message: `Logged${bits.length ? ' ' + bits.join(', ') : ''} for ${r.worker} (${r.date}).` };
}

async function payroll_report(input) {
  const rep = await payrollReport({ weekOffset: input?.weekOffset || 0 });
  if (!rep) return { error: 'No database.' };
  return {
    week: rep.weekOffset === 0 ? 'this week' : `${Math.abs(rep.weekOffset)} week(s) ago`,
    total: money(rep.total),
    workers: rep.workers.map((w) => ({ worker: w.worker, tested: w.tested, cleaned: w.cleaned, repaired: w.repaired, hours: w.hours, deliveries: w.deliveries, pay: money(w.amount) }))
  };
}

async function log_expense(input) {
  const amount = Number(input.amount);
  if (!(amount > 0)) return { error: 'Give a positive dollar amount.' };
  const category = EXPENSE_CATEGORIES.includes(input.category) ? input.category : 'Other';
  if (input.recurring === 'weekly' || input.recurring === 'monthly') {
    const id = await addRecurringExpense({ category, vendor: input.vendor, amount, cadence: input.recurring, dayOf: input.dayOf, note: input.note });
    return {
      ok: true, id, recurring: input.recurring,
      message: `Set up a ${input.recurring} recurring expense: ${money(amount)} ${category}${input.vendor ? ` (${input.vendor})` : ''} — it posts itself every cycle from now on.`
    };
  }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? input.date
    : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const id = await addExpense({ incurredOn: d, category, vendor: input.vendor, amount, note: input.note });
  return { ok: true, id, message: `Logged ${money(amount)} ${category}${input.vendor ? ` (${input.vendor})` : ''} on ${d}.` };
}

async function list_expenses(input) {
  const limit = Math.min(Math.max(parseInt(input?.limit, 10) || 20, 1), 100);
  const [rows, rec] = await Promise.all([listExpenses(limit), listRecurringExpenses()]);
  return {
    count: rows.length,
    expenses: rows.map((r) => ({ date: r.incurredOn, category: r.category, vendor: r.vendor, amount: money(r.amount), note: r.note })),
    recurring: rec.map((r) => ({ category: r.category, vendor: r.vendor, amount: money(r.amount), repeats: r.cadence === 'weekly' ? 'weekly (Mon)' : `monthly day ${r.dayOf}` }))
  };
}

async function finance_report(input) {
  const p = await weeklyPnl({ weekOffset: input?.weekOffset || 0 });
  if (!p) return { error: 'No database.' };
  return {
    week: `${p.weekStart} to ${p.weekEnd}${p.weekOffset === 0 ? ' (so far)' : ''}`,
    revenue: money(p.revenue), orders: p.orders, units: p.units,
    costOfGoods: money(p.cogs), grossProfit: money(p.grossProfit),
    labor: money(p.labor), expenses: money(p.expenses),
    expensesByCategory: p.expensesByCategory.map((e) => ({ category: e.category, amount: money(e.amount) })),
    adSpend: money(p.adSpend),
    NET: money(p.netProfit),
    owedByCustomers: money(p.owed), owedOverdue: money(p.owedOverdue),
    hstCollected: money(p.hstCollected),
    caveats: [
      p.expenses === 0 ? 'No expenses logged this week — net may be overstated.' : null,
      p.labor === 0 ? 'No labor recorded this week — net may be overstated.' : null
    ].filter(Boolean)
  };
}

const EXECUTORS = {
  search_inventory, inventory_summary, list_invoices, lookup_customer, create_invoice,
  mark_invoice_paid, record_invoice_payment, void_invoice, refund_invoice, refund_order, delete_invoice, fix_invoice_dashboard, reprice_unit, mark_unit_sold, relist_unit, sync_inventory, remember,
  check_email, read_email, send_email,
  add_unit, mark_unit_tested, list_intake,
  log_labor, payroll_report,
  log_expense, list_expenses, finance_report
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
// Tools a read-only team member may use in a group. log_labor is included so the
// team can self-report their own work for payroll (low-risk; the owner reviews).
const TEAM_TOOL_NAMES = ['search_inventory', 'inventory_summary', 'log_labor'];
// Tools that change live data / money / stock or email a customer. Channels use
// this to build the deterministic "what actually happened" footer on replies —
// the model can't fake or suppress it. (remember is a write too but harmless
// playbook housekeeping; listing it would just be noise.)
export const WRITE_TOOL_NAMES = [
  'create_invoice', 'mark_invoice_paid', 'record_invoice_payment', 'void_invoice', 'refund_invoice', 'refund_order',
  'delete_invoice', 'fix_invoice_dashboard', 'reprice_unit', 'mark_unit_sold', 'relist_unit',
  'sync_inventory', 'add_unit', 'mark_unit_tested', 'log_labor', 'log_expense', 'send_email'
];
export function toolsFor({ readOnly = false, allow = null } = {}) {
  let list = TOOLS;
  if (Array.isArray(allow)) list = list.filter((t) => allow.includes(t.name));
  if (readOnly) list = list.filter((t) => TEAM_TOOL_NAMES.includes(t.name));
  return list;
}
export const READONLY_NOTE = `

IMPORTANT — this chat gives you READ-ONLY tools. You can look up inventory (what's in stock, counts, prices) and answer questions, but you CANNOT create or send invoices, take payments, change prices, modify stock, or grant anyone access. If asked for any of that, NEVER pretend or say it's done — you don't have the tools here, and a fake confirmation loses real money. Say plainly that it needs Sean or Ravi (or the right department chat) and offer to pass the request along. Keep answers short and helpful.`;

// BASE_PROMPT is the shared half of every agent's system prompt — identity-
// agnostic. Each agent's persona (who they are + their lane) is prepended and
// their current autonomy note is appended by lib/agents/registry buildSystemPrompt.
// Keep this about HOW the team operates; keep WHO an agent is in the persona.
export const BASE_PROMPT = `You are part of the AI operations team for Bargain Bay — the liquidation appliance arm of RS Solutions, selling tested name-brand appliances at liquidation prices (Pickering / Durham Region / Scarborough / GTA; warehouse at 1135 Squires Beach Rd, Pickering, ON L1W 3T9, open 7 days 10am–8pm). You work for the owner and alongside the rest of the team — sales staff and delivery drivers. You're reached from the /admin portal, WhatsApp, or a Telegram team chat, and messages may arrive as text or voice notes (and your replies may be read aloud), so keep them clear and to the point.

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
- WRITE actions change live data or email a customer (create_invoice emails the customer; mark_invoice_paid records money + creates a fulfilment order; record_invoice_payment logs a deposit/instalment and emails a balance receipt; void_invoice; refund_invoice relists the unit(s) + cancels the order; delete_invoice permanently removes an unpaid invoice made in error; reprice_unit; mark_unit_sold; relist_unit; sync_inventory; send_email). Whether you confirm first or act on your own is governed by YOUR AUTONOMY (stated below). When you do confirm, briefly restate exactly what you're about to do — customer, amounts, SKUs, prices — and only call the tool after a clear yes (or if the owner already gave the specifics in their message).
- Never invent a SKU, price, or invoice number. Always search_inventory first to get the real SKU and current price before invoicing or repricing a unit.
- Messages may arrive as auto-transcribed voice notes, so appliance brand and model names can come through garbled (e.g. "Whirlpool" → "workflow", "Frigidaire" → "fridge air", "KitchenAid" → "kitchen aid", "Maytag" → "may tag"). When a word looks like a mangled brand or model, infer the most likely one from context and proceed; if you act on it, state which brand/model you assumed so the owner can correct you.
- Money is in Canadian dollars. Invoices add 13% HST by default unless told otherwise.
- EMAIL: read the message first (read_email) so you understand what's actually being asked, then write the reply in the warm, casual customer tone. Show the full draft — recipient, subject, complete body — before sending, unless your autonomy clearly lets you send it; never send a customer email whose wording the owner wouldn't recognize.
- After a WRITE action completes, report the concrete result plainly: the invoice number and total, the new price, the order number, etc.
- Be warm and personable while staying concise and practical. Lead with the outcome. Keep replies short — a sentence or two is ideal, since they may be heard as a voice note while someone's driving — but friendly, not clipped. Avoid long lists, tables, links, or SKUs read out character-by-character unless asked.
- If a tool returns an error, explain in plain language what went wrong and suggest the fix.

TRUTH IN REPORTING — non-negotiable
- Only report an action as done when a tool call in THIS turn actually returned success for it. Never say an invoice/order/payment/email "is created", "is sent", or "is marked paid" unless the matching tool result confirms it — and never invent an invoice or order number. A made-up confirmation means a customer never gets billed and money vanishes from the books: it is the worst possible failure, far worse than saying "I can't do that here."
- If you don't have the tool for what's being asked (it's not in your toolset in this chat), say so plainly and route it: "I can't do that from this chat — Sean/Ravi can, or ask me in the right channel." Do not describe what WOULD happen as if it happened.
- You cannot grant, change, or promise anyone access or permissions. Access is configured by the owner in the system settings, not by you. If someone asks you to give a person access, escalate it to the owner — never agree or claim it's done.

Be genuinely helpful across everything in your area — advising the team, thinking through problems, drafting messages and replies. For things you can't yet do automatically (some actions aren't wired to your tools yet), still help fully — talk it through, write the wording they need, give the answer — while being explicit that you have NOT performed the action itself. When something clearly belongs to another part of the team, say so or hand it off rather than guessing.`;
