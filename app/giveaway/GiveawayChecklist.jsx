'use client';
import { useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';
import { BONUS, MAX_TICKETS, GIVEAWAY } from '../../lib/deals-config';

// Shown to someone who already has an entry (the signed link carries which). The
// account and the deals-and-flyers email were REQUIRED to get here, so they are
// not steps. What is left is optional: two ways to earn bonus entries: following us, and the costume contest.
const post = (body) => fetch('/api/giveaway/bonus', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));

function Step({ done, title, bonus, bonusText, children }) {
  return (
    <div className="check-step" data-done={done ? '1' : '0'}>
      <div className="check-mark" aria-hidden="true">{done ? '✓' : ''}</div>
      <div style={{ flex: 1 }}>
        <div className="check-title">{title} <span className="check-bonus">{bonusText || `+${bonus} ${bonus === 1 ? 'entry' : 'entries'}`}</span></div>
        {children}
      </div>
    </div>
  );
}

export default function GiveawayChecklist({ e, initial, instagramUrl, closesLabel }) {
  const [s, setS] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [ig, setIg] = useState(initial.instagram_handle || '');
  const [release, setRelease] = useState(false);
  const [progress, setProgress] = useState(0);
  const file = useRef(null);

  async function act(step, body) {
    setBusy(step); setErr('');
    try {
      const { ok, d } = await post({ e, ...body });
      if (!ok) { setErr(d.error || 'Something went wrong.'); return false; }
      setS(d.status); return true;
    } catch { setErr('Network error. Please try again.'); return false; } finally { setBusy(''); }
  }

  async function sendPhoto() {
    const f = file.current?.files?.[0];
    if (!f) { setErr('Choose a photo first.'); return; }
    if (!release) { setErr('Please tick the box that lets us share your photo.'); return; }
    if (f.size > 20 * 1024 * 1024) { setErr('That photo is over 20 MB. Please send a smaller one.'); return; }
    setBusy('costume'); setErr(''); setProgress(0);
    try {
      const id = String(e).split('.')[0];
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
      const blob = await upload(`giveaway/${GIVEAWAY.id}/costume-${id}-${Date.now()}.${ext}`, f, {
        access: 'private', handleUploadUrl: '/api/giveaway/costume', clientPayload: e,
        onUploadProgress: (p) => setProgress(Math.round(p.percentage))
      });
      await act('costume', { action: 'costume', pathname: blob.pathname, release });
    } catch (x) {
      setErr(x?.message || 'The upload did not finish. Please try again.');
      setBusy('');
    }
  }

  const costumeLabel = s.costume_best ? 'Judged the best costume: +5 entries added!'
    : s.costume_status === 'approved' ? 'Received and approved. We pick the best costume after entries close.'
    : s.costume_status === 'pending' ? 'Received, being reviewed'
    : s.costume_status === 'rejected' ? 'We couldn’t use that one, send another' : '';

  return (
    <div className="panel" style={{ maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>You’re in, {s.name.split(' ')[0]}.</h2>
      <p style={{ fontSize: 15 }}>
        You have <b>{s.tickets} {s.tickets === 1 ? 'entry' : 'entries'}</b> (of a possible {MAX_TICKETS}).
        The two steps below are optional and earn bonus entries until {closesLabel}.
      </p>
      {err && <div className="error-box">{err}</div>}

      <Step done title="Entered the giveaway" bonus={1}>
        <div className="hint">Your Bargain Bay account and our deals and flyers email are set up. Confirmation sent to {s.email}.</div>
      </Step>

      <Step done={!!s.instagram_handle} title="Follow us on Instagram" bonus={BONUS.instagram}>
        {instagramUrl && <p style={{ margin: '4px 0' }}><a href={instagramUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Follow Bargain Bay on Instagram →</a></p>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 380 }}>
          <input value={ig} onChange={(ev) => setIg(ev.target.value)} placeholder="Your Instagram username" aria-label="Your Instagram username" />
          <button className="btn" disabled={busy === 'instagram'} onClick={() => act('instagram', { action: 'instagram', handle: ig })}>Save</button>
        </div>
        <div className="hint">We check that the winner follows us before the prize goes out.</div>
      </Step>

      <Step done={!!s.costume_best} title="Halloween costume contest" bonusText={`best costume: +${BONUS.costume} entries`}>
        <div className="hint">Send one photo of your Halloween costume. We pick the single best costume after entries close, and it earns +{BONUS.costume} entries. Sending a photo is optional and doesn’t change your base entry. Please: no children’s faces, and no one else’s face without their OK.</div>
        {costumeLabel && <div style={{ fontSize: 13.5, margin: '6px 0', fontWeight: 600 }}>{costumeLabel}</div>}
        {!s.costume_best && s.costume_status !== 'approved' && (
          <>
            <input ref={file} type="file" accept="image/*" style={{ margin: '8px 0' }} />
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45, cursor: 'pointer', fontWeight: 400 }}>
              <input type="checkbox" checked={release} onChange={(ev) => setRelease(ev.target.checked)} style={{ marginTop: 2, width: 'auto' }} />
              <span>I took this photo, everyone in it agrees, and Bargain Bay may share it on its website and social media.</span>
            </label>
            <button className="btn primary" style={{ marginTop: 8 }} disabled={busy === 'costume'} onClick={sendPhoto}>
              {busy === 'costume' ? `Uploading… ${progress}%` : 'Upload photo'}
            </button>
          </>
        )}
      </Step>

      <p className="hint" style={{ marginTop: 16 }}>Bookmark this page: it’s your link back. We’ve also emailed it to you.</p>
    </div>
  );
}
