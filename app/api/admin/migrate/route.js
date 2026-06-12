import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, getPool } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

// Runs db/schema.sql against POSTGRES_URL. Everything in the schema is
// IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so this is safe to re-run.
// Admin-gated: log in with an ADMIN_EMAILS account first, then open
// /api/admin/migrate (GET) or hit it from the /admin page button.
async function freshDatabase() {
  // Bootstrap mode: if the users table doesn't exist yet, this is a brand-new
  // database — allow an unauthenticated first migration so the owner can
  // create tables BEFORE any account can exist. Once users exists, admin-only.
  try {
    const r = await getPool().query("SELECT to_regclass('public.users') AS t");
    return !r.rows[0].t;
  } catch { return false; }
}

async function run() {
  if (!hasDb()) {
    return NextResponse.json({ error: 'POSTGRES_URL is not set.' }, { status: 503 });
  }
  const bootstrap = await freshDatabase();
  if (!bootstrap) {
    const session = await getSession();
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Not authorized — log in with an admin account first.' }, { status: 403 });
    }
  }
  try {
    const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
    await getPool().query(sql); // multi-statement simple query
    return NextResponse.json({ ok: true, message: 'Schema applied (users, orders, order_items, reservations).' });
  } catch (e) {
    console.error('migrate failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET() { return run(); }
export async function POST() { return run(); }
