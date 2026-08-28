'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queueAction, flush, pending, newRef } from '../lib/driver-outbox';
import { cashAtTheDoor } from '../lib/cash-at-the-door';
import { formatPhone } from '../lib/constants';
import DriverFinish from './DriverFinish';
import DriverPhotos from './DriverPhotos';
import DriverShift from './DriverShift';
import ReviewQr from './ReviewQr';

// The driver's day. Designed for one hand, in a van, in the sun: big targets,
// one obvious next action per stop, and no screen that needs reading.
//
// Nothing here waits on the network to feel finished. Every action is written to
// the offline queue and applied to what's on screen straight away; the queue
// drains whenever there's signal. A driver never sees a spinner they can't get
// out of.

const SHIPMENT = { white_glove: 'WHITE GLOVE — into the room', threshold: 'THRESHOLD — to the door' };
const SERVICE_LABEL = {
  delivery_only: 'Delivery only', install: 'Install', haul_away: 'Haul away',
  exchange: 'Exchange', return_pickup: 'Return pickup', parts_drop: 'Parts drop-off', warranty: 'Warranty'
};
const FAIL_REASONS = {
  no_answer: 'Nobody home', refused: 'Customer refused', wrong_address: 'Wrong / bad address',
  no_access: "Wouldn't fit / no access", damaged: 'Item damaged',
  rescheduled: 'Customer rescheduled', other: 'Other'
};

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
const minsBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const asDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

const fullAddress = (s) => [s.address, s.city, s.postal].filter(Boolean).join(', ');
const mapsUrl = (a) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`;
const windowLabel = (s) => (s.windowStart && s.windowEnd ? `${s.windowStart}–${s.windowEnd}` : 'Any time');

export default function DriverStops({ initial, driverName }) {
  const [stops, setStops] = useState(initial.stops || []);
  // Tomorrow's work, so the night before is plannable. Kept apart from `stops`
  // on purpose: nothing here can be started, finished or failed today.
  const [tomorrow, setTomorrow] = useState(initial.tomorrow || []);
  const [showNext, setShowNext] = useState(false);
  const [date] = useState(initial.date);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [finishing, setFinishing] = useState(null);   // the stop being closed out
  const [adding, setAdding] = useState(null);         // a finished stop getting more photos
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const [reviewFor, setReviewFor] = useState(null);   // the stop we're asking on
  const [reviewUrl, setReviewUrl] = useState(initial.reviewUrl || '');

  // Reload from the server, but never over the top of unsent work — the queue is
  // the truth until it has drained.
  const refresh = useCallback(async () => {
    try {
      const left = (await pending()).length;
      setQueued(left);
      if (left > 0) return;
      const res = await fetch('/api/driver/jobs', { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      if (Array.isArray(d.stops)) setStops(d.stops);
      if (Array.isArray(d.tomorrow)) setTomorrow(d.tomorrow);
      if (typeof d.reviewUrl === 'string') setReviewUrl(d.reviewUrl);
    } catch { /* offline: keep what's on screen */ }
  }, []);

  const push = useCallback(async () => {
    const { left } = await flush();
    setQueued(left);
    if (left === 0) refresh();
  }, [refresh]);

  useEffect(() => {
    const on = () => { setOnline(true); push(); };
    const off = () => setOnline(false);
    setOnline(navigator.onLine !== false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    push();
    // A van drives in and out of signal without firing an 'online' event, so the
    // queue also gets a nudge on a timer.
    timer.current = setInterval(push, 30000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(timer.current);
    };
  }, [push]);

  // Optimistic local update + queued action.
  async function act(stop, patch, body) {
    setErr('');
    setStops((xs) => xs.map((s) => (s.id === stop.id ? { ...s, ...patch } : s)));
    await queueAction({ kind: 'patch', jobId: stop.id, body: { jobId: stop.id, ...body }, ref: newRef() });
    push();
  }

  // Photos onto a stop that's already done. Same queue as everything else, so a
  // driver standing in a basement can still add them and drive off.
  async function addPhotos(stop, blobs) {
    setErr('');
    await queueAction({ kind: 'photos', jobId: stop.id, photos: blobs, fields: { mode: 'photos' }, ref: newRef() });
    setStops((xs) => xs.map((s) => (s.id === stop.id ? { ...s, photoCount: (s.photoCount || 0) + blobs.length } : s)));
    setAdding(null);
    push();
  }

  // Asking is what gets recorded. Whether a review was actually left is
  // something Google never tells us, and "we asked on 12 of 15" is a number the
  // office can act on in a way "we got 3 reviews" is not.
  function askedForReview(stop) {
    if (!stop?.id) return;
    queueAction({
      kind: 'patch', ref: newRef(),
      body: { jobId: stop.id, action: 'review_asked' }
    }).then(push).catch(() => {});
  }

  const start = (s) => act(s, { status: 'on_the_way' }, { action: 'status', status: 'on_the_way' });
  // Arriving starts the clock, and the driver has to be able to SEE that it
  // started — the whole reason the office was retyping these times out of the
  // group chat is that nothing on either screen ever showed them.
  const arrive = (s) => act(
    s,
    { status: 'arrived', timeIn: s.timeIn || new Date().toISOString() },
    { action: 'status', status: 'arrived' }
  );

  function couldNot(stop) {
    const keys = Object.keys(FAIL_REASONS);
    const answer = window.prompt(
      `Why couldn't it be completed?\n${keys.map((k, i) => `${i + 1}. ${FAIL_REASONS[k]}`).join('\n')}\n\nEnter a number:`
    );
    const pick = keys[Number(answer) - 1];
    if (!pick) return;
    const note = window.prompt('Anything to add? (optional)') || '';
    act(stop, { status: 'failed', failReason: pick }, { action: 'status', status: 'failed', failReason: pick, note });
  }

  const left = stops.filter((s) => !['done', 'failed'].includes(s.status));
  const closed = stops.filter((s) => ['done', 'failed'].includes(s.status));
  // Started on an earlier day and never finished. Forgetting to tap Done is the
  // single most common thing that happens on this screen, and until now the
  // driver was the last person to find out — the office noticed instead, days
  // later, and closed the stop out at whatever time they happened to look.
  const unfinished = left.filter((s) => s.overdue && s.timeIn);
  // What the driver should come back with today, both kinds of money together.
  // The run sheet totals this in its header and the phone did not, so a driver
  // working off the app had to add it up stop by stop — or find out at the end
  // of the day that they were short.
  const owed = left.reduce(
    (sum, s) => sum + (Number(s.balanceDue) || 0) + (cashAtTheDoor(s)?.amount || 0), 0
  );

  return (
    <div className="drv">
      <div className="drv-top">
        <div>
          <div className="drv-hello">{driverName ? `${driverName}` : 'Your stops'}</div>
          <div className="drv-date">{new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
        <div className="drv-left">
          {left.length} to go
          {owed > 0 && <div className="drv-owed">${owed.toFixed(2)} to collect</div>}
        </div>
      </div>

      {!online && (
        <div className="drv-offline">
          No signal — everything you tap is saved on the phone{queued > 0 ? ` (${queued} waiting)` : ''} and sent when you&apos;re back.
        </div>
      )}
      {online && queued > 0 && <div className="drv-sending">Sending {queued} saved {queued === 1 ? 'update' : 'updates'}…</div>}
      {err && <div className="error-box">{err}</div>}

      {/* The day AROUND the stops: clocking on, the van's odometer, and a
          fill-up on the road. Above the stop list because it is the first and
          last thing touched, and because a shift nobody started is a day nobody
          gets paid for. */}
      <DriverShift onChanged={push} />

      {unfinished.length > 0 && (
        <div className="drv-unfinished">
          You never finished {unfinished.length === 1 ? 'a stop' : `${unfinished.length} stops`} from an earlier day
          {unfinished[0].timeIn ? ` — still counting since ${hhmm(unfinished[0].timeIn)}` : ''}.
          Tap <b>Finish</b> on {unfinished.length === 1 ? 'it' : 'them'} below, or tell the office the real time you
          left and they&apos;ll put it in.
        </div>
      )}

      {stops.length === 0 && (
        <div className="drv-card"><p className="hint" style={{ margin: 0 }}>No stops today. The office will text you if that changes.</p></div>
      )}

      {left.map((s, i) => (
        <StopCard key={s.id} stop={s} n={i + 1}
          onStart={() => start(s)} onArrive={() => arrive(s)}
          onFinish={() => setFinishing(s)} onFail={() => couldNot(s)} />
      ))}

      {closed.length > 0 && (
        <>
          <h2 className="drv-sub">Finished</h2>
          {closed.map((s) => (
            <StopCard key={s.id} stop={s} done
              onAddPhotos={() => setAdding(s)}
              onReview={reviewUrl && s.status === 'done' ? () => setReviewFor(s) : null} />
          ))}
        </>
      )}

      {reviewFor && reviewUrl && (
        <ReviewQr url={reviewUrl} onClose={() => setReviewFor(null)}
          onAsked={() => askedForReview(reviewFor)} />
      )}

      {adding && (
        <DriverPhotos
          stop={adding}
          onClose={() => setAdding(null)}
          onAdded={(blobs) => addPhotos(adding, blobs)}
        />
      )}

      {tomorrow.length > 0 && (
        <>
          <button type="button" className="drv-next-head" onClick={() => setShowNext((v) => !v)} aria-expanded={showNext}>
            <span>Tomorrow · {tomorrow.length} stop{tomorrow.length === 1 ? '' : 's'}</span>
            <span>{showNext ? 'hide' : 'show'}</span>
          </button>
          {showNext && (
            <>
              <p className="hint" style={{ margin: '0 0 8px' }}>
                For planning tonight. You can&apos;t start these until tomorrow.
              </p>
              {tomorrow.map((s, i) => <StopCard key={s.id} stop={s} n={i + 1} preview />)}
            </>
          )}
        </>
      )}

      {finishing && (
        <DriverFinish
          stop={finishing}
          onClose={() => setFinishing(null)}
          onDone={(patch) => {
            setStops((xs) => xs.map((s) => (s.id === finishing.id ? { ...s, status: 'done', ...patch } : s)));
            setFinishing(null);
            push();
          }}
        />
      )}
    </div>
  );
}

function StopCard({ stop, n, done, preview, onStart, onArrive, onFinish, onFail, onAddPhotos, onReview }) {
  const addr = fullAddress(stop);
  const isService = stop.type === 'service_call';
  const cash = cashAtTheDoor(stop);
  return (
    <div className={'drv-card' + (done ? ' is-done' : '') + (preview ? ' is-preview' : '')}>
      <div className="drv-card-top">
        <span className="drv-n">{done ? (stop.status === 'failed' ? '✕' : '✓') : n}</span>
        <span className="drv-win">{windowLabel(stop)}</span>
        {stop.overdue && <span className="drv-late">from {stop.jobDate}</span>}
      </div>

      <div className="drv-who">{stop.customerName || '(no name)'}</div>
      {/* Readable, not just dialable. A driver reads this number out to whoever
          answers the door, or to the office — a Call button alone can't be read
          aloud, and 5483335001 can't be read at all. */}
      {stop.phone && (
        <div className="drv-phone"><a href={`tel:${stop.phone}`}>{formatPhone(stop.phone)}</a></div>
      )}
      {/* Two on one van: both see the stop and either can close it out. Saying
          who else is on it stops both of them finishing it twice. */}
      {stop.mateName && (
        <div className="drv-mate">
          {stop.helping ? `Riding with ${stop.mateName}` : `With ${stop.mateName}`}
        </div>
      )}
      {stop.pickupAddress && (
        <div className="drv-addr">
          <b>FROM</b> {[stop.pickupAddress, stop.pickupCity].filter(Boolean).join(', ')}
          {/* Who to ring at the pickup end. A locked door with nobody to call is
              how a transfer turns into a wasted morning. */}
          {(stop.pickupCompany || stop.pickupName || stop.pickupPhone) && (
            <div className="drv-pickup-who">
              {[stop.pickupCompany, stop.pickupName].filter(Boolean).join(' · ')}
              {stop.pickupPhone && (
                <> · <a href={`tel:${stop.pickupPhone}`}>{formatPhone(stop.pickupPhone)}</a></>
              )}
            </div>
          )}
        </div>
      )}
      <div className="drv-addr">{stop.pickupAddress ? <b>TO </b> : null}{addr}</div>

      {stop.balanceDue > 0 && (
        // The one number on this screen that costs money to miss.
        <div className="drv-collect">COLLECT ${Number(stop.balanceDue).toFixed(2)}{stop.invoiceNumber ? ` · ${stop.invoiceNumber}` : ''}</div>
      )}

      {/* Cash the customer hands over that is nothing to do with an invoice —
          a haul-away they pay for at the door, a client's own surcharge. The
          driver is the one holding the bag if it is missed, and until now it
          was one clause inside the grey notes paragraph. */}
      {cash && (
        <>
          {/* The loud block holds the AMOUNT and nothing else, exactly as the
              run sheet's black box does — quoting the client's sentence inside
              it made the one thing that has to be read at a glance into three
              lines of dense italic, and that sentence is printed in full lower
              down this same card anyway. "CASH AT THE DOOR" rather than another
              "COLLECT", so a stop carrying both an invoice balance and cash
              doesn't show two near-identical blocks. */}
          <div className="drv-cash">${cash.amount.toFixed(2)} CASH AT THE DOOR</div>
          <div className="drv-cash-src">
            {cash.typed ? (cash.note || 'agreed with the office') : 'read off the note — check it before you ask'}
          </div>
        </>
      )}

      {(stop.tradeIns?.length > 0 || stop.services?.includes('trade_in')) && (
        // The other thing on this screen that costs money to miss: an appliance
        // we have already bought and have to come back with.
        <div className={'drv-tradein' + (stop.tradeInCollected ? ' is-done' : '')}>
          {stop.tradeInCollected ? 'TRADE-IN ON THE VAN' : 'BRING BACK'}
          {stop.tradeIns?.length
            ? stop.tradeIns.map((t, i) => <div key={i} className="drv-tradein-unit">{t.description}</div>)
            : <div className="drv-tradein-unit">See the notes</div>}
        </div>
      )}

      {stop.shipmentType && <div className="drv-glove">{SHIPMENT[stop.shipmentType] || stop.shipmentType}</div>}

      <div className="drv-what">
        {isService
          ? [stop.appliance, stop.issue].filter(Boolean).join(' — ') || 'Service call'
          : (stop.items?.length ? stop.items.map((i) => i.description).join(' · ') : '—')}
      </div>
      {stop.services?.length > 0 && (
        <div className="drv-svc">{stop.services.map((k) => SERVICE_LABEL[k] || k).join(' · ')}</div>
      )}
      {stop.notes && <div className="drv-note">{stop.notes}</div>}
      <div className="drv-ref">
        {stop.ticketNumber || stop.jobNumber}
        {stop.orderNumber ? ` · ${stop.orderNumber}` : ''}
        {stop.clientName ? ` · ${stop.clientName}` : ''}
      </div>
      {/* The clock, where the person running it can see it. */}
      {stop.timeIn && (
        <div className="drv-clock">
          {stop.timeOut
            ? `⏱ ${hhmm(stop.timeIn)}–${hhmm(stop.timeOut)} · ${asDuration(minsBetween(stop.timeIn, stop.timeOut))}`
            : `⏱ on site since ${hhmm(stop.timeIn)} · ${asDuration(minsBetween(stop.timeIn, Date.now()))}`}
        </div>
      )}

      {preview ? (
        // Look, plan, ring ahead — but not start. The buttons that change a
        // stop's state are deliberately absent until it's actually today.
        <div className="drv-row">
          <a className="drv-btn" href={mapsUrl(addr)} target="_blank" rel="noopener noreferrer">🧭 Navigate</a>
          {stop.phone && <a className="drv-btn" href={`tel:${stop.phone}`}>📞 Call</a>}
          {stop.pickupPhone && <a className="drv-btn" href={`tel:${stop.pickupPhone}`}>📞 Call pickup</a>}
        </div>
      ) : done ? (
        <>
          <div className="drv-doneline">
            {stop.status === 'failed'
              ? (FAIL_REASONS[stop.failReason] || "Couldn't complete")
              : `Done${stop.hasSignature ? ' · signed' : ''}${stop.photoCount ? ` · ${stop.photoCount} photo${stop.photoCount === 1 ? '' : 's'}` : ''}`}
          </div>
          {/* The pictures are what a driver remembers after walking away. Without
              this the only route was texting them to the office. */}
          {onReview && (
            <button type="button" className="drv-btn go" onClick={onReview}>
              ⭐ Ask for a Google review
            </button>
          )}
          {onAddPhotos && (
            <button type="button" className="drv-btn small" onClick={onAddPhotos}>
              📷 {stop.photoCount ? 'Add more photos' : 'Add photos'}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="drv-row">
            <a className="drv-btn" href={mapsUrl(addr)} target="_blank" rel="noopener noreferrer">🧭 Navigate</a>
            {stop.phone && (
              <a className="drv-btn" href={`tel:${stop.phone}`}>📞 Call{stop.pickupPhone ? ' drop-off' : ''}</a>
            )}
            {stop.pickupPhone && <a className="drv-btn" href={`tel:${stop.pickupPhone}`}>📞 Call pickup</a>}
          </div>
          <div className="drv-row">
            {stop.status === 'scheduled' || stop.status === 'unscheduled' ? (
              <button type="button" className="drv-btn go" onClick={onStart}>🚚 On the way</button>
            ) : stop.status === 'on_the_way' ? (
              <button type="button" className="drv-btn go" onClick={onArrive}>📍 Arrived</button>
            ) : (
              <button type="button" className="drv-btn go" onClick={onFinish}>✅ Finish stop</button>
            )}
            {stop.status === 'arrived' ? null : (
              <button type="button" className="drv-btn" onClick={onFinish}>✅ Finish</button>
            )}
            <button type="button" className="drv-btn bad" onClick={onFail}>✕ Couldn&apos;t</button>
          </div>
        </>
      )}
    </div>
  );
}
