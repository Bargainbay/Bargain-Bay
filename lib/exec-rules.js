// The General Manager's judgement, as arithmetic. NO imports: the tests, the data
// gatherer, the brief, the phone call and the page all read the same answers.
//
// THE POINT (owner, 2026-11-26): a manager is not an alert list. It says whether
// the company made money and where, what each person produced for what they cost,
// where the work is stuck, which few moves are worth the most today, who does each
// one, and the next day whether it was done.
//
// THE FAIRNESS RULE, which every sentence about a person must keep: we only know
// what was RECORDED. "Nothing recorded" is never "did nothing" — work that no
// system captures looks identical to no work, and a manager that accuses somebody
// off a gap in the software deserves to be switched off. Say what is missing and
// ask.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (list, f) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const first = (s) => fold(String(s || '').trim().split(/\s+/)[0]);
export const money = (n) => `${Number(n) < 0 ? '-' : ''}$${Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-CA')}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// This month to date, and the same number of days of last month, so a part month
// is never set against a whole one.
export function monthWindows(today) {
  const from = `${today.slice(0, 7)}-01`;
  const prevLast = addDays(from, -1);
  const prevFrom = `${prevLast.slice(0, 7)}-01`;
  const day = Number(today.slice(8, 10));
  const prevTo = day >= Number(prevLast.slice(8, 10)) ? prevLast : `${prevLast.slice(0, 7)}-${today.slice(8, 10)}`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  return { from, to: today, prevFrom, prevTo, day, daysInMonth: next.getUTCDate() };
}

export const changePct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export function streamBoard(streams = [], win) {
  const factor = win ? win.daysInMonth / Math.max(1, win.day) : null;
  return streams
    .map((s) => ({
      ...s,
      now: s.now == null ? null : round2(s.now),
      before: s.before == null ? null : round2(s.before),
      change: s.now == null || s.before == null ? null : changePct(s.now, s.before),
      runRate: s.now == null || !factor ? null : Math.round(s.now * factor)
    }))
    .sort((a, b) => (b.now ?? -1) - (a.now ?? -1));
}

// ── Matching one human across payroll, the refurb floor, the van and sales ───
// Exact name, else a first name exactly one person has. Two candidates is nobody:
// putting somebody else's output (or somebody else's gap) on a person is the
// worst mistake available here.
export function matchByName(name, people) {
  const f = fold(name);
  if (!f) return null;
  const exact = people.filter((p) => fold(p.name) === f || (p.aliases || []).some((a) => fold(a) === f));
  if (exact.length === 1) return exact[0];
  const fn = first(name);
  const close = people.filter((p) => first(p.name) === fn);
  return close.length === 1 ? close[0] : null;
}

export const FLOOR_STEPS = ['checkedIn', 'assessed', 'repaired', 'cleaned', 'qa'];
const STEP_WORD = { checkedIn: 'checked in', assessed: 'tested', repaired: 'repaired', cleaned: 'cleaned', qa: 'quality checked' };

const blankPerson = (name, email) => ({
  name, email: email || null, aliases: [], paidDays: new Set(), roadDays: new Set(), recordedDays: new Set(),
  hours: 0, cost: 0, openShifts: 0, longShifts: 0, noRate: 0,
  floor: {}, floorByDay: {}, callsByDay: {}, stops: { done: 0, failed: 0, noProof: 0 }, sales: null
});

// shifts: hoursReport().shifts · floor: RS Ops floor workers · stops: [{name,email,day,done,failed,noProof}]
// sales: [{ name, email, calls, reached, quotes, invoices, revenue, profit, days: [] }]
export function peopleReview({ shifts = [], floor = [], stops = [], sales = [], today }) {
  const people = [];
  const byEmail = new Map();
  const find = (name, email, create = true) => {
    const e = String(email || '').toLowerCase();
    let p = (e && byEmail.get(e)) || matchByName(name, people);
    if (!p && create && (name || e)) { p = blankPerson(name || e, e); people.push(p); }
    if (p && e && !byEmail.has(e)) { byEmail.set(e, p); p.email = p.email || e; }
    if (p && name && fold(name) !== fold(p.name) && !p.aliases.includes(name)) p.aliases.push(name);
    return p;
  };

  for (const s of shifts) {
    const p = find(s.person, s.email);
    if (!p) continue;
    if (s.status === 'open') { if (s.day !== today) p.openShifts += 1; continue; }
    if (s.status === 'too_long') { p.longShifts += 1; continue; }
    p.hours += s.hours || 0;
    if (s.status === 'no_rate') p.noRate += 1;
    else if (s.status !== 'owner') p.cost += (s.hours || 0) * (s.rate || 0);
    p.paidDays.add(s.day);
    // A day on the driver clock is a day on the road: the van is the record.
    if (s.source === 'driver') p.roadDays.add(s.day);
  }

  for (const w of floor) {
    // The floor's shared logins ("Admin") are nobody in particular.
    if (/^(admin|associate \d|cleaner \d|tech \d|qa \d)$/i.test(w.name || '')) continue;
    const p = find(w.name, w.email);
    if (!p) continue;
    for (const [day, d] of Object.entries(w.days || {})) {
      for (const k of FLOOR_STEPS) if (d[k]) {
        p.floor[k] = (p.floor[k] || 0) + d[k];
        p.floorByDay[day] = p.floorByDay[day] || {};
        p.floorByDay[day][k] = (p.floorByDay[day][k] || 0) + d[k];
      }
      if (d.photographed) p.floor.photographed = (p.floor.photographed || 0) + d.photographed;
      if (d.photographed || FLOOR_STEPS.some((k) => d[k])) p.recordedDays.add(day);
    }
  }

  for (const s of stops) {
    // Only people already known, or a named driver: a stop never invents staff.
    const p = find(s.name, s.email);
    if (!p) continue;
    p.stops.done += s.done || 0; p.stops.failed += s.failed || 0; p.stops.noProof += s.noProof || 0;
    if (s.day) { p.recordedDays.add(s.day); p.roadDays.add(s.day); }
  }

  for (const s of sales) {
    // A "rep" who is on no clock and has no email is a channel (Website, the
    // company login), not an employee: it is reported with the streams instead.
    const p = find(s.name, s.email, !!s.email);
    if (!p) continue;
    const cur = p.sales || { calls: 0, reached: 0, quotes: 0, invoices: 0, revenue: 0, profit: 0 };
    for (const k of Object.keys(cur)) cur[k] += s[k] || 0;
    p.sales = cur;
    for (const [d, k] of Object.entries(s.callsByDay || {})) p.callsByDay[d] = (p.callsByDay[d] || 0) + k;
    for (const d of s.days || []) p.recordedDays.add(d);
  }

  return people.map((p) => {
    const steps = sum(FLOOR_STEPS, (k) => p.floor[k] || 0);
    const blankDays = [...p.paidDays].filter((d) => !p.recordedDays.has(d) && !p.roadDays.has(d) && d !== today).sort();
    const kinds = [];
    if (p.sales) kinds.push('sales');
    if (steps || p.floor.photographed) kinds.push('floor');
    if (p.stops.done + p.stops.failed || p.roadDays.size) kinds.push('delivery');
    const flags = [];
    const paid = p.paidDays.size;
    if (blankDays.length >= 2 && blankDays.length / Math.max(1, paid) >= 0.4) {
      flags.push({ key: 'unrecorded', text: `nothing recorded on ${blankDays.length} of ${paid} paid days. It may be work no system captures: ask what those days were` });
    }
    if (p.openShifts) flags.push({ key: 'open_shift', text: `${plural(p.openShifts, 'earlier shift')} never clocked out` });
    if (p.longShifts) flags.push({ key: 'long_shift', text: `${plural(p.longShifts, 'shift')} too long to count until fixed` });
    if (p.noRate) flags.push({ key: 'no_rate', text: 'no hourly rate on file, so the profit figures miss this cost' });
    if (p.sales && p.cost >= 300 && p.sales.profit < p.cost) {
      flags.push({ key: 'sales_below_cost', text: `gross profit ${money(p.sales.profit)} against ${money(p.cost)} in wages` });
    }
    if (p.stops.noProof >= 2) flags.push({ key: 'no_proof', text: `${p.stops.noProof} finished stops with no signature or photo` });
    if (p.stops.failed >= 3) flags.push({ key: 'failed_stops', text: `${p.stops.failed} stops not completed` });
    return {
      name: p.name, email: p.email, aliases: p.aliases, kinds,
      hours: round2(p.hours), cost: round2(p.cost), paidDays: paid, blankDays,
      days: [...new Set([...p.paidDays, ...p.recordedDays])].sort(), callsByDay: p.callsByDay,
      floor: p.floor, floorByDay: p.floorByDay, floorSteps: steps,
      // Only when floor work is the main thing recorded, or the ratio punishes whoever also drives.
      stepsPerFloorHour: steps && !p.roadDays.size && p.hours >= 8 ? round2(steps / p.hours) : null,
      stops: p.stops, sales: p.sales ? { ...p.sales, revenue: round2(p.sales.revenue), profit: round2(p.sales.profit) } : null,
      profitPerWageDollar: p.sales && p.cost > 0 ? round2(p.sales.profit / p.cost) : null,
      flags
    };
  }).filter((p) => p.hours || p.floorSteps || p.sales || p.stops.done || p.openShifts)
    .sort((a, b) => b.cost - a.cost || b.hours - a.hours);
}

export function personLine(p) {
  const bits = [];
  if (p.floorSteps) bits.push(FLOOR_STEPS.filter((k) => p.floor[k]).map((k) => `${p.floor[k]} ${STEP_WORD[k]}`).join(', '));
  if (p.floor?.photographed) bits.push(`${p.floor.photographed} photographed`);
  if (p.stops.done || p.stops.failed) bits.push(`${plural(p.stops.done, 'stop')} done${p.stops.failed ? `, ${p.stops.failed} failed` : ''}`);
  if (p.sales) bits.push(`${plural(p.sales.calls, 'call')} logged, ${plural(p.sales.invoices, 'invoice')}, ${money(p.sales.revenue)} sold, ${money(p.sales.profit)} gross profit`);
  return bits.join('; ') || 'no output recorded';
}

// ── The floor: where work is stuck ──────────────────────────────────────────

export const STAGES = [
  { key: 'arrive', label: 'Expected, not checked in', done: 'checkedIn', who: 'receiving' },
  { key: 'test', label: 'Here, waiting to be tested', done: 'assessed', who: 'testing' },
  { key: 'submitted', label: 'Waiting on your decision', done: null, who: 'the office' },
  { key: 'parts', label: 'Waiting for parts', done: null, who: 'parts ordering' },
  { key: 'repair', label: 'Waiting for repair', done: 'repaired', who: 'repair' },
  { key: 'cleaning', label: 'Waiting to be cleaned', done: 'cleaned', who: 'cleaning' },
  { key: 'qa', label: 'Waiting for quality check', done: 'qa', who: 'quality check' }
];

export const stageOf = (u) => (u.status === 'draft' ? (u.arrived ? 'test' : 'arrive') : u.status);

// units: RS Ops floor units. onSite / sold: Sets of upper-cased SKUs on Bargain Bay.
export function floorFlow({ units = [], workers = [], onSite = null, sold = null, now = new Date() }) {
  const age = (u) => {
    const t = Date.parse(u.since || '');
    return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 86400000)) : null;
  };
  // A "working day" is any day anybody recorded anything on the floor.
  const activeDays = new Set(workers.flatMap((w) => Object.keys(w.days || {})));
  const done = {};
  for (const w of workers) for (const d of Object.values(w.days || {})) for (const k of FLOOR_STEPS) done[k] = (done[k] || 0) + (d[k] || 0);

  const stages = STAGES.map((s) => {
    const list = units.filter((u) => stageOf(u) === s.key);
    const ages = list.map(age).filter((a) => a != null);
    const total = s.done ? (done[s.done] || 0) : null;
    const perDay = total != null && activeDays.size ? round2(total / activeDays.size) : null;
    return {
      key: s.key, label: s.label, who: s.who, count: list.length,
      oldestDays: ages.length ? Math.max(...ages) : null,
      over7: ages.filter((a) => a >= 7).length,
      doneInWindow: total, perWorkingDay: perDay,
      daysToClear: list.length && perDay > 0 ? Math.ceil(list.length / perDay) : null,
      stalled: !!(list.length && total === 0),
      sample: list.slice().sort((a, b) => (age(b) || 0) - (age(a) || 0)).slice(0, 10).map((u) => u.id)
    };
  });

  // The constraint: the working stage that will take longest to clear. A queue of
  // three or more with nothing finished at all in the window beats any number; a
  // stage with no "finished" record (parts, a decision) is judged on its oldest wait.
  const working = stages.filter((s) => s.count > 0 && ['test', 'repair', 'cleaning', 'qa', 'submitted', 'parts'].includes(s.key));
  const weight = (s) => (s.stalled && s.count >= 3 ? 10000 + s.count : s.doneInWindow == null ? (s.oldestDays || 0) : (s.daysToClear || 0));
  const constraint = working.slice().sort((a, b) => weight(b) - weight(a) || b.count - a.count)[0] || null;

  // Another company's units are theirs to sell, never "missing from our website".
  const ready = units.filter((u) => u.status === 'ready' && u.own !== false);
  let notOnSite = null;
  if (onSite && sold) {
    notOnSite = ready.filter((u) => !onSite.has(String(u.id).toUpperCase()) && !sold.has(String(u.id).toUpperCase()))
      .map((u) => ({ id: u.id, model: u.model, days: age(u) }))
      .sort((a, b) => (b.days || 0) - (a.days || 0));
  }
  return {
    workingDays: activeDays.size, done, stages: stages.filter((s) => s.count > 0), constraint,
    parked: units.filter((u) => u.status === 'misc').length,
    ready: ready.length, readyNotOnSite: notOnSite
  };
}

// ── The moves worth the most ────────────────────────────────────────────────
// Each carries the dollars AT STAKE (never a promised gain) and how sure that
// figure is. `speed` ranks cash that can be had today above money that might come.
export function rankPlays(f = {}) {
  const out = [];
  const add = (p) => { if (p.dollars > 0 || p.count > 0) out.push(p); };
  const m = f.money || {};
  if (m.doorMoney?.count) add({ key: 'door-money', role: 'owner', speed: 1, dollars: m.doorMoney.total, count: m.doorMoney.count, basis: 'reported by drivers',
    title: `Count and confirm ${money(m.doorMoney.total)} drivers collected at the door`, action: 'Confirm or reject each on the dispatch page.' });
  if (m.overdue?.count) add({ key: 'collect', role: 'sales', speed: 0.8, dollars: m.overdue.total, count: m.overdue.count, basis: 'owed and past due',
    title: `Collect ${money(m.overdue.total)} on ${plural(m.overdue.count, 'overdue invoice')}`,
    action: `Ring the biggest first${m.overdue.top?.length ? `: ${m.overdue.top.slice(0, 3).map((i) => `${i.name || i.number} ${money(i.balance)}`).join(', ')}` : ''}. Get a payment date or take payment.` });
  // Ranked on its dollars only once he has said how far his own sheets are billed.
  if (m.unbilled?.count) add({ key: 'bill-clients', role: 'owner', speed: m.unbilled.billedThrough ? 0.9 : 0.1, dollars: m.unbilled.total, count: m.unbilled.count,
    basis: m.unbilled.billedThrough ? `finished after ${m.unbilled.billedThrough}, no invoice in the system` : 'no invoice in the system; some may be billed from your own sheets',
    title: m.unbilled.billedThrough ? `Invoice ${money(m.unbilled.total)} of client delivery work` : `Check billing on ${money(m.unbilled.total)} of client delivery work`,
    action: `Check against your invoice sheets, then bill what is missing (${(m.unbilled.clients || []).slice(0, 4).join(', ')}).${m.unbilled.billedThrough ? '' : ' Put the date you have billed up to on the Manager page and I stop counting older stops.'}` });
  if (m.unpriced?.count) add({ key: 'price-stops', role: 'owner', speed: 0.7, dollars: 0, count: m.unpriced.count, basis: 'no charge typed',
    title: `Price ${plural(m.unpriced.count, 'finished client stop')} so it can be billed`, action: 'Work each out from the rate sheet and set the charge.' });
  if (m.quotes?.count) add({ key: 'quotes', role: 'sales', speed: 0.35, dollars: m.quotes.total, count: m.quotes.count, basis: 'quoted, not yet sold',
    title: `Close ${plural(m.quotes.count, 'open quote')} worth ${money(m.quotes.total)}`, action: 'Call every one this week, expiring first. Record why any is lost.' });
  if (f.leads?.total) add({ key: 'leads', role: 'sales', speed: 0.6, dollars: 0, count: f.leads.total, basis: 'uncalled',
    title: `Call ${plural(f.leads.total, 'waiting lead')}${f.leads.oldestHours ? ` (oldest ${f.leads.oldestHours}h)` : ''}`,
    action: `${f.leads.workshop ? `${f.leads.workshop} are workshop leads at $1,999 a seat. ` : ''}Newest first, then the oldest.` });
  const hidden = f.flow?.readyNotOnSite || [];
  if (hidden.length) add({ key: 'list-ready', role: 'floor', speed: 0.55, count: hidden.length,
    dollars: Math.round(hidden.length * (f.avgPrice || 0)), basis: 'estimate: unit count x your average list price',
    title: `${plural(hidden.length, 'finished unit')} not for sale on the website`,
    action: `Check each: photograph, grade and price on the tracker, or mark it sold. Oldest: ${hidden.slice(0, 5).map((u) => u.id).join(', ')}.` });
  const c = f.flow?.constraint;
  if (c && c.count >= 3) add({ key: 'bottleneck', role: 'floor', speed: 0.45, count: c.count,
    dollars: Math.round(c.count * (f.avgPrice || 0)), basis: 'estimate: unit count x your average list price',
    title: `Unblock ${c.who}: ${plural(c.count, 'unit')} ${c.label.toLowerCase()}`,
    action: c.stalled ? `Nothing finished at this step in the last two weeks. Name one person to own it today.`
      : c.daysToClear ? `At the current pace it takes ${plural(c.daysToClear, 'working day')} to clear. Move a second pair of hands here.`
        : `The oldest has waited ${c.oldestDays} days. Decide each one today.` });
  if (f.stale?.count) add({ key: 'stale', role: 'owner', speed: 0.25, dollars: f.stale.tied, count: f.stale.count, basis: 'your cost tied up 90 days or more',
    title: `Free ${money(f.stale.tied)} tied up in ${plural(f.stale.count, 'unit')} older than 90 days`, action: 'Mark down the worst five today; ask the manager for suggested prices.' });
  return out.sort((a, b) => (b.dollars * b.speed + b.count * 25) - (a.dollars * a.speed + a.count * 25));
}

// ── Today's targets, one per person, checkable tomorrow from the same records ─

export const METRICS = {
  cleaned: 'units cleaned', assessed: 'units tested', repaired: 'repairs finished', checkedIn: 'units checked in',
  calls: 'calls logged', stops_proof: 'stops closed with signature or photo'
};

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

// A floor target is the person's OWN typical recorded day, nudged up one — fair to
// the newest hire and the fastest, and never a number nobody here has done.
// A driver's target is today's run, each stop closed with proof.
export function assignTargets({ people = [], flow = null, leads = null, todayStops = [], today, callTarget = 20, recentDays = 7, callList = null }) {
  const cut = addDays(today, -recentDays);
  const out = [];
  const taken = new Set();
  for (const s of todayStops) {
    const p = matchByName(s.name, people);
    const email = s.email || p?.email || null;
    const name = p?.name || s.name;
    if (!name || !s.count || taken.has(name)) continue;
    taken.add(name);
    out.push({ name, email, metric: 'stops_proof', target: s.count, why: `${plural(s.count, 'stop')} on your run` });
  }
  const waiting = Object.fromEntries((flow?.stages || []).map((s) => [s.key, s.count]));
  const stageFor = { cleaned: 'cleaning', assessed: 'test', repaired: 'repair', checkedIn: 'arrive' };
  for (const p of people) {
    if (taken.has(p.name) || !p.email) continue;
    const recent = (days) => Object.keys(days || {}).some((d) => d >= cut);
    // Whoever he put on the daily call list owes that number, whatever else they do.
    const listed = !!callList?.enabled && (callList.reps || []).map((e) => String(e).toLowerCase()).includes(String(p.email).toLowerCase())
      && (recent(p.floorByDay) || recent(p.callsByDay) || !!p.sales);
    // Otherwise a call target only for somebody who actually calls, not whoever once raised an invoice.
    if (listed || (p.sales && (recent(p.callsByDay) || p.sales.calls >= 10))) {
      out.push({ name: p.name, email: p.email, metric: 'calls', target: listed ? callList.perRep : callTarget,
        why: listed ? 'your daily call list' : leads?.total ? `${leads.total} leads are waiting to be called` : 'follow-up calls' });
      if (!listed) continue;
    }
    if (!recent(p.floorByDay)) continue;
    const options = Object.keys(stageFor).map((metric) => {
      const mine = Object.values(p.floorByDay || {}).map((d) => d[metric] || 0).filter((n) => n > 0);
      return { metric, typical: median(mine), waiting: waiting[stageFor[metric]] || 0, days: mine.length };
    }).filter((o) => o.waiting > 0 && o.days > 0);
    // The longest queue among the jobs THIS person has done before.
    const pick = options.sort((a, b) => b.waiting - a.waiting)[0];
    if (!pick) continue;
    out.push({ name: p.name, email: p.email, metric: pick.metric, target: Math.max(1, Math.min(pick.waiting, pick.typical + 1)),
      why: `${pick.waiting} waiting; your usual day is ${pick.typical}` });
  }
  return out;
}

export function assignmentText(a) {
  return `${String(a.name).split(' ')[0]}, today's target: ${a.target} ${METRICS[a.metric] || a.metric} (${a.why}). I check it tonight. Stuck on something? Tell the office what. - Manager`;
}

// What the records show for one target on one day. worked false = they were not in.
export function measure(a, day, { people = [], stopDays = {} } = {}) {
  const p = (a.email && people.find((x) => x.email === a.email)) || matchByName(a.name, people);
  const worked = !!p?.days?.includes(day);
  let actual = 0;
  if (a.metric === 'calls') actual = p?.callsByDay?.[day] || 0;
  else if (a.metric === 'stops_proof') actual = stopDays[`${String(a.email || p?.email || '').toLowerCase()}|${day}`] || 0;
  else actual = p?.floorByDay?.[day]?.[a.metric] || 0;
  return { actual, worked: worked || actual > 0 };
}

// actual: number · worked: false = they did not work that day.
export function judgeAssignment(a, actual, worked) {
  if (!worked) return { status: 'off', actual: null };
  const n = Number(actual) || 0;
  return { status: n >= a.target ? 'met' : n > 0 ? 'short' : 'nothing', actual: n };
}

export function verdictLine({ pnl, win, sales }) {
  if (!pnl) return 'I could not work out the profit this month.';
  const bits = [`Month to day ${win.day}: ${sales != null ? `${money(sales)} sold, ` : ''}${pnl.net >= 0 ? `${money(pnl.net)} made` : `${money(-pnl.net)} lost`} after delivery costs, wages and overhead`];
  if (pnl.prevNet != null) bits.push(`${pnl.net >= pnl.prevNet ? 'up' : 'down'} from ${money(pnl.prevNet)} at this point last month`);
  return `${bits.join(', ')}.`;
}
