// Granting and revoking staff roles. ADMIN ONLY — this hands somebody the keys.
//
// The environment lists (ADMIN_EMAILS / SALES_EMAILS) are not editable here and
// deliberately so: they are the floor that guarantees the owner can always get
// in, and a screen that could remove the last admin is a screen that will.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { grantRole, revokeRole, listStaffAccess, ROLES } from '../../../../lib/staff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json({
    grants: await listStaffAccess(),
    // Shown so the screen can say who holds access WITHOUT a grant, which is
    // otherwise invisible and is most of the admins.
    fromEnv: {
      admin: (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean),
      sales: (process.env.SALES_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean)
    }
  });
}

export async function POST(req) {
  const session = await admin();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  let body; try { body = await req.json(); } catch { body = {}; }
  const role = String(body.role || '');
  if (!ROLES.includes(role)) return NextResponse.json({ error: `Pick a role: ${ROLES.join(' or ')}.` }, { status: 400 });

  try {
    const res = await grantRole({ email: body.email, role, note: body.note, by: session.email });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  const session = await admin();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const url = new URL(req.url);
  const email = url.searchParams.get('email') || '';
  const role = url.searchParams.get('role') || '';
  if (!ROLES.includes(role)) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 });

  // Revoking YOURSELF is allowed only if the environment list would still let
  // you in — otherwise the last admin can lock the business out of its own
  // admin screens, and the only way back is a redeploy.
  const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (email.toLowerCase() === String(session.email).toLowerCase()
      && role === 'admin'
      && !envAdmins.includes(String(session.email).toLowerCase())) {
    return NextResponse.json(
      { error: 'That would remove your own admin access, and you are not on ADMIN_EMAILS — you would not be able to undo it without a redeploy.' },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await revokeRole({ email, role, by: session.email }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
