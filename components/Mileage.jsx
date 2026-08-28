'use client';
import { useCallback, useEffect, useState } from 'react';

// What the vans are actually doing per kilometre.
//
// Two halves from two places: distance from the shift odometer readings, fuel
// from the gas entries. Neither is guessed. A period missing either half reports
// what it has and NAMES what it's missing, because a litres-per-100km built on
// one of them is a made-up number that looks authoritative — and somebody would
// price a delivery off it.
const money = (n) => '$' + (Number(n) || 0).toFixed(2);

export default function Mileage({ from, to }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/admin/dispatch?view=mileage&from=${from}&to=${to}`).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setErr(''); setData(d);
    } catch { setErr('Could not load the mileage.'); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  if (err) return null;
  if (!data?.vehicles?.length) return null;

  const missingKm = data.vehicles.some((v) => v.shifts > v.shiftsWithKm);
  const missingLitres = data.vehicles.some((v) => v.fillsWithoutLitres > 0);

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Kilometres &amp; fuel</h3>
      <div className="table-wrap"><table className="admin">
        <thead>
          <tr>
            <th>Van</th>
            <th style={{ textAlign: 'right' }}>Km</th>
            <th style={{ textAlign: 'right' }}>Litres</th>
            <th style={{ textAlign: 'right' }}>Fuel spend</th>
            <th style={{ textAlign: 'right' }}>L/100km</th>
            <th style={{ textAlign: 'right' }}>Cost per km</th>
          </tr>
        </thead>
        <tbody>
          {data.vehicles.map((v) => (
            <tr key={v.vehicleId || 'none'}>
              <td style={{ fontWeight: 600 }}>
                {v.name}
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {v.shiftsWithKm} of {v.shifts} shift{v.shifts === 1 ? '' : 's'} with both readings
                  {v.fills > 0 && ` · ${v.fills} fill${v.fills === 1 ? '' : 's'}`}
                </div>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {v.km ? v.km.toLocaleString('en-CA') : '—'}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.litres || '—'}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(v.spend)}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                {v.litresPer100 ?? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>—</span>}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {v.costPerKm != null ? money(v.costPerKm) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="hint">
        Distance comes from the odometer at the start and end of a shift; fuel from the gas entries.
        {missingKm && ' Some shifts have a reading at only one end, so their distance isn’t counted — the drivers are asked for both.'}
        {missingLitres && ' Some fills have no litres on them, so they add to the spend but not to the L/100km.'}
        {!missingKm && !missingLitres && ' Both halves are complete for this period.'}
      </p>
    </div>
  );
}
