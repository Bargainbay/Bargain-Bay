'use client';
import { useState } from 'react';
import Payroll from './Payroll';

// The top of the Payroll page: for each person, the hours they have clocked, what they have earned, what has been paid
// and what we still owe. Nothing to press: the clock posts to what is owed by itself. Below it sit the payments, the
// people and the hours.
const cad = (v) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v));
const keyOf = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export default function PayrollHub({ initial, today }) {
  const [state, setState] = useState(initial); // { hours, pay }
  const hoursBy = new Map(state.hours.map((h) => [keyOf(h.name), h]));
  const payBy = new Map(state.pay.people.map((p) => [keyOf(p.person), p]));
  const names = [...new Set([...state.hours.map((h) => keyOf(h.name)), ...state.pay.people.map((p) => keyOf(p.person))])];
  const rows = names.map((k) => {
    const h = hoursBy.get(k), p = payBy.get(k);
    return { name: h?.name || p?.person, hours: h?.hours || 0, owed: p?.owed || 0, paid: p?.paid || 0, balance: p?.balance || 0, h };
  }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const total = rows.reduce((t, r) => ({ hours: t.hours + r.hours, owed: t.owed + r.owed, paid: t.paid + r.paid, balance: t.balance + r.balance }), { hours: 0, owed: 0, paid: 0, balance: 0 });

  return (
    <div>
      <div className="panel">
        <h1 style={{ margin: 0, color: 'var(--charcoal)' }}>Payroll</h1>
        <p className="hint" style={{ marginTop: 4 }}>
          Hours are everything clocked since Oct 19, at the rate each shift carried. What is owed follows the clock on its own.
        </p>
        {rows.length === 0 ? <p className="hint" style={{ margin: 0 }}>Nobody has clocked any hours yet.</p> : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Person</th><th style={{ textAlign: 'right' }}>Total hours</th><th style={{ textAlign: 'right' }}>Earned</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>We owe</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td><b>{r.name}</b>
                    {r.h?.open > 0 && <div className="hint" style={{ margin: 0, color: 'var(--danger)', fontSize: 12.5 }}>still clocked in: their latest hours are added once they clock out</div>}
                    {r.h?.tooLong > 0 && <div className="hint" style={{ margin: 0, color: 'var(--danger)', fontSize: 12.5 }}>{r.h.tooLong} shift{r.h.tooLong === 1 ? '' : 's'} too long to count (a forgotten clock-out?): fix below</div>}
                    {r.h?.noRate > 0 && <div className="hint" style={{ margin: 0, color: 'var(--danger)', fontSize: 12.5 }}>{r.h.noRate} shift{r.h.noRate === 1 ? '' : 's'} with no hourly rate</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.hours.toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>{cad(r.owed)}</td>
                  <td style={{ textAlign: 'right' }}>{cad(r.paid)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(r.balance)}</td>
                </tr>))}
              <tr>
                <td><b>Total</b></td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{total.hours.toFixed(2)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(total.owed)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(total.paid)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(total.balance)}</td>
              </tr>
            </tbody></table></div>
        )}
      </div>

      <Payroll d={{ pay: state.pay, date: today, days: 7 }} setD={(j) => setState({ hours: state.hours, pay: j.pay || state.pay })} extra={{ view: 'payroll' }} />
    </div>
  );
}
