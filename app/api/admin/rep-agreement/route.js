// The owner's side of the rep agreement: the blanks only the company can fill, the open/closed switch for
// signing, who has signed, and the company's countersignature. ADMIN ONLY.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getFields, setFields, isOpen, setOpen, signatureList, countersign, buildDocs, AgreementError } from '../../../../lib/rep-agreements';
import { FIELD_DEFS, unresolvedItems, COMPANY_SIGNATORY } from '../../../../lib/employment-terms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const admin = async () => { const s = await getSession(); return s && isAdmin(s) ? s : null; };
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => NextResponse.json({ error: e?.message || 'That did not work.' }, { status: e instanceof AgreementError ? 400 : 500 });

async function overview() {
  const [fields, open, list, docs] = await Promise.all([getFields(), isOpen(), signatureList(), buildDocs({})]);
  return { defs: FIELD_DEFS, fields, open, list, signatory: COMPANY_SIGNATORY, unresolved: unresolvedItems(docs.employment, docs.confidentiality) };
}

export async function GET() {
  if (!(await admin())) return deny();
  try { return NextResponse.json(await overview()); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const session = await admin();
  if (!session) return deny();
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'set_fields') await setFields(session, b.fields);
    else if (b.action === 'set_open') await setOpen(session, b.open === true);
    else if (b.action === 'countersign') await countersign(session, b.rep, b.name);
    else return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await overview()) });
  } catch (e) { return fail(e); }
}
