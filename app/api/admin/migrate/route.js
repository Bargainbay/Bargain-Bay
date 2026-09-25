// Apply outstanding schema migrations. The /admin button, and a GET you can
// open in a browser.
//
// Behind it is lib/migrate, the same code `npm run migrate` runs, so the
// terminal and the browser can never disagree about what has been applied.
// Each migration runs in its own transaction and is recorded in
// schema_migrations; one already applied is skipped, not re-run.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, getPool } from '../../../../lib/db';
import { migrate, migrationStatus } from '../../../../lib/migrate';
import { captureError } from '../../../../lib/observe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Migrations take locks and the baseline is a thousand lines. The default is
// plenty today and would not be on a table that has grown.
export const maxDuration = 60;

// Bootstrap: on a brand-new database there is no `users` table and therefore no
// account that could be an admin, so the FIRST migration is allowed through
// unauthenticated. Once users exists, admin only.
async function freshDatabase() {
  try {
    const r = await getPool().query("SELECT to_regclass('public.users') AS t");
    return !r.rows[0].t;
  } catch { return false; }
}

async function authorized() {
  if (await freshDatabase()) return true;
  const session = await getSession();
  return !!(session && isAdmin(session));
}

async function run(req) {
  if (!hasDb()) return NextResponse.json({ error: 'POSTGRES_URL is not set.' }, { status: 503 });
  if (!(await authorized())) {
    return NextResponse.json({ error: 'Not authorized — log in with an admin account first.' }, { status: 403 });
  }

  // ?status=1 reports without changing anything — worth having before pressing
  // the button on a database you are not sure about.
  if (new URL(req.url).searchParams.get('status')) {
    return NextResponse.json(await migrationStatus());
  }

  const res = await migrate();
  if (!res.ok) {
    await captureError(new Error(res.error), {
      tags: { where: 'migrate' },
      extra: { failed: res.failed || null, rolledBack: !!res.rolledBack },
      fingerprint: `migrate:${res.failed || 'unknown'}`
    });
    return NextResponse.json(res, { status: 500 });
  }

  return NextResponse.json({
    ...res,
    message: res.applied.length
      ? `Applied ${res.applied.length} migration(s): ${res.applied.map((a) => a.id).join(', ')}.`
      : `Nothing to apply — up to date (${res.skipped.length} already applied).`
  });
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
