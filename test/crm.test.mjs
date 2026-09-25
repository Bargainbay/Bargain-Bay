// lib/crm.js — what was said, and what happens next.
//
// Before this the CRM was a read-only history: it could say what somebody had
// bought and nothing about the conversation, and there was no way at all to
// write down "call them Thursday" — the single thing a salesperson needs a CRM
// for. `customers.notes` was one blob with no author and no date, where the
// second person to edit it silently overwrote the first.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { upsertCustomer, mergeCustomers } from '../lib/customers.js';
import {
  logActivity, customerActivity, addTask, completeTask, reopenTask,
  customerTasks, myDay, ACTIVITY_KINDS
} from '../lib/crm.js';
import { torontoToday } from '../lib/constants.js';

const fresh = () => withTestDb();
const ME = 'rep@rssolutions.ca';
const day = (offset) => {
  const d = new Date(`${torontoToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

suite('CRM — what was said');

test('a note is recorded with who said it and when it happened', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca', name: 'Sam' });
    await logActivity({ customerId: id, kind: 'call', body: 'Wants the LG set held till Friday', byEmail: ME, byName: 'A Rep' });
    const [e] = await customerActivity(id);
    equal(e.kind, 'call');
    equal(e.body, 'Wants the LG set held till Friday');
    equal(e.by_email, ME);
    equal(e.by_name, 'A Rep', 'the name is snapshotted, so it survives a departure');
  } finally { done(); }
});

test('WHEN IT HAPPENED is not always when it was typed', async () => {
  // A call logged the next morning still happened yesterday, and a timeline
  // that says otherwise is a timeline nobody trusts.
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca', name: 'Sam' });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await logActivity({ customerId: id, kind: 'call', body: 'rang them', at: yesterday });
    await logActivity({ customerId: id, kind: 'note', body: 'typed this morning' });
    const log = await customerActivity(id);
    equal(log[0].body, 'typed this morning', 'newest first');
    equal(log[1].body, 'rang them');
    assert(new Date(log[1].at) < new Date(log[0].at), 'the backdated one sorts by when it happened');
  } finally { done(); }
});

test('an unknown kind falls back to a note rather than being refused', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    await logActivity({ customerId: id, kind: 'telepathy', body: 'x' });
    equal((await customerActivity(id))[0].kind, 'note', 'losing the note would be worse');
    assert(ACTIVITY_KINDS.includes('system'), 'system is a kind, for what the app writes itself');
  } finally { done(); }
});

test('an empty note, or one for nobody, is not recorded', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    equal(await logActivity({ customerId: id, body: '   ' }), null);
    equal(await logActivity({ customerId: id }), null);
    equal(await logActivity({ body: 'orphan' }), null);
    equal(await customerActivity(id), []);
  } finally { done(); }
});

suite('CRM — what happens next');

test('a follow-up can be written down, which was the whole gap', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca', name: 'Sam' });
    const t = await addTask({ customerId: id, title: 'Call about the LG set', dueOn: day(0), ownerEmail: ME, createdBy: ME });
    assert(t.id);
    const [task] = await customerTasks(id);
    equal(task.title, 'Call about the LG set');
    equal(task.owner_email, ME);
    equal(task.done_at, null);
  } finally { done(); }
});

test('a follow-up needs a customer and a title', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    for (const bad of [{ customerId: id }, { customerId: id, title: '  ' }, { title: 'orphan' }]) {
      let err = null;
      try { await addTask(bad); } catch (e) { err = e; }
      assert(err, `should refuse ${JSON.stringify(bad)}`);
    }
  } finally { done(); }
});

test('completing one writes a line on the timeline', async () => {
  // "We said we would ring them and we did" is exactly what the timeline should
  // show, and the one place a system-written entry beats a typed one.
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    const t = await addTask({ customerId: id, title: 'Call about the LG set', ownerEmail: ME });
    const res = await completeTask(t.id, { by: ME, outcome: 'bought it' });
    assert(res.ok);

    const [entry] = await customerActivity(id);
    equal(entry.kind, 'system');
    assert(/Follow-up done: Call about the LG set/.test(entry.body));
    assert(/bought it/.test(entry.body), 'the outcome is on the record');
  } finally { done(); }
});

test('completing one twice is refused, not double-logged', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    const t = await addTask({ customerId: id, title: 'Call them' });
    assert((await completeTask(t.id, { by: ME })).ok);
    const again = await completeTask(t.id, { by: ME });
    equal(again.ok, false, 'already done');
    equal((await customerActivity(id)).length, 1, 'and only one line was written');
  } finally { done(); }
});

test('reopening is possible and is itself recorded', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    const t = await addTask({ customerId: id, title: 'Call them' });
    await completeTask(t.id, { by: ME });
    assert((await reopenTask(t.id, { by: ME })).ok);
    equal((await customerTasks(id))[0].done_at, null, 'open again');
    assert(/reopened/i.test((await customerActivity(id))[0].body));
  } finally { done(); }
});

suite('CRM — my day');

test('overdue, today and unowned are three buckets, not one list', async () => {
  // Lumping them produces a list whose length means nothing: a run of overdue
  // follow-ups reads the same as a quiet Tuesday.
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca', name: 'Sam' });
    await addTask({ customerId: id, title: 'LATE', dueOn: day(-3), ownerEmail: ME });
    await addTask({ customerId: id, title: 'TODAY', dueOn: day(0), ownerEmail: ME });
    await addTask({ customerId: id, title: 'NOBODY', dueOn: day(0) });

    const d = await myDay({ email: ME });
    equal(d.overdue.map((t) => t.title), ['LATE']);
    equal(d.today.map((t) => t.title), ['TODAY']);
    equal(d.unowned.map((t) => t.title), ['NOBODY']);
    equal(d.counts, { overdue: 1, today: 1, unowned: 1 });
  } finally { done(); }
});

test('NEXT WEEK IS NOT SHOWN', async () => {
  // A CRM that puts next week's work beside today's is a CRM people stop
  // reading.
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    await addTask({ customerId: id, title: 'LATER', dueOn: day(7), ownerEmail: ME });
    const d = await myDay({ email: ME });
    equal(d.counts, { overdue: 0, today: 0, unowned: 0 });
  } finally { done(); }
});

test('somebody ELSE’S follow-up is not on my day', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    await addTask({ customerId: id, title: 'THEIRS', dueOn: day(0), ownerEmail: 'other@rssolutions.ca' });
    equal((await myDay({ email: ME })).counts.today, 0);
    equal((await myDay({ email: 'other@rssolutions.ca' })).counts.today, 1);
  } finally { done(); }
});

test('an UNOWNED follow-up is shown to everybody, including one with no date', async () => {
  // The one most likely to be forgotten. A list scoped strictly to `me` would
  // never show it to anybody at all.
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    await addTask({ customerId: id, title: 'NOBODY, NO DATE' });
    for (const who of [ME, 'someone@else.ca']) {
      equal((await myDay({ email: who })).counts.unowned, 1, `${who} should see it`);
    }
  } finally { done(); }
});

test('a completed follow-up leaves my day', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca' });
    const t = await addTask({ customerId: id, title: 'Call them', dueOn: day(0), ownerEmail: ME });
    equal((await myDay({ email: ME })).counts.today, 1);
    await completeTask(t.id, { by: ME });
    equal((await myDay({ email: ME })).counts.today, 0);
  } finally { done(); }
});

test('my day carries enough to act without opening the customer', async () => {
  const { done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'sam@b.ca', name: 'Sam', phone: '4374888549' });
    await addTask({ customerId: id, title: 'Call about the LG set', dueOn: day(0), ownerEmail: ME });
    const [t] = (await myDay({ email: ME })).today;
    equal(t.customer_name, 'Sam');
    equal(t.customer_phone, '4374888549', 'the number is right there — that is the point');
    equal(t.customer_id, id);
  } finally { done(); }
});

suite('CRM — merging carries the history');

test('A MERGE MOVES BOTH THE TIMELINE AND THE FOLLOW-UPS', async () => {
  // Otherwise merging silently destroys them: both tables are ON DELETE
  // CASCADE against the record that gets removed.
  const { done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'work@x.ca', name: 'Sam' });
    const drop = await upsertCustomer({ email: 'home@x.ca', name: 'Sam' });
    await logActivity({ customerId: drop, kind: 'call', body: 'said to ring back Thursday', byEmail: ME });
    await addTask({ customerId: drop, title: 'Ring back Thursday', dueOn: day(0), ownerEmail: ME });

    await mergeCustomers(keep, drop);

    const log = await customerActivity(keep);
    assert(log.some((e) => /ring back Thursday/.test(e.body)), 'the note came across');
    const tasks = await customerTasks(keep);
    assert(tasks.some((t) => t.title === 'Ring back Thursday'), 'so did the follow-up');
    equal((await myDay({ email: ME })).counts.today, 1, 'and it is still on somebody’s day');
  } finally { done(); }
});
