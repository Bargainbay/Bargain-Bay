// Sarah — web copilot endpoint. Admin-only. The browser keeps the transcript and
// posts it each turn; the agentic loop itself lives in lib/sarah (shared with the
// WhatsApp channel).
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { runSarah } from '../../../../lib/sarah';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Sarah isn’t configured yet (ANTHROPIC_API_KEY is missing).' }, { status: 503 });
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No user message.' }, { status: 400 });
  }

  try {
    const { reply, actions, stopReason } = await runSarah({ messages });
    return NextResponse.json({ reply, actions, stopReason });
  } catch (e) {
    console.error('sarah web error', e?.message || e);
    return NextResponse.json({ error: 'Sarah hit a snag talking to the model. Try again in a moment.' }, { status: 502 });
  }
}
