'use client';
import { useEffect, useState } from 'react';
import { queueAction, newRef } from '../lib/driver-outbox';

// Clocking on and off, and the fill-up in between.
//
// Both go through the SAME offline queue as everything else on this screen. A
// driver picks the van up in an underground loading bay and fills up at a
// station with one bar of signal; neither moment is one to be told "try again".
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
const asDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

export default function DriverShift({ onChanged }) {
  const [shift, setShift] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(null);      // 'start' | 'end' | 'fuel'
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [, tick] = useState(0);

  async function load() {
    try {
      const d = await fetch('/api/driver/shift', { cache: 'no-store' }).then((r) => r.json());
      if (!d.error) { setShift(d.shift || null); setVehicles(d.vehicles || []); }
    } catch { /* offline: whatever is on screen stays */ }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); }, []);
  // The running clock only moves in minutes.
  useEffect(() => {
    if (!shift) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [shift]);

  const running = shift?.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(shift.startedAt)) / 60000)) : 0;

  async function begin(vehicleId, startKm) {
    setErr(''); setOk('');
    await queueAction({
      kind: 'patch', url: '/api/driver/shift', ref: newRef(),
      body: { action: 'start', vehicleId, startKm, at: Date.now() }
    });
    // Optimistic: the day has started as far as the driver is concerned.
    setShift({
      startedAt: new Date().toISOString(), startKm: startKm || null,
      vehicleId: vehicleId || null,
      vehicleName: vehicles.find((v) => String(v.id) === String(vehicleId))?.name || null
    });
    setForm(null);
    setOk('Shift started.');
    onChanged?.();
    setTimeout(load, 2500);
  }

  async function finish(endKm) {
    setErr(''); setOk('');
    // Checked here as well as on the server so the driver is told at the pump,
    // not tomorrow by the office.
    if (endKm && shift?.startKm && Number(endKm) < Number(shift.startKm)) {
      setErr(`That reads lower than this morning's ${shift.startKm} km — is it the trip meter?`);
      return;
    }
    await queueAction({
      kind: 'patch', url: '/api/driver/shift', ref: newRef(),
      body: { action: 'end', endKm, at: Date.now() }
    });
    setShift(null);
    setForm(null);
    setOk('Shift ended. Have a good night.');
    onChanged?.();
    setTimeout(load, 2500);
  }

  async function fuel({ amount, litres, odometer, note, receipt }) {
    setErr(''); setOk('');
    await queueAction({
      kind: 'photos', url: '/api/driver/fuel', ref: newRef(),
      fields: {
        amount, litres, odometer, note,
        vehicleId: shift?.vehicleId || '',
        date: new Date().toLocaleDateString('en-CA')
      },
      // The receipt rides the same blob slot the delivery photos use, so it
      // survives the same lost signal they do.
      photos: receipt ? [receipt] : []
    });
    setForm(null);
    setOk(`Fuel $${Number(amount).toFixed(2)} saved${receipt ? ' with the receipt' : ''}.`);
    onChanged?.();
  }

  if (!loaded) return null;

  return (
    <div className="drv-shift">
      {err && <div className="error-box">{err}</div>}
      {ok && <div className="drv-sending">{ok}</div>}

      {!shift ? (
        form === 'start'
          ? <StartForm vehicles={vehicles} onCancel={() => setForm(null)} onStart={begin} />
          : (
            <button type="button" className="drv-btn go drv-shift-btn" onClick={() => setForm('start')}>
              ▶ Start shift
            </button>
          )
      ) : (
        <>
          <div className="drv-shift-on">
            <span>
              <b>On shift {asDuration(running)}</b>
              <span className="drv-shift-sub">
                since {hhmm(shift.startedAt)}
                {shift.vehicleName ? ` · ${shift.vehicleName}` : ''}
                {shift.startKm ? ` · ${shift.startKm} km` : ''}
              </span>
            </span>
          </div>
          <div className="drv-row">
            <button type="button" className="drv-btn" onClick={() => setForm(form === 'fuel' ? null : 'fuel')}>
              ⛽ Add fuel
            </button>
            <button type="button" className="drv-btn bad" onClick={() => setForm(form === 'end' ? null : 'end')}>
              ■ End shift
            </button>
          </div>
          {form === 'fuel' && <FuelForm onCancel={() => setForm(null)} onSave={fuel} />}
          {form === 'end' && <EndForm shift={shift} onCancel={() => setForm(null)} onEnd={finish} />}
        </>
      )}
    </div>
  );
}

function StartForm({ vehicles, onCancel, onStart }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ? String(vehicles[0].id) : '');
  const [km, setKm] = useState('');
  return (
    <form className="drv-form" onSubmit={(e) => { e.preventDefault(); onStart(vehicleId || null, km || null); }}>
      <label>Which van
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Not recorded</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label>Odometer now
        <input inputMode="numeric" value={km} placeholder="e.g. 148230"
          onChange={(e) => setKm(e.target.value.replace(/\D+/g, ''))} />
      </label>
      <div className="drv-row">
        <button type="submit" className="drv-btn go">Start</button>
        <button type="button" className="drv-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function EndForm({ shift, onCancel, onEnd }) {
  const [km, setKm] = useState('');
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
        <button type="submit" className="drv-btn go">End shift</button>
        <button type="button" className="drv-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function FuelForm({ onCancel, onSave }) {
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  return (
    <form
      className="drv-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!(Number(amount) > 0)) return;
        onSave({ amount, litres, odometer, note, receipt });
      }}
    >
      <label>What it cost
        <input inputMode="decimal" value={amount} autoFocus placeholder="82.40"
          onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>Litres
        <input inputMode="decimal" value={litres} placeholder="on the pump display"
          onChange={(e) => setLitres(e.target.value)} />
      </label>
      <label>Odometer
        <input inputMode="numeric" value={odometer} placeholder="e.g. 148310"
          onChange={(e) => setOdometer(e.target.value.replace(/\D+/g, ''))} />
      </label>
      {/* No `capture` — on iOS that makes the input camera-ONLY, so a driver who
          already photographed the receipt can't attach it. See CLAUDE.md. */}
      <label>Receipt
        <input type="file" accept="image/*" onChange={(e) => setReceipt(e.target.files?.[0] || null)} />
      </label>
      <input className="drv-note-input" value={note} placeholder="Note (optional)"
        onChange={(e) => setNote(e.target.value)} />
      <div className="drv-row">
        <button type="submit" className="drv-btn go" disabled={!(Number(amount) > 0)}>Save fuel</button>
        <button type="button" className="drv-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
