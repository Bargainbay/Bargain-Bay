'use client';
import { useEffect, useState } from 'react';
import { queueOrSend, newRef, flushShift, waitingShift, SHIFT_URL } from '../lib/driver-outbox';
import { compress } from './photo-pick';

// Clocking on and off, and the fill-up in between.
//
// Both go through the SAME offline queue as everything else on this screen. A
// driver picks the van up in an underground loading bay and fills up at a
// station with one bar of signal; neither moment is one to be told "try again".
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
// Every one of these used to be an unhandled rejection: the driver tapped, the
// promise died inside IndexedDB, and the form just sat there looking untouched.
// A driver who taps Save and sees NOTHING has no move left — not even a wrong
// one — so a failure here has to arrive as words on the screen.
const saveFailed = (e, fallback) =>
  `${e?.message || fallback} Try again where you have signal.`;
const asDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

const SAVED = 'Saved on this phone. It sends by itself as soon as it gets through.';

// What a start looks like on screen before the office has answered.
const asShift = (body, vans, crew) => ({
  startedAt: new Date(body.at).toISOString(),
  driving: body.driving,
  startKm: body.driving ? (body.startKm || null) : null,
  vehicleId: body.driving ? (body.vehicleId || null) : null,
  vehicleName: body.driving
    ? (vans.find((v) => String(v.id) === String(body.vehicleId))?.name || null) : null,
  ridingWithName: body.driving
    ? null : (crew.find((m) => String(m.id) === String(body.ridingWith))?.name || null)
});

export default function DriverShift({ onChanged }) {
  const [shift, setShift] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [mates, setMates] = useState([]);
  const [question, setQuestion] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(null);      // 'start' | 'end' | 'fuel'
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  async function load() {
    // Read what the phone still holds BEFORE asking the office: something not
    // sent yet beats what the office last knew, or the screen flips back to
    // "Start shift" and the driver is told their tap did nothing.
    const last = (await waitingShift()).filter((r) => ['start', 'end'].includes(r.body?.action)).pop();
    let d = null;
    const giveUp = new AbortController();
    const late = setTimeout(() => giveUp.abort(), 10000);
    try {
      const res = await fetch('/api/driver/shift', { cache: 'no-store', signal: giveUp.signal });
      if (res.status === 403) setErr('This phone is signed out. Sign in again to clock in or out.');
      const j = await res.json();
      if (!j.error) d = j;
    } catch { /* offline: whatever is on screen stays */ }
    finally { clearTimeout(late); }
    if (d) {
      setVehicles(d.vehicles || []);
      setMates(d.mates || []);
      setQuestion(last ? null : (d.question || null));
    }
    if (last) setShift(last.body.action === 'end' ? null : asShift(last.body, d?.vehicles || [], d?.mates || []));
    else if (d) {
      setShift(d.shift || null);
      setOk((m) => (m === SAVED ? '' : m));   // it has landed
    }
    setLoaded(true);
  }
  useEffect(() => {
    load();
    // The evening "still working?" turns up on its own, without a refresh.
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const refused = (e) => { setOk(''); setForm(null); setErr(e.detail?.message || 'That didn’t save.'); load(); };
    window.addEventListener('rs-shift-refused', refused);
    return () => window.removeEventListener('rs-shift-refused', refused);
  }, []);

  async function answer(a) {
    setQuestion(null);
    try {
      await fetch('/api/driver/shift', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'answer', answer: a }) });
    } catch { /* the next load shows it again if it did not land */ }
    // Saying no is the start of ending the shift, which needs the odometer.
    if (a === 'no') setForm('end');
  }
  // The running clock only moves in minutes.
  useEffect(() => {
    if (!shift) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [shift]);

  const running = shift?.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(shift.startedAt)) / 60000)) : 0;

  // Saved on the phone first, then sent straight away. Answers 'sent', 'drop'
  // or 'waiting'; throws only when neither the phone nor the network took it.
  async function clock(body) {
    const ref = newRef();
    const saved = await queueOrSend({ kind: 'patch', url: SHIFT_URL, ref, body });
    return saved.queued ? flushShift(ref) : saved.result;
  }

  async function begin({ driving, vehicleId, startKm, ridingWith }) {
    if (busy) return;
    setErr(''); setOk(''); setBusy(true);
    const body = { action: 'start', driving, vehicleId, startKm, ridingWith, at: Date.now() };
    try {
      const r = await clock(body);
      setForm(null);
      // Refused: the reason arrives with the 'rs-shift-refused' event above.
      if (r === 'drop') return;
      setShift(asShift(body, vehicles, mates));
      setOk(r === 'sent' ? 'Shift started.' : SAVED);
      onChanged?.();
      load();
    } catch (e) { setErr(saveFailed(e, 'That didn’t start.')); }
    finally { setBusy(false); }
  }

  async function finish(endKm) {
    if (busy) return;
    setErr(''); setOk('');
    // Checked here as well as on the server so the driver is told at the pump,
    // not tomorrow by the office.
    if (shift?.driving && endKm && shift?.startKm && Number(endKm) < Number(shift.startKm)) {
      setErr(`That reads lower than this morning's ${shift.startKm} km — is it the trip meter?`);
      return;
    }
    setBusy(true);
    try {
      const r = await clock({ action: 'end', endKm, at: Date.now() });
      setForm(null);
      if (r === 'drop') return;
      setShift(null);
      setOk(r === 'sent' ? 'Shift ended. Have a good night.' : SAVED);
      onChanged?.();
      load();
    } catch (e) { setErr(saveFailed(e, 'That didn’t save.')); }
    finally { setBusy(false); }
  }

  async function fuel({ amount, litres, odometer, note, receipt }) {
    setErr(''); setOk('');
    // The receipt is SHRUNK, exactly like every other photo this app sends. A
    // raw file straight off the camera roll is several megabytes of HEIC or
    // JPEG: too big for the phone's own storage to take happily, too big for
    // the upload limit, and on iOS not decodable by the fast path at all. The
    // close-out sheet has always done this; the fuel form was passing the file
    // through untouched, which is what made Save look dead.
    let blob = null;
    if (receipt) {
      try { blob = await compress(receipt); }
      catch { blob = receipt; }   // a big photo that arrives beats none at all
    }
    try {
      await queueOrSend({
        kind: 'photos', url: '/api/driver/fuel', ref: newRef(),
        fields: {
          amount, litres, odometer, note,
          vehicleId: shift?.vehicleId || '',
          // Toronto's date, never the handset's. A phone left on another
          // timezone would file the fill against the wrong day.
          date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
        },
        // The fuel route reads `receipt`. Sending it under the delivery
        // photos' name meant every receipt was uploaded and then ignored.
        photoField: 'receipt',
        photos: blob ? [blob] : []
      });
    } catch (e) { setErr(saveFailed(e, 'That fill didn’t save.')); return; }
    setForm(null);
    setOk(`Fuel $${Number(amount).toFixed(2)} saved${blob ? ' with the receipt' : ''}.`);
    onChanged?.();
  }

  if (!loaded) return null;

  return (
    <div className="drv-shift">
      {err && <div className="error-box">{err}</div>}
      {ok && <div className="drv-sending">{ok}</div>}

      {!shift ? (
        form === 'start'
          ? <StartForm vehicles={vehicles} mates={mates} busy={busy} onCancel={() => setForm(null)} onStart={begin} />
          : (
            <button type="button" className="drv-btn go drv-shift-btn" onClick={() => setForm('start')}>
              ▶ Start shift
            </button>
          )
      ) : (
        <>
          {question && (
            <div style={{ margin: '0 0 10px', padding: 12, border: '2px solid var(--warn)', borderRadius: 10 }}>
              <b style={{ fontSize: 17 }}>Are you still working?</b>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="drv-btn go" style={{ flex: 1 }} onClick={() => answer('yes')}>Yes, still working</button>
                <button type="button" className="drv-btn done" style={{ flex: 1 }} onClick={() => answer('no')}>No — end my shift</button>
              </div>
            </div>
          )}
          <div className="drv-shift-on">
            <span>
              <b>On shift {asDuration(running)}</b>
              <span className="drv-shift-sub">
                since {hhmm(shift.startedAt)}
                {shift.driving === false
                  ? ` · riding${shift.ridingWithName ? ` with ${shift.ridingWithName}` : ' along'}`
                  : (shift.vehicleName ? ` · ${shift.vehicleName}` : '')}
                {shift.driving !== false && shift.startKm ? ` · ${shift.startKm} km` : ''}
              </span>
            </span>
          </div>
          <div className="drv-row">
            {/* Whoever is at the pump files the fill, driver or the person riding
                along (owner, 2026-11-16: the assistant often pays and the driver
                forgets). A rider has no odometer reading to give; the van comes
                from the driver they ride with (see /api/driver/fuel). */}
            <button type="button" className="drv-btn" onClick={() => setForm(form === 'fuel' ? null : 'fuel')}>
              ⛽ Add fuel
            </button>
            <button type="button" className="drv-btn bad" onClick={() => setForm(form === 'end' ? null : 'end')}>
              ■ End shift
            </button>
          </div>
          {form === 'fuel' && (
            <FuelForm shift={shift} onCancel={() => setForm(null)} onSave={fuel} />
          )}
          {form === 'end' && <EndForm shift={shift} busy={busy} onCancel={() => setForm(null)} onEnd={finish} />}
        </>
      )}
    </div>
  );
}

// Driving or riding is the FIRST question, because the answer decides whether
// the rest of the form exists at all. A second crew member is on the clock and
// is not responsible for a van — asking them for an odometer is asking for a
// number they cannot see, and they will type something.
function StartForm({ vehicles, mates, busy, onCancel, onStart }) {
  const [driving, setDriving] = useState(null);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ? String(vehicles[0].id) : '');
  const [km, setKm] = useState('');
  const [ridingWith, setRidingWith] = useState('');

  if (driving === null) {
    return (
      <div className="drv-form">
        <div className="drv-form-q">Are you driving today?</div>
        <button type="button" className="drv-btn go" onClick={() => setDriving(true)}>
          🚚 I&apos;m driving
        </button>
        <button type="button" className="drv-btn" onClick={() => setDriving(false)}>
          🧍 I&apos;m riding with someone
        </button>
        <button type="button" className="drv-btn small" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <form
      className="drv-form"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ driving, vehicleId: vehicleId || null, startKm: km || null, ridingWith: ridingWith || null });
      }}
    >
      {driving ? (
        <>
          <label>Which van
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Not recorded</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label>Odometer now
            <input inputMode="numeric" value={km} autoFocus placeholder="e.g. 148230"
              onChange={(e) => setKm(e.target.value.replace(/\D+/g, ''))} />
          </label>
        </>
      ) : (
        <>
          <label>Riding with
            <select value={ridingWith} onChange={(e) => setRidingWith(e.target.value)}>
              <option value="">Not sure yet</option>
              {mates.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <p className="hint" style={{ margin: 0 }}>
            No van and no odometer — the person driving records those. Your hours still count.
          </p>
        </>
      )}
      <div className="drv-row">
        <button type="submit" className="drv-btn go" disabled={busy}>{busy ? 'Starting…' : 'Start'}</button>
        <button type="button" className="drv-btn" onClick={() => setDriving(null)}>Back</button>
      </div>
    </form>
  );
}

function EndForm({ shift, busy, onCancel, onEnd }) {
  const [km, setKm] = useState('');
  // A passenger has nothing to read. Ending the shift is one tap.
  if (shift.driving === false) {
    return (
      <div className="drv-form">
        <p className="hint" style={{ margin: 0 }}>
          You were riding today, so there&apos;s no odometer to put in.
        </p>
        <div className="drv-row">
          <button type="button" className="drv-btn go" disabled={busy} onClick={() => onEnd(null)}>{busy ? 'Ending…' : 'End shift'}</button>
          <button type="button" className="drv-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <form className="drv-form" onSubmit={(e) => { e.preventDefault(); onEnd(km || null); }}>
      <label>Odometer now
        <input inputMode="numeric" value={km} autoFocus placeholder={shift.startKm ? `started at ${shift.startKm}` : 'e.g. 148412'}
          onChange={(e) => setKm(e.target.value.replace(/\D+/g, ''))} />
      </label>
      <p className="hint" style={{ margin: 0 }}>
        {shift.startKm
          ? 'Both readings are what makes the mileage — this one on its own is a number nobody can subtract.'
          : 'No reading this morning, so there is no distance for today. Put it in anyway for tomorrow.'}
      </p>
      <div className="drv-row">
        <button type="submit" className="drv-btn go" disabled={busy}>{busy ? 'Ending…' : 'End shift'}</button>
        <button type="button" className="drv-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function FuelForm({ shift, onCancel, onSave }) {
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  // Shrinking the receipt takes a second or two on a phone. Without this the
  // button stays live through it, and every impatient tap files ANOTHER fill —
  // each one with its own `ref`, so the server's replay check cannot catch it
  // and the day's fuel is $200 x however many times he tapped.
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="drv-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving || !(Number(amount) > 0)) return;
        setSaving(true);
        try { await onSave({ amount, litres, odometer, note, receipt }); }
        finally { setSaving(false); }
      }}
    >
      {/* The driver should know which of the two this is before they type an
          amount — one gets them e-transferred, the other is a mileage record on
          a truck the carrier already bills us for. */}
      {shift?.fuelPaidBy === 'carrier' && (
        <p className="hint" style={{ margin: 0 }}>
          {shift.carrierName || 'The carrier'} pays for fuel on {shift.vehicleName || 'this truck'}. Put it
          in anyway — the litres are how we work out the mileage — but this isn&apos;t money coming back to
          you, and it won&apos;t be counted twice.
        </p>
      )}
      <label>What it cost
        <input inputMode="decimal" value={amount} autoFocus placeholder="82.40"
          onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>Litres
        <input inputMode="decimal" value={litres} placeholder="on the pump display"
          onChange={(e) => setLitres(e.target.value)} />
      </label>
      {shift?.driving !== false && (
        <label>Odometer
          <input inputMode="numeric" value={odometer} placeholder="e.g. 148310"
            onChange={(e) => setOdometer(e.target.value.replace(/\D+/g, ''))} />
        </label>
      )}
      {/* No `capture` — on iOS that makes the input camera-ONLY, so a driver who
          already photographed the receipt can't attach it. See CLAUDE.md. */}
      <label>Receipt
        <input type="file" accept="image/*" onChange={(e) => setReceipt(e.target.files?.[0] || null)} />
      </label>
      <input className="drv-note-input" value={note} placeholder="Note (optional)"
        onChange={(e) => setNote(e.target.value)} />
      <div className="drv-row">
        <button type="submit" className="drv-btn go" disabled={saving || !(Number(amount) > 0)}>
          {saving ? 'Saving…' : 'Save fuel'}
        </button>
        <button type="button" className="drv-btn" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}
