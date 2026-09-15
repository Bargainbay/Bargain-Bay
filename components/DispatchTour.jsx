'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// The walkthrough a new dispatch coordinator gets the first time they open the
// board, and can replay from the "Take the tour" button afterwards.
//
// It TEACHES THE MAP, it does not drive the page. Every step points at a control
// that is already on screen and says what is behind it; nothing here switches
// tabs, loads a panel or presses anything on her behalf. Two reasons: a tour
// that clicks things is a tour that can leave real state behind it — a pulled
// order, an opened import — and a person who was walked through a page by a
// robot has watched a demo rather than learned where anything is.
//
// ANY STEP WHOSE TARGET IS MISSING IS SKIPPED, not rendered against an empty
// rectangle. Half these targets are conditional: the money queue only exists
// when a driver has reported cash, and Times / Billing / Pay / Profit are not
// rendered at all for a sales associate. A tour that stops dead on a tab the
// viewer was never given is worse than one that quietly runs shorter.
const STEPS = [
  {
    key: null,
    title: 'Welcome to dispatch',
    body: 'This one page is the whole job — every delivery, every driver, every day. Two minutes and you will know where everything lives. You can stop any time and pick it up again from “Take the tour”.'
  },
  {
    key: 'tab-board',
    title: 'The board is one day',
    body: 'Each card is one stop. They sit in columns by driver, and the column on the left is everything nobody is carrying yet.'
  },
  {
    key: 'date',
    title: 'Move between days',
    body: 'These arrows change the day. Tomorrow’s run gets planned today, so you will use them more than you would think.'
  },
  {
    key: 'money',
    title: 'Money the drivers took',
    body: 'Cash a driver reported collecting at the door. It is a claim until you confirm it here — confirming is the thing that marks the invoice paid, so count it first. If the money never arrived, reject it and the balance stays owing.'
  },
  {
    key: 'pull',
    title: 'Bring in shop deliveries',
    body: 'Pulls today’s Bargain Bay orders onto the board. If it leaves something out it tells you which order and why, so a blank result is never a mystery.'
  },
  {
    key: 'tab-import',
    title: 'Client sheets land here',
    body: 'Spreadsheets and carrier notices arrive as a draft, never straight onto the board. Read every row before you approve it — an address read off a PDF is a guess until a person agrees with it.'
  },
  {
    key: 'tab-tickets',
    title: 'Service calls',
    body: 'Repairs, kept apart from deliveries. One ticket is one customer’s problem and can take several visits, which is why a second trip is a revisit rather than a new ticket.'
  },
  {
    key: 'tab-live',
    title: 'Where the vans are',
    body: 'A driver’s phone can only report its position while the app is open, so this is a trail of where they have been, not a dot moving down the road. Grey means last known. Ring the driver before you promise a customer a time.'
  },
  {
    key: 'tab-stale',
    title: 'Loose ends',
    body: 'Stops whose day has passed that nobody closed. Clear them while somebody still remembers what happened — and close them with the real times, not the time you noticed.'
  },
  {
    key: 'tab-times',
    title: 'The clock',
    body: 'Every stop wants a time in and a time out. This is what a delivery is costed on, so a missing or backwards clock is a wrong number rather than untidiness. You can type the real times in here.'
  },
  {
    key: 'tab-billing',
    title: 'Billing the clients',
    body: 'Finished jobs per client that have not been invoiced yet. One button raises the invoice. Set what a job charges on its own card as you go — it is much harder to reconstruct a fortnight later.'
  },
  {
    key: 'tab-setup',
    title: 'Clients and drivers',
    body: 'Add a client company, add a van, add a driver and text them their sign-in link. New logistics work starts here: add the company, then put their stops on the board.'
  },
  {
    key: null,
    title: 'That is the tour',
    body: 'Nothing here can be broken by having a look — a cancelled stop can be reopened, and every card keeps a History button showing who changed what. Run this again any time from “Take the tour”.'
  }
];

const PAD = 8;

export default function DispatchTour({ open, onClose, name }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [live, setLive] = useState(STEPS);
  const cardRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Which steps can actually run, decided when the tour opens rather than per
  // render: the answer must not change under her feet as panels come and go.
  useEffect(() => {
    if (!open) return;
    setLive(STEPS.filter((s) => !s.key || document.querySelector(`[data-tour="${s.key}"]`)));
    setI(0);
  }, [open]);

  const step = live[i] || null;

  const measure = useCallback(() => {
    if (!step) return;
    if (!step.key) { setRect(null); return; }
    const el = document.querySelector(`[data-tour="${step.key}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step]);

  useEffect(() => {
    if (!open || !step) return;
    const el = step.key ? document.querySelector(`[data-tour="${step.key}"]`) : null;
    if (el) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
    // Measure after the scroll has settled, then keep measuring while the page moves.
    const t = setTimeout(measure, 240);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, step, measure]);

  const done = useCallback(() => { closeRef.current?.(); }, []);
  const next = useCallback(() => setI((v) => (v + 1 < live.length ? v + 1 : (done(), v))), [live.length, done]);
  const back = useCallback(() => setI((v) => Math.max(0, v - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, done]);

  useEffect(() => { if (open) cardRef.current?.focus(); }, [open, i]);

  if (!open || !step) return null;

  const last = i === live.length - 1;
  // Below the highlight when there is room, above it when there is not, and
  // centred when the step points at nothing at all.
  let cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };
  if (rect) {
    const below = rect.top + rect.height + 14;
    const room = window.innerHeight - below > 230;
    const wide = Math.min(380, window.innerWidth - 32);
    let left = rect.left + rect.width / 2 - wide / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - wide - 16));
    cardStyle = room
      ? { top: below, left, width: wide }
      : { bottom: Math.max(16, window.innerHeight - rect.top + 14), left, width: wide };
  }

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Dispatch walkthrough">
      {rect
        ? <div className="tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
        : <div className="tour-veil" />}

      <div className="tour-card" style={cardStyle} ref={cardRef} tabIndex={-1}>
        <div className="tour-step">Step {i + 1} of {live.length}</div>
        <h3 className="tour-title">
          {i === 0 && name ? `Welcome to dispatch, ${name}` : step.title}
        </h3>
        <p className="tour-body">{step.body}</p>

        <div className="tour-dots" aria-hidden="true">
          {live.map((s, n) => <span key={s.key || `x${n}`} className={'tour-dot' + (n === i ? ' is-on' : '')} />)}
        </div>

        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={done}>
            {last ? 'Close' : 'Skip'}
          </button>
          <div className="tour-move">
            {i > 0 && <button type="button" className="btn" onClick={back}>Back</button>}
            <button type="button" className="btn accent" onClick={last ? done : next}>
              {last ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
