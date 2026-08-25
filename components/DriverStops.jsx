'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queueAction, flush, pending, newRef } from '../lib/driver-outbox';
import DriverFinish from './DriverFinish';

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

const fullAddress = (s) => [s.address, s.city, s.postal].filter(Boolean).join(', ');
const mapsUrl = (a) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`;
const windowLabel = (s) => (s.windowStart && s.windowEnd ? `${s.windowStart}–${s.windowEnd}` : 'Any time');

export default function DriverStops({ initial, driverName }) {
  const [stops, setStops] = useState(initial.stops || []);
  const [date] = useState(initial.date);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [finishing, setFinishing] = useState(null);   // the stop being closed out
  const [err, setErr] = useState('');
  const timer = useRef(null);

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

  const start = (s) => act(s, { status: 'on_the_way' }, { action: 'status', status: 'on_the_way' });
  const arrive = (s) => act(s, { status: 'arrived' }, { action: 'status', status: 'arrived' });

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

  return (
    <div className="drv">
      <div className="drv-top">
        <div>
          <div className="drv-hello">{driverName ? `${driverName}` : 'Your stops'}</div>
          <div className="drv-date">{new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
        <div className="drv-left">{left.length} to go</div>
      </div>

      {!online && (
        <div className="drv-offline">
          No signal — everything you tap is saved on the phone{queued > 0 ? ` (${queued} waiting)` : ''} and sent when you&apos;re back.
        </div>
      )}
      {online && queued > 0 && <div className="drv-sending">Sending {queued} saved {queued === 1 ? 'update' : 'updates'}…</div>}
      {err && <div className="error-box">{err}</div>}

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
          {closed.map((s) => <StopCard key={s.id} stop={s} done />)}
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

function StopCard({ stop, n, done, onStart, onArrive, onFinish, onFail }) {
  const addr = fullAddress(stop);
  const isService = stop.type === 'service_call';
  return (
    <div className={'drv-card' + (done ? ' is-done' : '')}>
      <div className="drv-card-top">
        <span className="drv-n">{done ? (stop.status === 'failed' ? '✕' : '✓') : n}</span>
        <span className="drv-win">{windowLabel(stop)}</span>
        {stop.overdue && <span className="drv-late">from {stop.jobDate}</span>}
      </div>

      <div className="drv-who">{stop.customerName || '(no name)'}</div>
      {stop.pickupAddress && (
        <div className="drv-addr"><b>FROM</b> {[stop.pickupAddress, stop.pickupCity].filter(Boolean).join(', ')}</div>
      )}
      <div className="drv-addr">{stop.pickupAddress ? <b>TO </b> : null}{addr}</div>

      {stop.balanceDue > 0 && (
        // The one number on this screen that costs money to miss.
        <div className="drv-collect">COLLECT ${Number(stop.balanceDue).toFixed(2)}{stop.invoiceNumber ? ` · ${stop.invoiceNumber}` : ''}</div>
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

      {done ? (
        <div className="drv-doneline">
          {stop.status === 'failed'
            ? (FAIL_REASONS[stop.failReason] || "Couldn't complete")
            : `Done${stop.hasSignature ? ' · signed' : ''}${stop.photoCount ? ` · ${stop.photoCount} photo${stop.photoCount === 1 ? '' : 's'}` : ''}`}
        </div>
      ) : (
        <>
          <div className="drv-row">
            <a className="drv-btn" href={mapsUrl(addr)} target="_blank" rel="noopener noreferrer">🧭 Navigate</a>
            {stop.phone && <a className="drv-btn" href={`tel:${stop.phone}`}>📞 Call</a>}
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
