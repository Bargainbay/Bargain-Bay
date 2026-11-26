// The General Manager's day (owner, 2026-11-26: "one of the top tier elite
// managers"). Facts come from lib/exec-data, judgement from lib/exec-rules; this
// module keeps the memory and the follow-through:
//
//   morning   review the business, judge yesterday's targets, set today's, brief him
//   daytime   tell each person their target once they clock in, then push them
//             every 2-3 hours while they are on the clock (both are switches)
//   evening   the day report says how each target is going (lib/manager-report)
//
// It moves no money and changes no price. The only things it can send to anybody but
// the owner are a person's own target and progress on it, to their own number, only
// while they are clocked in, and only with the switches on.
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';
import { sendEmail } from './email';
import { SERVICE_EMAIL, torontoToday } from './constants';
import { SITE_URL } from './site';
import { isProduction } from './environment';
import { gatherFacts, progressFacts } from './exec-data';
import { rankPlays, assignTargets, measure, judgeAssignment, planText, pushText, targetDone, unreadable, PUSH_GAP_MIN, MAX_PUSHES, verdictLine, personLine, money, addDays, METRICS } from './exec-rules';

export const SNAPSHOT_KEY = 'exec_snapshot';
const CONFIG_KEY = 'manager_exec';
const SENT_KEY = 'exec_brief_sent';
const BY = 'Manager (AI)';
export const BRIEF_HOUR = 7;
export const TEXT_UNTIL_HOUR = 20;

const torontoHour = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', hourCycle: 'h23' }).format(d));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function getExecConfig() {
  const c = (await getSetting(CONFIG_KEY, null)) || {};
  return {
    emailBrief: c.emailBrief !== false,
    textStaff: c.textStaff === true,
    pushStaff: c.pushStaff === true,
    callTarget: Math.min(100, Math.max(1, Math.round(Number(c.callTarget) || 20))),
    // Client delivery work up to this day was invoiced from the owner's own sheets.
    billedThrough: /^\d{4}-\d{2}-\d{2}$/.test(c.billedThrough || '') ? c.billedThrough : ''
  };
}
export async function saveExecConfig(patch = {}) {
  const cur = await getExecConfig();
  const next = { ...cur };
  if (patch.emailBrief !== undefined) next.emailBrief = patch.emailBrief === true;
  if (patch.textStaff !== undefined) next.textStaff = patch.textStaff === true;
  if (patch.pushStaff !== undefined) next.pushStaff = patch.pushStaff === true;
  if (patch.callTarget !== undefined) next.callTarget = Number(patch.callTarget);
  if (patch.billedThrough !== undefined) next.billedThrough = String(patch.billedThrough || '');
  await setSetting(CONFIG_KEY, next);
  return getExecConfig();
}

// Not memoised, for the reason lib/manager-actions gives.
export async function ensureExecSchema() {
  if (!hasDb()) return;
  await query(`
    CREATE TABLE IF NOT EXISTS manager_assignments (
      id serial PRIMARY KEY, day date NOT NULL, person_name text NOT NULL, person_email text,
      metric text NOT NULL, target integer NOT NULL, why text, actual integer, status text,
      judged_at timestamptz, texted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_assignments ON manager_assignments (day, lower(person_name), metric);
    CREATE INDEX IF NOT EXISTS idx_manager_assignments_day ON manager_assignments (day DESC);
    ALTER TABLE manager_assignments ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
    ALTER TABLE manager_assignments ADD COLUMN IF NOT EXISTS pushes integer NOT NULL DEFAULT 0;
    ALTER TABLE manager_assignments ADD COLUMN IF NOT EXISTS cheered_at timestamptz;
  `);
}

export async function assignmentsOn(day) {
  if (!hasDb()) return [];
  await ensureExecSchema();
  const { rows } = await query(
    `SELECT id, day::text AS day, person_name AS name, person_email AS email, metric, target, why, actual, status, texted_at, pushed_at, pushes, cheered_at
       FROM manager_assignments WHERE day = $1::date ORDER BY person_name`, [day]);
  return rows;
}

// Judge every earlier target still unjudged (within the facts' review window), so a
// missed morning does not lose a day.
export async function judgeEarlier(facts) {
  await ensureExecSchema();
  const { rows } = await query(
    `SELECT id, day::text AS day, person_name AS name, person_email AS email, metric, target FROM manager_assignments
      WHERE status IS NULL AND day < $1::date AND day >= $2::date ORDER BY day`, [facts.today, facts.reviewFrom]);
  const judged = [];
  for (const a of rows) {
    // A source that could not be read would judge people "nothing" for our own failure.
    if (unreadable(a.metric, facts.blind)) continue;
    const m = measure(a, a.day, facts);
    const r = judgeAssignment(a, m.actual, m.worked);
    await query('UPDATE manager_assignments SET status = $2, actual = $3, judged_at = now() WHERE id = $1', [a.id, r.status, r.actual]);
    judged.push({ ...a, ...r });
  }
  return judged;
}

export async function setTargets(facts, cfg) {
  await ensureExecSchema();
  const list = assignTargets({ people: facts.people, flow: facts.flow, leads: facts.leads, todayStops: facts.todayStops, today: facts.today, callTarget: cfg.callTarget, callList: facts.callList });
  for (const a of list) {
    await query(
      `INSERT INTO manager_assignments (day, person_name, person_email, metric, target, why)
       VALUES ($1::date,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [facts.today, a.name, a.email, a.metric, a.target, a.why]);
  }
  return assignmentsOn(facts.today);
}

// ── Judgement ───────────────────────────────────────────────────────────────
// The numbers are arithmetic. The model is asked only for what a number cannot do:
// which decision to take and what to say to a person. It is optional: with no model
// the brief still goes, and says the judgement is missing.

const JUDGE_SYSTEM = `You are the general manager of two linked small businesses in Pickering, Ontario: Bargain Bay (liquidation appliance retail: open-box, scratch and dent and refurbished units, one of each; website, staff sales, resellers, a marketplace) and RS Solutions (delivery and service for client companies, an appliance repair workshop course at $1,999 a seat, refurbishing partnerships with manufacturers being pursued). You report to the owner. You are exceptionally good: you think in cash, throughput, margin per paid hour and the single constraint; you make a call and defend it; you manage people with clear expectations and fairness.
You are given today's facts as JSON. Reply with ONLY a JSON object:
{"headline": "one sentence on the state of the business",
 "decisions": [{"decision": "what the owner should decide today", "recommend": "your pick, concrete", "why": "one sentence using figures from the facts"}],
 "efficiency": ["up to 3 specific changes to how work is organised that would raise output per paid hour or shorten cash tie-up"],
 "growth": ["up to 2 moves on a revenue stream that the figures show is weak or underused"],
 "coaching": [{"name": "exact name from the facts", "say": "what to say to them, one or two sentences"}]}
Rules: at most 3 decisions and 5 coaching entries. Use only figures present in the facts; never invent a number, a rate or a name. "Nothing recorded" is not proof a person did nothing: ask, never accuse. Never suggest firing, cutting pay or discipline off these figures. If a source is listed as unread, do not draw conclusions that depend on it. Client delivery work with "no invoice in the system" may already be invoiced from the owner's own sheets unless billedThrough is set: say check, never call it unbilled or owed. Prices, payments, refunds and anything sent to a customer are the owner's call. Plain words, no jargon.`;

export function judgementInput(facts, plays, yesterday) {
  return {
    today: facts.today, monthDay: facts.win.day, daysInMonth: facts.win.daysInMonth, notRead: facts.blind,
    profit: facts.pnl, salesPreTax: facts.sales, revenueLines: facts.streams, whoClosed: facts.salesShare,
    stuckMoney: facts.money, waitingLeads: facts.leads, oldStock: facts.stale,
    floor: facts.flow ? { constraint: facts.flow.constraint?.label || null, parked: facts.flow.parked, stages: facts.flow.stages.map(({ sample, ...s }) => s), finishedNotOnWebsite: facts.flow.readyNotOnSite?.length ?? null } : null,
    people: facts.people.map((p) => ({ name: p.name, last14Days: { paidHours: p.hours, wages: p.cost, paidDays: p.paidDays, output: personLine(p), concerns: p.flags.map((f) => f.text) } })),
    topMoves: plays.slice(0, 8).map(({ title, dollars, basis, action }) => ({ title, dollars, basis, action })),
    yesterdayTargets: yesterday.map((a) => ({ name: a.name, target: `${a.target} ${METRICS[a.metric] || a.metric}`, actual: a.actual, result: a.status }))
  };
}

export function cleanJudgement(raw, names = []) {
  if (!raw || typeof raw !== 'object') return null;
  const s = (v, n = 400) => String(v ?? '').trim().slice(0, n);
  const known = new Set(names.map((x) => String(x).toLowerCase()));
  const out = {
    headline: s(raw.headline),
    decisions: (Array.isArray(raw.decisions) ? raw.decisions : []).slice(0, 3)
      .map((d) => ({ decision: s(d?.decision), recommend: s(d?.recommend), why: s(d?.why) })).filter((d) => d.decision && d.recommend),
    efficiency: (Array.isArray(raw.efficiency) ? raw.efficiency : []).slice(0, 3).map((x) => s(x)).filter(Boolean),
    growth: (Array.isArray(raw.growth) ? raw.growth : []).slice(0, 2).map((x) => s(x)).filter(Boolean),
    // A name the facts do not carry is a person the model made up.
    coaching: (Array.isArray(raw.coaching) ? raw.coaching : []).slice(0, 5)
      .map((c) => ({ name: s(c?.name, 80), say: s(c?.say) })).filter((c) => c.say && known.has(c.name.toLowerCase()))
  };
  return out.headline || out.decisions.length ? out : null;
}

export async function judge(facts, plays, yesterday, fetchImpl = fetch) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' };
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.MANAGER_BRAIN_MODEL || 'claude-opus-5-5', max_tokens: 8000, system: JUDGE_SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(judgementInput(facts, plays, yesterday)) }]
      }),
      signal: AbortSignal.timeout(90000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error?.message || `the model answered ${res.status}` };
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const out = cleanJudgement(JSON.parse(json), facts.people.map((p) => p.name));
    return out ? { ok: true, ...out } : { ok: false, error: 'the model gave nothing usable' };
  } catch (e) { return { ok: false, error: e?.message || 'the model call failed' }; }
}

// ── The review ──────────────────────────────────────────────────────────────

/**
 * Review the business and store it. `commit` false writes no target and judges
 * nothing (a preview, or a mid-day refresh before the morning run).
 */
export async function buildReview({ now = new Date(), commit = true, think = true, fetchImpl = fetch, facts = null } = {}) {
  const f = facts || await gatherFacts({ now, fetchImpl });
  const cfg = await getExecConfig();
  const judged = commit ? await judgeEarlier(f) : [];
  const targets = commit ? await setTargets(f, cfg) : await assignmentsOn(f.today);
  const yesterday = await assignmentsOn(addDays(f.today, -1));
  const plays = rankPlays(f);
  const previous = await getSetting(SNAPSHOT_KEY, null);
  let judgement = null;
  if (think) judgement = await judge(f, plays, yesterday, fetchImpl);
  // A refresh without thinking keeps this morning's judgement.
  else if (previous?.today === f.today) judgement = previous.judgement;
  const snapshot = {
    at: now.toISOString(), today: f.today, win: f.win, blind: f.blind,
    verdict: verdictLine(f), pnl: f.pnl, sales: f.sales, streams: f.streams, salesShare: f.salesShare,
    money: f.money, leads: f.leads, stale: f.stale, plays, judgement,
    flow: f.flow, targets, yesterday,
    people: f.people.map(({ floorByDay, callsByDay, days, aliases, ...p }) => ({ ...p, line: personLine({ ...p }) }))
  };
  await setSetting(SNAPSHOT_KEY, snapshot);
  return { snapshot, facts: f, judged };
}

export async function latestReview() { return getSetting(SNAPSHOT_KEY, null); }

// How today's targets stand right now (for the evening report). Judges nothing.
export async function targetProgress({ now = new Date(), fetchImpl = fetch } = {}) {
  const today = torontoToday(now);
  const list = await assignmentsOn(today);
  if (!list.length) return [];
  const f = await gatherFacts({ now, fetchImpl });
  return list.map((a) => {
    const m = measure(a, today, f);
    return { ...a, ...judgeAssignment(a, m.actual, m.worked) };
  });
}

// ── The brief ───────────────────────────────────────────────────────────────

const RESULT = { met: 'done', short: 'short', nothing: 'nothing recorded', off: 'not in' };
const targetLine = (a) => `<b>${esc(a.name)}</b>: ${a.target} ${esc(METRICS[a.metric] || a.metric)}${a.status ? ` — ${a.actual ?? '-'} recorded, ${RESULT[a.status] || a.status}` : ` <span style="color:#666">(${esc(a.why)})</span>`}`;
const h = (t) => `<h3 style="margin:18px 0 4px">${esc(t)}</h3>`;
const ul = (items) => `<ul style="margin:4px 0;padding-left:18px">${items.map((i) => `<li style="margin:3px 0">${i}</li>`).join('')}</ul>`;

export function briefHtml(s) {
  const j = s.judgement;
  const parts = [`<p style="font-size:16px"><b>${esc(s.verdict)}</b></p>`];
  if (j?.ok) parts.push(`<p>${esc(j.headline)}</p>`);
  if (j?.ok && j.decisions.length) parts.push(h('Decide today') + ul(j.decisions.map((d) => `<b>${esc(d.decision)}</b><br>My pick: ${esc(d.recommend)} <span style="color:#666">${esc(d.why)}</span>`)));
  if (s.plays.length) parts.push(h('Money moves, biggest first') + ul(s.plays.slice(0, 6).map((p) => `<b>${esc(p.title)}</b> <span style="color:#666">(${esc(p.basis)})</span><br>${esc(p.action)}`)));
  if (s.streams?.length) {
    parts.push(h(`Where the money came from (day ${s.win.day}, against the same days last month)`)
      + `<table cellpadding="4" style="border-collapse:collapse;font-size:13px">${s.streams.map((x) => `<tr><td>${esc(x.label)}</td><td align="right">${x.now == null ? 'not read' : money(x.now)}</td><td align="right" style="color:${x.change < 0 ? '#b3261e' : '#1b6e3c'}">${x.change == null ? '' : `${x.change > 0 ? '+' : ''}${x.change}%`}</td></tr>`).join('')}</table>`);
  }
  if (s.salesShare) parts.push(`<p>${s.salesShare.housePct}% of the last ${s.salesShare.days} days' sales were closed under your own or the company login; staff closed ${money(s.salesShare.staff)}.</p>`);
  if (s.flow) {
    const c = s.flow.constraint;
    parts.push(h('The refurb floor') + ul(s.flow.stages.map((x) => `${x.key === c?.key ? '<b>' : ''}${esc(x.label)}: ${x.count}${x.oldestDays != null ? `, oldest ${x.oldestDays} days` : ''}${x.stalled ? ', none finished in two weeks' : x.daysToClear ? `, about ${x.daysToClear} working days to clear` : ''}${x.key === c?.key ? ' ← the bottleneck</b>' : ''}`))
      + (s.flow.parked ? `<p style="color:#666">${s.flow.parked} more are parked in Misc, waiting for you to close or release them.</p>` : ''));
  }
  if (s.people.length) parts.push(h('Your people, last 14 days') + ul(s.people.map((p) => `<b>${esc(p.name)}</b> — ${p.hours}h, ${money(p.cost)}: ${esc(p.line)}${p.flags.length ? `<br><span style="color:#8a5a00">${p.flags.map((x) => esc(x.text)).join('; ')}</span>` : ''}`)));
  if (j?.ok && j.coaching.length) parts.push(h('What I would say to them') + ul(j.coaching.map((c) => `<b>${esc(c.name)}</b>: ${esc(c.say)}`)));
  if (s.yesterday?.length) parts.push(h('Yesterday\'s targets') + ul(s.yesterday.map(targetLine)));
  if (s.targets?.length) parts.push(h('Today\'s targets') + ul(s.targets.map((a) => targetLine({ ...a, status: null }))));
  if (j?.ok && (j.efficiency.length || j.growth.length)) parts.push(h('Run it better') + ul([...j.efficiency, ...j.growth].map(esc)));
  const gaps = [...(s.blind || []).map((b) => `I could not read ${b}`), ...(s.pnl?.warnings || []), ...(j && !j.ok ? [`My written judgement is missing today: ${j.error}`] : [])];
  if (gaps.length) parts.push(h('What these figures are missing') + ul(gaps.map(esc)));
  return `<div style="font-family:Arial,sans-serif;font-size:14px;max-width:680px">${parts.join('')}<p style="color:#666;font-size:12px">Your General Manager. The live version is on <a href="${SITE_URL}/admin/manager">the Manager page</a>.</p></div>`;
}

// ── Telling people their target ─────────────────────────────────────────────

async function onClock(email, now) {
  const { rows } = await query(
    `SELECT s.started_at FROM staff_shifts s JOIN employees e ON e.id = s.employee_id WHERE lower(e.email) = $1 AND s.ended_at IS NULL
     UNION ALL
     SELECT s.started_at FROM driver_shifts s JOIN users u ON u.id = s.user_id WHERE lower(u.email) = $1 AND s.ended_at IS NULL
     LIMIT 5`, [String(email).toLowerCase()]);
  // A shift left open since yesterday is not somebody at work now.
  return rows.some((r) => now - new Date(r.started_at) < 14 * 3600_000);
}

// Both kinds of text share one gate: the switch, production, and daytime hours.
function textingClosed(cfg, now) {
  if (!cfg.textStaff) return 'texting staff is switched off';
  if (!isProduction()) return 'not production';
  const hour = torontoHour(now);
  if (hour < BRIEF_HOUR || hour >= TEXT_UNTIL_HOUR) return 'outside texting hours';
  return null;
}

const byPerson = (rows) => {
  const m = new Map();
  for (const a of rows) {
    const k = a.name.toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(a);
  }
  return [...m.values()];
};

export async function textTargets({ now = new Date(), send = null } = {}) {
  const closed = textingClosed(await getExecConfig(), now);
  if (closed) return { skipped: closed };
  const today = torontoToday(now);
  const waiting = (await assignmentsOn(today)).filter((a) => !a.texted_at && a.email);
  const { staffByEmail, sendStaffText } = await import('./staff-texts');
  const sent = []; const held = [];
  for (const rows of byPerson(waiting)) {
    const { name, email } = rows[0];
    if (!(await onClock(email, now))) continue;
    const to = await staffByEmail(email);
    if (!to?.phoneKey) { held.push({ name, why: 'no mobile on file' }); continue; }
    // Claimed first, so two overlapping passes cannot text the same person twice.
    const claim = await query('UPDATE manager_assignments SET texted_at = $2 WHERE id = ANY($1::int[]) AND texted_at IS NULL RETURNING id', [rows.map((a) => a.id), now.toISOString()]);
    const mine = rows.filter((a) => claim.rows.some((c) => c.id === a.id));
    if (!mine.length) continue;
    const r = await (send || sendStaffText)({ to, body: planText(name, mine), kind: 'plan', nudge: 'daily_target', subject: `${today}:target`, sentBy: BY });
    if (r.ok) sent.push(name);
    else {
      held.push({ name, why: r.reason || r.status });
      await query('UPDATE manager_assignments SET texted_at = NULL WHERE id = ANY($1::int[])', [mine.map((a) => a.id)]);
    }
  }
  return { sent, held };
}

// Every 2-3 hours after the target text, while the person is still on the clock:
// where they stand and a push. Stops once they have been told they hit it.
export async function pushTargets({ now = new Date(), send = null, fetchImpl = fetch, progress = null } = {}) {
  const cfg = await getExecConfig();
  const closed = textingClosed(cfg, now) || (cfg.pushStaff ? null : 'pushing staff is switched off');
  if (closed) return { skipped: closed };
  const today = torontoToday(now);
  const cutoff = now.getTime() - PUSH_GAP_MIN * 60_000;
  const due = [];
  for (const rows of byPerson((await assignmentsOn(today)).filter((a) => a.texted_at && a.email))) {
    const last = Math.max(...rows.map((a) => new Date(a.pushed_at || a.texted_at).getTime()));
    if (last > cutoff || rows.every((a) => a.cheered_at) || Math.max(...rows.map((a) => a.pushes)) >= MAX_PUSHES) continue;
    if (await onClock(rows[0].email, now)) due.push(rows);
  }
  if (!due.length) return { sent: [], held: [] };
  const facts = progress || await progressFacts({ now, fetchImpl });
  const { staffByEmail, sendStaffText } = await import('./staff-texts');
  const sent = []; const held = [];
  for (const rows of due) {
    const { name, email } = rows[0];
    const to = await staffByEmail(email);
    if (!to?.phoneKey) { held.push({ name, why: 'no mobile on file' }); continue; }
    // The claim is the interval itself: an overlapping pass finds nothing due.
    const claim = await query(
      `UPDATE manager_assignments SET pushed_at = $2, pushes = pushes + 1
        WHERE id = ANY($1::int[]) AND COALESCE(pushed_at, texted_at) <= $3 RETURNING id`,
      [rows.map((a) => a.id), now.toISOString(), new Date(cutoff).toISOString()]);
    if (!claim.rows.length) continue;
    const items = rows.map((a) => ({ ...a, actual: unreadable(a.metric, facts.blind) ? null : measure(a, today, facts).actual }));
    const n = Math.max(...rows.map((a) => a.pushes)) + 1;
    const r = await (send || sendStaffText)({ to, body: pushText(name, items, n), kind: 'plan', nudge: 'daily_push', subject: `${today}:push${n}`, sentBy: BY });
    if (!r.ok) { held.push({ name, why: r.reason || r.status }); continue; }
    sent.push(name);
    if (items.every(targetDone)) await query('UPDATE manager_assignments SET cheered_at = $2 WHERE id = ANY($1::int[])', [rows.map((a) => a.id), now.toISOString()]);
  }
  return { sent, held };
}

/** Today's targets with whether a text can reach the person, for the Manager page. */
export async function targetReach(list, { now = new Date() } = {}) {
  const { staffByEmail } = await import('./staff-texts');
  return Promise.all(list.map(async (a) => ({
    ...a,
    hasPhone: a.email ? !!(await staffByEmail(a.email))?.phoneKey : false,
    onClock: a.email ? await onClock(a.email, now).catch(() => null) : null
  })));
}

/** The scheduled pass: the morning brief once a day from 7am, then targets as people arrive. */
export async function runExecPass({ now = new Date(), dry = false, fetchImpl = fetch } = {}) {
  if (!hasDb()) return { ok: true, skipped: 'no database' };
  if (dry) {
    const { snapshot } = await buildReview({ now, commit: false, fetchImpl });
    return { ok: true, dry: true, snapshot, html: briefHtml(snapshot) };
  }
  if (!isProduction()) return { ok: true, skipped: 'not production' };
  const today = torontoToday(now);
  const out = { ok: true };
  if (torontoHour(now) >= BRIEF_HOUR) {
    // One atomic claim: of two overlapping passes, one writes the row.
    await getSetting(SENT_KEY, null);
    const claim = await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now() WHERE settings.value IS DISTINCT FROM $2::jsonb
       RETURNING key`, [SENT_KEY, JSON.stringify(today)]);
    if (claim.rows.length) {
      try {
        const { snapshot } = await buildReview({ now, fetchImpl });
        const cfg = await getExecConfig();
        out.brief = { targets: snapshot.targets.length, plays: snapshot.plays.length, blind: snapshot.blind.length };
        if (cfg.emailBrief) {
          const r = await sendEmail({ to: SERVICE_EMAIL, subject: `Manager's brief: ${snapshot.verdict}`.slice(0, 180), html: briefHtml(snapshot) });
          if (!r || r.ok === false) throw new Error('the brief email did not send');
          out.brief.emailed = true;
        }
      } catch (e) {
        // Give the day back, so the next pass tries again.
        await query('DELETE FROM settings WHERE key = $1', [SENT_KEY]);
        throw e;
      }
    }
  }
  out.texts = await textTargets({ now });
  out.pushes = await pushTargets({ now, fetchImpl });
  return out;
}

// What the phone call reads. NEVER builds a review: that takes longer than a call
// can stay silent. It says how old the figures are instead.
export async function reviewForCall(part) {
  const s = await latestReview();
  if (!s) return { error: 'I have not done a business review yet. It runs at 7am, or press "Review now" on the Manager page.' };
  const asOf = { reviewedAt: s.at, hoursOld: Math.round((Date.now() - Date.parse(s.at)) / 3600_000), notRead: s.blind };
  if (part === 'scoreboard') return { ...asOf, verdict: s.verdict, judgement: s.judgement, profit: s.pnl, revenueLines: s.streams, whoClosed: s.salesShare, topMoves: s.plays.slice(0, 5) };
  if (part === 'people') return { ...asOf, people: s.people.map((p) => ({ name: p.name, paidHours: p.hours, wages: p.cost, output: p.line, concerns: p.flags.map((f) => f.text) })), coaching: s.judgement?.coaching || [] };
  if (part === 'floor') return s.flow ? { ...asOf, constraint: s.flow.constraint?.label || null, stages: s.flow.stages.map(({ sample, ...x }) => x), parked: s.flow.parked, finishedNotOnWebsite: s.flow.readyNotOnSite?.slice(0, 8) ?? 'not checked' } : { ...asOf, error: 'I could not read the refurb floor.' };
  const targets = await assignmentsOn(torontoToday()).catch(() => []);
  return { ...asOf, todaysTargets: targets.map((a) => ({ name: a.name, target: `${a.target} ${METRICS[a.metric] || a.metric}`, told: !!a.texted_at })), yesterday: s.yesterday, topMoves: s.plays.slice(0, 5) };
}
