// The CRM's working surface: the timeline and the follow-ups.
//
// STAFF, not admin. This is what a rep does with a customer on the phone —
// the same side of the line as quotes and invoices (see the gate rule in
// CLAUDE.md: the customer's sale, not the business's books). Nothing here
// exposes cost or profit.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import {
  logActivity, customerActivity, addTask, completeTask, reopenTask,
  customerTasks, myDay, ACTIVITY_KINDS
} from '../../../../lib/crm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function staff() {
  const s = await getSession();
  return s && isStaff(s) ? s : null;
}

export async function GET(req) {
  const session = await staff();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  if (sp.get('view') === 'my-day') {
    return NextResponse.json(await myDay({ email: session.email }));
  }
  const id = Number(sp.get('customer'));
  if (!id) return NextResponse.json({ error: 'Which customer?' }, { status: 400 });
  const [activity, tasks] = await Promise.all([customerActivity(id), customerTasks(id)]);
  return NextResponse.json({ activity, tasks, kinds: ACTIVITY_KINDS });
}

export async function POST(req) {
  const session = await staff();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    switch (body.action) {
      case 'log':
        // Stamped from the SESSION, never from the body — otherwise one rep
        // could log a call in another's name. Same rule as invoices.created_by.
        return NextResponse.json({
          ok: true,
          entry: await logActivity({
            customerId: body.customerId, kind: body.kind, body: body.body,
            byEmail: session.email, byName: session.name || null, at: body.at || null
          })
        });
      case 'task':
        return NextResponse.json({
          ok: true,
          task: await addTask({
            customerId: body.customerId, title: body.title, note: body.note,
            dueOn: body.dueOn || null,
            // Unassigned is a real choice, not a missing field: it means
            // "somebody should", and My Day shows those to everyone.
            ownerEmail: body.ownerEmail === undefined ? session.email : (body.ownerEmail || null),
            createdBy: session.email
          })
        });
      case 'done':
        return NextResponse.json(await completeTask(body.taskId, {
          by: session.email, outcome: body.outcome, note: body.note
        }));
      case 'reopen':
        return NextResponse.json(await reopenTask(body.taskId, { by: session.email }));
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
