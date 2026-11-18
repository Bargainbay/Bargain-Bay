// The Tech Manager's controls: switch it on, set the limits, choose who it looks after and
// each person's tone (banter on/off, Tamil), preview who would be texted, send a one-off
// text, and see what went out. ADMIN ONLY: this speaks to the team in the owner's name.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getTechConfig, saveTechConfig, setTechPerson, removeTechPerson, runTechManager } from '../../../../lib/tech-manager';
import { findStaff, sendStaffText, recentTexts } from '../../../../lib/staff-texts';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}

// GET            -> config + recent texts
// GET ?dry=1     -> the above plus a dry run: who would be texted, and the text (sends nothing)
export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  return NextResponse.json({
    config: await getTechConfig(),
    recent: await recentTexts({ limit: 40 }),
    ...(dry ? { dryRun: await runTechManager({ dry: true }) } : {})
  });
}

export async function POST(req) {
  const session = await admin();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    switch (body.action) {
      case 'save_config': {
        const { people, ...rest } = body.config || {};   // people are changed one at a time, below
        const config = await saveTechConfig(rest);
        await audit(session, { action: 'tech_manager.config', entity: 'settings', entityId: 'tech_manager', summary: 'Changed the Tech Manager settings', detail: rest });
        return NextResponse.json({ ok: true, config });
      }
      case 'set_person': {
        const config = await setTechPerson(body.person || {});
        await audit(session, { action: 'tech_manager.person', entity: 'settings', entityId: 'tech_manager', summary: `Set the Tech Manager's tone for ${body.person?.email}`, detail: body.person });
        return NextResponse.json({ ok: true, config });
      }
      case 'remove_person': {
        const config = await removeTechPerson(body.email);
        await audit(session, { action: 'tech_manager.person', entity: 'settings', entityId: 'tech_manager', summary: `Took ${body.email} off the Tech Manager's list` });
        return NextResponse.json({ ok: true, config });
      }
      case 'run':       // a real pass now (still needs the switch on, production and the window)
        return NextResponse.json({ ok: true, ...(await runTechManager({ dry: body.dry === true })) });
      case 'text': {    // one-off text to ONE staff member, looked up from their record
        const { matches } = await findStaff(body.who);
        if (matches.length !== 1) return NextResponse.json({ error: matches.length ? `More than one person fits: ${matches.map((m) => m.name).join(', ')}` : 'No staff member by that name.' }, { status: 400 });
        const r = await sendStaffText({ to: matches[0], body: body.message, kind: 'manual', sentBy: session.email, session });
        return NextResponse.json({ ok: r.ok, ...r }, { status: r.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not do that.' }, { status: 400 });
  }
}
