'use client';
import { useState } from 'react';

// Closing out a service visit. Time on site, what was done, what parts went in
// or are still needed, and who signed.
//
// The outcome is the important field: it's what moves the TICKET. Fixed closes
// the customer's problem; parts needed parks it; pending leaves it open for
// another trip. That's what makes the open-service-call count mean something.
const OUTCOMES = [
  { key: 'fixed', label: 'Fixed', hint: 'Closes the ticket' },
  { key: 'parts_needed', label: 'Parts needed', hint: 'Ticket waits on parts' },
  { key: 'pending', label: 'Pending — needs another visit', hint: 'Ticket stays open' },
  { key: 'not_fixed', label: 'Not fixed', hint: 'Ticket stays open' },
  { key: 'no_fault', label: 'No fault found', hint: 'Closes the ticket' }
];

const nowHHMM = () => new Date().toTimeString().slice(0, 5);

export default function ServiceVisitForm({ job, busy, canSetPay, onSubmit, onCancel }) {
  const isService = job.type === 'service_call';
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState(nowHHMM());
  const [outcome, setOutcome] = useState('fixed');
  const [partsUsed, setPartsUsed] = useState('');
  const [partsNeeded, setPartsNeeded] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [pay, setPay] = useState(job.payAmount == null ? '' : String(job.payAmount));
  const [payNote, setPayNote] = useState('');

  const needsParts = outcome === 'parts_needed';

  // The clocks are times of day; pin them to the job's date on the way out.
  const stamp = (hhmm) => {
    if (!hhmm) return null;
    const day = job.jobDate || new Date().toLocaleDateString('en-CA');
    return new Date(`${day}T${hhmm}:00`).toISOString();
  };

  function submit(e) {
    e.preventDefault();
    if (isService && needsParts && !partsNeeded.trim()) {
      setErr('List the parts needed — that’s what the ticket waits on.');
      return;
    }
    setErr('');
    onSubmit({
      timeIn: stamp(timeIn), timeOut: stamp(timeOut),
      outcome: isService ? outcome : null,
      partsUsed, partsNeeded, signedBy, note,
      pay: canSetPay && pay !== '' ? Number(pay) : undefined,
      payNote: canSetPay ? payNote : undefined
    });
  }

  return (
    <form onSubmit={submit} className="svc-form">
      <h4 style={{ margin: '0 0 2px' }}>Close out {job.jobNumber}</h4>
      <p className="hint" style={{ marginTop: 0 }}>
        {isService
          ? `${job.appliance || 'Service call'}${job.ticketNumber ? ` · ticket ${job.ticketNumber}` : ''}`
          : `${job.customerName || 'Delivery'}${job.address ? ` · ${job.address}` : ''}`}
      </p>
      {err && <div className="error-box">{err}</div>}

      <div className="svc-row">
        <label>Time in
          <input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} />
        </label>
        <label>Time out
          <input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} />
        </label>
      </div>

      {isService && <>
      <label className="svc-block">Outcome
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <span className="hint">{OUTCOMES.find((o) => o.key === outcome)?.hint}</span>
      </label>

      <label className="svc-block">Parts used
        <input value={partsUsed} onChange={(e) => setPartsUsed(e.target.value)}
          placeholder="Door gasket, thermostat — separate with commas" />
      </label>

      <label className="svc-block">
        Parts needed{needsParts ? ' *' : ''}
        <input value={partsNeeded} onChange={(e) => setPartsNeeded(e.target.value)}
          placeholder="Compressor relay W10613606" />
      </label>

      </>}

      <label className="svc-block">Signed by
        <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)}
          placeholder="Name of whoever signed" />
        <span className="hint">On-screen signature capture comes with the driver app.</span>
      </label>

      <label className="svc-block">Notes
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done" />
      </label>

      {canSetPay && (
        <div className="svc-row" style={{ alignItems: 'flex-end' }}>
          <label style={{ marginBottom: 0 }}>What this pays
            <input type="number" min="0" step="0.01" inputMode="decimal" value={pay}
              onChange={(e) => setPay(e.target.value)} placeholder="0.00" />
          </label>
          <label style={{ flex: 1, marginBottom: 0 }}>Pay note
            <input style={{ width: '100%' }} value={payNote} onChange={(e) => setPayNote(e.target.value)}
              placeholder="Long job, two flights of stairs" />
          </label>
        </div>
      )}
      {canSetPay && (
        <p className="hint" style={{ marginTop: 4 }}>
          What the person who did this job is owed. It rolls up per person on the Pay tab.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn accent" disabled={busy}>{busy ? 'Saving…' : 'Close out visit'}</button>
      </div>
    </form>
  );
}
