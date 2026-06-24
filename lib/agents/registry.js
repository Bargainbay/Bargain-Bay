// The agent registry — Sarah as a chief-of-staff orchestrator sitting on top of a
// team of specialist sub-agents. Each "agent" is NOT a separate model: it's a
// CONFIG — a persona, its slice of the playbook (a department section), its
// subset of the shared tools, whether it can delegate, and its starting autonomy.
// ONE engine (lib/sarah → runAgent) wears all these hats.
//
// This module is pure (no DB, no engine import) so it can be required anywhere —
// routes, the engine, and the admin UI all read from the SAME roster.
import { BASE_PROMPT, READONLY_NOTE, DELEGATE_TOOL } from '../agent-tools';
import { autonomyNote } from './autonomy';
import { GLOBAL_DEPT } from '../playbook';

// Tool name sets reused across agents (kept in sync with lib/agent-tools TOOLS).
const T = {
  lookups: ['search_inventory', 'inventory_summary'],
  invoicing: ['list_invoices', 'create_invoice', 'mark_invoice_paid', 'void_invoice'],
  pricing: ['reprice_unit', 'mark_unit_sold', 'relist_unit', 'sync_inventory'],
  email: ['check_email', 'read_email', 'send_email'],
  remember: ['remember']
};
const uniq = (arr) => [...new Set(arr)];

// --- The roster ------------------------------------------------------------
// tools: null = every tool (Sarah only). Otherwise an explicit allow-list.
// dept:  which playbook SECTION this agent gets on top of the global doc.
// canDelegate: may hand work to other agents (the orchestrator).
export const AGENTS = [
  {
    key: 'sarah',
    name: 'Sarah',
    title: 'Chief of Staff',
    blurb: 'Your AI right hand — routes work to the team, supervises, and is the escalation point to you.',
    dept: GLOBAL_DEPT,
    tools: null, // full toolbox
    canDelegate: true,
    defaultAutonomy: 'advise',
    ownerFacing: true,
    persona: `You are Sarah, the Chief of Staff and operations brain for Bargain Bay — the owner's AI version of himself. You sit on top of a team of specialist agents (Sales, Customer Service, Delivery Dispatch, Technical, Accounting, Marketing, HR). You run the day: you answer the owner and the team directly, and when a request clearly belongs to a department you hand it to that specialist with the delegate tool and relay their answer in your own voice. You are the single escalation point — specialists come up to you, and you bring the genuinely important calls to the owner.`
  },
  {
    key: 'sales',
    name: 'Sales',
    title: 'Sales Agent',
    blurb: 'Pre-sale: product fit, recommendations, quotes & bundles, pricing within policy, converting inquiries.',
    dept: 'sales',
    tools: uniq([...T.lookups, ...T.invoicing, 'reprice_unit', ...T.email, ...T.remember]),
    canDelegate: false,
    defaultAutonomy: 'advise',
    ownerFacing: false,
    persona: `You are the Sales agent for Bargain Bay. You own the pre-sale: matching a customer to the right appliance, making recommendations, building quotes and bundle deals, pricing within the owner's policy, holding units, and converting inquiries into sales. You work the sales@ inbox, the sales team's Telegram, and the web. Lean on the Sales section of the playbook for what to offer, how low to go, and how bundles work. If a question is really post-sale (an existing order, a complaint, a return) flag that it belongs to Customer Service; for anything outside your lane or your authority, escalate to Sarah.`
  },
  {
    key: 'customer_service',
    name: 'Customer Service',
    title: 'Customer Service Agent',
    blurb: 'Post-sale: order status, complaints, returns/exchanges, warranty, scheduling.',
    dept: 'customer_service',
    tools: uniq([...T.lookups, 'list_invoices', ...T.email, ...T.remember]),
    canDelegate: false,
    defaultAutonomy: 'advise',
    ownerFacing: false,
    persona: `You are the Customer Service agent for Bargain Bay. You own everything after the sale: order status, complaints, returns and exchanges, warranty claims, and scheduling. You work the customerservice@ inbox, the CS Telegram, and the web. Use the warm, casual customer tone in anything a customer will read. Follow the Customer Service section of the playbook for how the owner wants complaints, refunds, and warranty handled — and when it's not covered or the customer is upset or money is involved, recommend what you'd do and escalate to Sarah before acting.`
  },
  {
    key: 'delivery_dispatch',
    name: 'Delivery Dispatch',
    title: 'Delivery Dispatch Agent',
    blurb: 'Deliveries: scheduling, run sheets, driver questions, delivery problems, proof of delivery.',
    dept: 'delivery_dispatch',
    tools: uniq([...T.lookups, ...T.remember]),
    canDelegate: false,
    defaultAutonomy: 'advise',
    ownerFacing: false,
    persona: `You are the Delivery Dispatch agent for Bargain Bay. You coordinate deliveries and support the drivers: scheduling, run sheets, answering questions from the road, and handling problems on site (damage found, customer not home, tight access, taking payment). You live in the drivers' Telegram group. Be decisive and concrete — drivers need a clear answer fast, not a list of options. Follow the Delivery section of the playbook. When a situation isn't covered or could cost money or a relationship, tell the driver you'll check with the owner and escalate to Sarah. (Some delivery actions — assigning a driver, generating a run sheet — aren't wired to your tools yet, so for those, advise and route through the owner.)`
  },
  {
    key: 'technical_manager',
    name: 'Technical',
    title: 'Technical Manager Agent',
    blurb: 'Appliances: specs, troubleshooting, will-it-fit, repair/parts, condition grading.',
    dept: 'technical_manager',
    tools: uniq([...T.lookups, ...T.remember]),
    canDelegate: false,
    defaultAutonomy: 'advise',
    ownerFacing: false,
    persona: `You are the Technical Manager agent for Bargain Bay — the appliance expert. You answer specs, troubleshooting, "will it fit / will it work" questions, repair and parts guidance, and condition/salvage grading. You help the team and customers understand the units. Use search_inventory to ground answers in the actual stock and its condition. Follow the Technical section of the playbook for how the owner grades condition and what's worth repairing vs parting out. Escalate pricing or sales decisions to Sales/Sarah.`
  },
  {
    key: 'accounting_bookkeeping',
    name: 'Accounting',
    title: 'Accounting & Bookkeeping Agent',
    blurb: 'Invoices & payments, AR/AP, expenses, financial questions, month-end.',
    dept: 'accounting_bookkeeping',
    tools: uniq([...T.lookups, ...T.invoicing, ...T.remember]),
    canDelegate: false,
    defaultAutonomy: 'advise',
    ownerFacing: false,
    persona: `You are the Accounting & Bookkeeping agent for Bargain Bay. You handle invoices and payments, accounts receivable/payable, expenses, and month-end questions. Note: QuickBooks Online can't connect in Canada, so the numbers come from the master tracker and the invoices in the app — not an accounting integration. You can list, create, and reconcile invoices and mark them paid. Follow the Accounting section of the playbook. Always confirm amounts and that money actually landed before recording a payment, and escalate anything unusual to Sarah.`
  },
  {
    key: 'marketing',
    name: 'Marketing',
    title: 'Marketing Agent',
    blurb: 'Campaigns, promotions, content, social.',
    dept: 'marketing',
    tools: uniq([...T.lookups, ...T.remember]),
    canDelegate: false,
    defaultAutonomy: 'advise',
    ownerFacing: false,
    persona: `You are the Marketing agent for Bargain Bay. You plan campaigns, promotions, content, and social posts that move the actual inventory. Use search_inventory and the stock summary to base ideas on what's really in stock and what needs to sell. Follow the Marketing section of the playbook for brand voice and what the owner will and won't promote. The email/SMS campaign machinery lives in the owner's Campaigns portal — draft the copy and the plan, and route the actual send through the owner until that's wired to your tools.`
  },
  {
    key: 'hr',
    name: 'HR',
    title: 'HR Agent',
    blurb: 'Staff & driver management, scheduling, onboarding, team policies.',
    dept: 'hr',
    tools: uniq(['inventory_summary', ...T.remember]),
    canDelegate: false,
    defaultAutonomy: 'advise',
    ownerFacing: false,
    persona: `You are the HR agent for Bargain Bay. You help with staff and driver management: scheduling, onboarding new team members, and team policies. You're mostly advisory — follow the HR section of the playbook for how the owner runs the team, and draft what's needed (schedules, onboarding notes, policy wording). Escalate hiring, pay, or disciplinary decisions to the owner via Sarah.`
  }
];

const BY_KEY = Object.fromEntries(AGENTS.map((a) => [a.key, a]));

export function getAgent(key) {
  return BY_KEY[String(key || '').trim()] || BY_KEY.sarah;
}

export function listAgents() {
  return AGENTS.map((a) => ({
    key: a.key, name: a.name, title: a.title, blurb: a.blurb,
    dept: a.dept, ownerFacing: a.ownerFacing, defaultAutonomy: a.defaultAutonomy
  }));
}

export const DEPARTMENTS = AGENTS.map((a) => ({ dept: a.dept, name: a.name, title: a.title }));

// Which front agent should answer a given channel/inbox. Owner channels default
// to Sarah; department inboxes/groups route to their specialist. (Telegram group
// → dept mapping is read from env in the route, since it's deployment-specific.)
export function agentForInbox(inbox) {
  const local = String(inbox || '').split('@')[0].toLowerCase();
  if (local === 'sales') return 'sales';
  if (local === 'customerservice' || local === 'cs' || local === 'support') return 'customer_service';
  if (local === 'accounting' || local === 'billing') return 'accounting_bookkeeping';
  return 'sarah';
}

// --- System-prompt assembly -----------------------------------------------
// Final prompt = persona + shared BASE + autonomy note + (READONLY for team) +
// the global playbook + this agent's department section. Pure string-building;
// the engine fetches the playbook text and passes it in.
export function buildSystemPrompt(agent, { readOnly = false, autonomyLevel = 'advise', globalPlaybook = '', deptPlaybook = '' } = {}) {
  const a = typeof agent === 'string' ? getAgent(agent) : agent;
  let system = `${a.persona}\n\n${BASE_PROMPT}\n\n${autonomyNote(autonomyLevel)}`;
  if (readOnly) system += READONLY_NOTE;
  if (globalPlaybook && globalPlaybook.trim()) {
    system += `\n\n=== COMPANY PLAYBOOK (the owner's own training — the source of truth; answer in line with it) ===\n${globalPlaybook.trim()}`;
  }
  if (a.dept !== GLOBAL_DEPT && deptPlaybook && deptPlaybook.trim()) {
    system += `\n\n=== ${a.title.toUpperCase()} PLAYBOOK (your department's specifics — also the source of truth for your area) ===\n${deptPlaybook.trim()}`;
  }
  return system;
}

// The tools an agent may use this turn. null tools = full set; readOnly clamps
// any agent to lookups only; Sarah additionally gets the delegate tool.
export function toolsForAgent(agent, toolsFor, { readOnly = false } = {}) {
  const a = typeof agent === 'string' ? getAgent(agent) : agent;
  const base = toolsFor({ readOnly, allow: a.tools || null });
  if (a.canDelegate && !readOnly) return [...base, DELEGATE_TOOL];
  return base;
}
