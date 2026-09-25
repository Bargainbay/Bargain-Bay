import { redirect } from 'next/navigation';
import qrcode from 'qrcode-generator';
import { getSession, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { SITE_URL } from '../../../../lib/site';
import { canonicalSkus, describeUnits, listAreas, listLocations } from '../../../../lib/locations';
import { describeParts } from '../../../../lib/parts';
import { normCode, partScanUrl, spotScanUrl, unitScanUrl } from '../../../../lib/location-codes';
import PrintButton from '../../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Labels — Warehouse', robots: { index: false } };

// Printable labels: SKU stickers for units, bin labels for parts, and signs for
// spots.
//
// Built as ordinary pages that print, so ANY printer works — a thermal label
// printer on a roll, or an office printer on a sheet of address labels. Each
// format sets its own @page size; the printer dialog still has to be set to the
// same paper at 100% scale, and the toolbar says so.
//
// The QR is drawn here, as SVG, with the same encoder the driver app uses. It
// carries a URL (see lib/location-codes.js), and the text beside it is what a
// person reads when the scanner is in the other van.
//
// Printing hides everything that isn't the sheet or one of its ancestors, rather
// than depending on how the site's header and footer behave — a label roll with a
// site header on it is six blank stickers.

const qrSvg = (text) => {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
};
const list = (v) => String(v || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

// Roll sizes a shop actually stocks, biggest first. The small ones exist because
// a control board or a valve is not a fridge: a 2.25in sticker wraps round a part
// and covers the very number somebody needs to read.
//
// **The QR is ~33 modules across** (see lib/location-codes.js — the payload is a
// URL). At 300 dpi a 0.6in code gives it about 5 printer dots per module, which
// scans; at 203 dpi the same code is under 4 and starts failing at an angle. So
// the two smallest sizes want a 300 dpi printer, and the picker says so.
const UNIT_FORMATS = {
  roll: { label: 'Roll — 2.25 × 1.25 in', page: '2.25in 1.25in', margin: '0' },
  '2x1': { label: 'Roll — 2 × 1 in', page: '2in 1in', margin: '0' },
  small: { label: 'Small parts — 1.5 × 1 in (300 dpi)', page: '1.5in 1in', margin: '0' },
  tiny: { label: 'Smallest — 1 × 1 in (300 dpi)', page: '1in 1in', margin: '0' },
  sheet: { label: 'Letter sheet — 30 per page (Avery 5160)', page: 'letter', margin: '0.5in 0.19in' }
};
// A part's label is the SAME stock as a unit sticker — the shapes above — but it
// defaults to the small end, because the thing it is going on is a bin of
// igniters or the igniter itself. A part URL is also much shorter than a SKU
// one, so its QR has fewer modules and 1 x 1 in is genuinely readable here where
// it is marginal for a unit.
const PART_FORMATS = UNIT_FORMATS;

// How much room the headline actually has beside (or under) the QR, per format,
// and the biggest type that has ever looked right there.
//
// **A part number is sized to FIT on one line, not dropped through the three
// fixed steps a SKU uses.** Those steps were tuned on SKUs — SS-117082 is nine
// characters — and a part number is routinely longer: Whirlpool's W10295370A is
// ten, and Samsung ships DC97-16782A-REV3. At 11.5pt the first one wrapped to
// `W10295370` / `A`, which is read out over the phone and typed into a supplier's
// site as two part numbers. Same failure the SKU comment below warns about, and
// worse here, because a part number is the thing somebody orders a replacement
// with.
const PART_TEXT = {
  roll: { in: 0.96, max: 11.5 },
  '2x1': { in: 0.96, max: 11.5 },
  sheet: { in: 1.48, max: 11.5 },
  small: { in: 1.4, max: 7.5 },
  tiny: { in: 0.92, max: 6.5 }
};
// 0.62em per character is the widest the monospace stack above runs. The floor
// is the point below which a printer stops resolving it anyway — a part number
// nobody can read is no better than a blank label, and the QR still scans.
const partNumSize = (text, format) => {
  const t = PART_TEXT[format] || PART_TEXT.roll;
  const len = Math.max(1, String(text).length);
  return `${Math.max(4.5, Math.min(t.max, (t.in / len / 0.62) * 72)).toFixed(1)}pt`;
};

const SPOT_FORMATS = {
  '4x6': { label: '4 × 6 in label', page: '4in 6in', margin: '0' },
  letter: { label: 'Letter paper — one per page', page: 'letter', margin: '0.5in' }
};

const CSS = `
  .lbl-toolbar { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 12px 0; }
  .lbl-toolbar a.is-on { font-weight: 700; text-decoration: none; color: var(--charcoal); }
  .lbl-sheet { display: flex; flex-wrap: wrap; gap: 12px; color: #000; }
  .lbl-sheet svg { display: block; width: 100%; height: 100%; }
  .lbl-sticker { background: #fff; outline: 1px dashed #bbb; box-sizing: border-box; display: flex; align-items: center; overflow: hidden; }
  .lbl-sticker .q { flex: none; }
  .lbl-sticker .t { min-width: 0; font-family: Arial, Helvetica, sans-serif; }
  .lbl-sticker .sku { font: 800 11.5pt/1.05 ui-monospace, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .lbl-sticker .sku.is-long { font-size: 9.5pt; }
  .lbl-sticker .sku.is-longer { font-size: 8pt; }
  .lbl-sticker .what { font-size: 7pt; line-height: 1.2; max-height: 3.6em; overflow: hidden; margin-top: 2pt; }
  .lbl-sticker .cond { font-size: 6.5pt; margin-top: 1pt; text-transform: uppercase; letter-spacing: .03em; }
  .f-roll .lbl-sticker { width: 2.25in; height: 1.25in; padding: .08in; gap: .08in; }
  .f-roll .lbl-sticker .q { width: 1.05in; height: 1.05in; }
  .f-2x1 .lbl-sticker { width: 2in; height: 1in; padding: .06in; gap: .06in; }
  .f-2x1 .lbl-sticker .q { width: .86in; height: .86in; }
  /* Stacked: on a label this narrow, a QR beside the text leaves the text a
     column too thin to read a SKU out of. */
  .f-small .lbl-sticker, .f-tiny .lbl-sticker { flex-direction: column; justify-content: center; text-align: center; }
  .f-small .lbl-sticker .t, .f-tiny .lbl-sticker .t { width: 100%; }
  .f-small .lbl-sticker { width: 1.5in; height: 1in; padding: .05in; gap: .02in; }
  .f-small .lbl-sticker .q { width: .62in; height: .62in; }
  .f-small .lbl-sticker .sku { font-size: 7.5pt; }
  .f-small .lbl-sticker .sku.is-long { font-size: 6.5pt; }
  .f-small .lbl-sticker .sku.is-longer { font-size: 5.5pt; }
  .f-tiny .lbl-sticker { width: 1in; height: 1in; padding: .04in; gap: .02in; }
  .f-tiny .lbl-sticker .q { width: .62in; height: .62in; }
  .f-tiny .lbl-sticker .sku { font-size: 6.5pt; }
  .f-tiny .lbl-sticker .sku.is-long { font-size: 5.5pt; }
  .f-tiny .lbl-sticker .sku.is-longer { font-size: 4.5pt; }
  .f-sheet { display: grid; grid-template-columns: repeat(3, 2.625in); grid-auto-rows: 1in; column-gap: .125in; row-gap: 0; }
  .f-sheet .lbl-sticker { width: 2.625in; height: 1in; padding: .06in .1in; gap: .08in; }
  .f-sheet .lbl-sticker .q { width: .86in; height: .86in; }
  .lbl-spot { background: #fff; outline: 1px dashed #bbb; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: space-between; text-align: center; font-family: Arial, Helvetica, sans-serif; overflow: hidden; }
  .lbl-spot .code { font-weight: 800; line-height: 1; letter-spacing: .02em; }
  .lbl-spot .sub { font-size: 12pt; }
  .s4x6 .lbl-spot { width: 4in; height: 6in; padding: .3in; }
  .s4x6 .lbl-spot .q { width: 2.7in; height: 2.7in; }
  .sletter .lbl-spot { width: 7.5in; height: 9.9in; padding: .4in; }
  .sletter .lbl-spot .q { width: 5in; height: 5in; }
  .sletter .lbl-spot .sub { font-size: 20pt; }
  @media print {
    body *:not(:has(.lbl-sheet)):not(.lbl-sheet):not(.lbl-sheet *) { display: none !important; }
    body, body *:has(.lbl-sheet) { margin: 0 !important; padding: 0 !important; border: 0 !important; max-width: none !important; background: #fff !important; box-shadow: none !important; }
    .lbl-sheet { gap: 0 !important; }
    .lbl-sticker, .lbl-spot { outline: none !important; }
    .lbl-sheet:not(.f-sheet) .lbl-sticker, .lbl-spot { break-after: page; page-break-after: always; }
    .lbl-sheet:not(.f-sheet) .lbl-sticker:last-child, .lbl-spot:last-child { break-after: auto; page-break-after: auto; }
  }
`;

// Big enough to read across a lane, small enough that DELIVERY-STAGING still fits.
const spotSize = (code, letter) => {
  const n = code.length;
  const pt = n <= 3 ? 150 : n <= 5 ? 110 : n <= 8 ? 70 : n <= 12 ? 46 : 34;
  return `${letter ? Math.round(pt * 1.8) : pt}pt`;
};

export default async function LabelsPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/warehouse');
  if (!isStaff(session)) return <div className="narrow"><div className="panel">Not authorized.</div></div>;
  if (!hasDb()) return <div className="narrow"><div className="panel">Database not configured.</div></div>;

  const type = ['spots', 'parts'].includes(sp?.type) ? sp.type : 'units';
  const href = (patch) => `/admin/warehouse/labels?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp || {}).map(([k, v]) => [k, String(v)])), ...patch })}`;

  if (type === 'units') {
    const format = UNIT_FORMATS[sp?.format] ? sp.format : 'roll';
    const small = format === 'small' || format === 'tiny';
    const skus = list(sp?.skus).slice(0, 300);
    let units = [];
    let err = '';
    try {
      const canon = await canonicalSkus(skus);
      const known = new Map((await describeUnits(canon)).map((u) => [u.sku, u]));
      units = [...new Set(canon)].map((sku) => known.get(sku) || { sku });
    } catch (e) {
      console.error('label lookup failed', e);
      err = 'Could not look those units up — printing the SKUs on their own.';
      units = [...new Set(skus)].map((sku) => ({ sku }));
    }
    return (
      <div style={{ padding: 16 }}>
        <style>{`${CSS} @page { size: ${UNIT_FORMATS[format].page}; margin: ${UNIT_FORMATS[format].margin}; }`}</style>
        <div className="lbl-toolbar">
          <a href="/admin/warehouse" className="btn">← Warehouse</a>
          <PrintButton label={`Print ${units.length} sticker${units.length === 1 ? '' : 's'}`} />
          {Object.entries(UNIT_FORMATS).map(([k, f]) => (
            <a key={k} href={href({ format: k })} className={k === format ? 'is-on' : ''}>{f.label}</a>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          In the print dialog, pick the same paper size and set scale to 100% (no &quot;fit to page&quot;).
        </p>
        {err && <div className="error-box">{err}</div>}
        {!units.length && <div className="panel">No SKUs given. Pick units on the Warehouse page and print from there.</div>}
        <div className={`lbl-sheet f-${format}`}>
          {units.map((u) => (
            <div key={u.sku} className="lbl-sticker">
              {/* The smallest two sizes carry the code and the SKU and nothing
                  else — there is no room for a description, and the QR is what
                  gets scanned anyway. */}
              {/* eslint-disable-next-line react/no-danger */}
              <div className="q" dangerouslySetInnerHTML={{ __html: qrSvg(unitScanUrl(SITE_URL, u.sku)) }} />
              <div className="t">
                {/* Breaks at the dashes before it breaks inside a number: someone
                    reads this aloud over the phone, and "IN-TEST-0 / 01" is two SKUs. */}
                <div className={'sku' + (u.sku.length > 22 ? ' is-longer' : u.sku.length > 13 ? ' is-long' : '')}>{u.sku}</div>
                {u.title && !small && <div className="what">{u.title}</div>}
                {u.condition && !small && <div className="cond">{u.condition}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'parts') {
    const format = PART_FORMATS[sp?.format] ? sp.format : 'small';
    const small = format === 'small' || format === 'tiny';
    const ids = list(sp?.ids).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 300);
    let parts = [];
    let err = '';
    try {
      parts = await describeParts(ids);
    } catch (e) {
      console.error('part label lookup failed', e);
      err = 'Could not look those parts up.';
    }
    return (
      <div style={{ padding: 16 }}>
        <style>{`${CSS} @page { size: ${PART_FORMATS[format].page}; margin: ${PART_FORMATS[format].margin}; }`}</style>
        <div className="lbl-toolbar">
          <a href="/admin/parts" className="btn">← Parts</a>
          <PrintButton label={`Print ${parts.length} label${parts.length === 1 ? '' : 's'}`} />
          {Object.entries(PART_FORMATS).map(([k, f]) => (
            <a key={k} href={href({ format: k })} className={k === format ? 'is-on' : ''}>{f.label}</a>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          In the print dialog, pick the same paper size and set scale to 100% (no &quot;fit to page&quot;).
          One label per KIND of part — stick it on the bin, not on every piece.
        </p>
        {err && <div className="error-box">{err}</div>}
        {!err && !parts.length && <div className="panel">No parts given. Open a part on the Parts page and print from there.</div>}
        <div className={`lbl-sheet f-${format}`}>
          {parts.map((pt) => {
            // A part number is the identity when there is one — it is what
            // somebody reads off the old part standing at the machine. A part
            // booked in without one is only ever its name, so the name takes the
            // big line rather than leaving the label headed by a dash.
            const headline = pt.partNumber || pt.name;
            const under = pt.partNumber ? pt.name : '';
            return (
              <div key={pt.id} className="lbl-sticker">
                {/* eslint-disable-next-line react/no-danger */}
                <div className="q" dangerouslySetInnerHTML={{ __html: qrSvg(partScanUrl(SITE_URL, pt.id)) }} />
                <div className="t">
                  <div className="sku" style={{ fontSize: partNumSize(headline, format) }}>{headline}</div>
                  {/* NOT on here, on purpose: how many are on the shelf, and
                      which spot they are in. Both change the moment somebody
                      takes one, and a printed count is a wrong count by the
                      afternoon — the part's own card answers both, live. Cost
                      never goes on a label at all. */}
                  {under && !small && <div className="what">{under}</div>}
                  {pt.brand && !small && <div className="cond">{pt.brand}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const format = SPOT_FORMATS[sp?.format] ? sp.format : '4x6';
  const areas = list(sp?.area);
  const codes = list(sp?.codes).map(normCode);
  const spots = (await listLocations()).filter((s) => s.active
    && (codes.length ? codes.includes(s.code) : (!areas.length || areas.includes(s.area))));
  const allAreas = await listAreas();
  const areaLabel = (k) => allAreas.find((a) => a.key === k)?.label || '';
  return (
    <div style={{ padding: 16 }}>
      <style>{`${CSS} @page { size: ${SPOT_FORMATS[format].page}; margin: ${SPOT_FORMATS[format].margin}; }`}</style>
      <div className="lbl-toolbar">
        <a href="/admin/warehouse" className="btn">← Warehouse</a>
        <PrintButton label={`Print ${spots.length} sign${spots.length === 1 ? '' : 's'}`} />
        {Object.entries(SPOT_FORMATS).map(([k, f]) => (
          <a key={k} href={href({ format: k })} className={k === format ? 'is-on' : ''}>{f.label}</a>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        In the print dialog, pick the same paper size and set scale to 100%.
      </p>
      {!spots.length && <div className="panel">No spots match.</div>}
      <div className={`lbl-sheet s${format}`}>
        {spots.map((s) => (
          <div key={s.code} className="lbl-spot">
            <div className="code" style={{ fontSize: spotSize(s.code, format === 'letter') }}>{s.code}</div>
            {/* eslint-disable-next-line react/no-danger */}
            <div className="q" dangerouslySetInnerHTML={{ __html: qrSvg(spotScanUrl(SITE_URL, s.code)) }} />
            <div className="sub">
              {areaLabel(s.area)}
              {s.kind === 'rack' && s.level ? ` · shelf ${s.level}` : ''}
              {s.purpose ? <><br /><b>{s.purpose}</b></> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
