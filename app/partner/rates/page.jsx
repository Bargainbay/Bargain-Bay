import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getPartnerSeat } from '../../../lib/referral-partners';
import PrintButton from '../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Delivery and installation rates — Bargain Bay', robots: { index: false } };

// Reference for partners and lead generators: what delivery, haul-away and installation cost, and what each service does and does
// not include. Pricing and scope only: the client terms, scheduling and completion rules from the full rate sheet are left out.
const Table = ({ head, rows }) => (
  <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
    <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j === 0 ? { fontWeight: 600 } : undefined}>{c}</td>)}</tr>)}</tbody>
  </table></div>
);
const Sec = ({ id, title, children }) => (
  <section id={id} className="panel" style={{ marginBottom: 14, scrollMarginTop: 70 }}>
    <h2 style={{ fontSize: 19, margin: '0 0 8px', color: 'var(--charcoal)' }}>{title}</h2>
    <div style={{ fontSize: 15, lineHeight: 1.55 }}>{children}</div>
  </section>
);
const Note = ({ children }) => <p className="hint" style={{ margin: '8px 0 0', fontSize: 13.5 }}>{children}</p>;
const List = ({ items }) => <ul style={{ paddingLeft: 20, margin: '6px 0' }}>{items.map((t, i) => <li key={i} style={{ margin: '3px 0' }}>{t}</li>)}</ul>;

const DELIVERY = [
  ['Refrigerators', 'To the room it will live in, including stairs. Unboxed and placed, handles installed, debris removed, unit levelled.', 'To the first dry area. Not unboxed. No movement beyond the threshold.'],
  ['Washers', 'To the laundry room. Unboxed and placed, debris removed, unit levelled.', 'To the first dry area. Not unboxed. No movement beyond the threshold.'],
  ['Dryers (electric and gas)', 'To the laundry room. Unboxed and placed, debris removed, unit levelled.', 'To the first dry area. Not unboxed. No connections.'],
  ['Dishwashers', 'To the kitchen. Unboxed and placed near the install location, debris removed. Placement only, no install. Not included: plumbing, electrical, removal of the old unit.', 'To the first dry area. Not unboxed. No connections.'],
  ['Ranges (electric and gas)', 'To the kitchen. Unboxed and placed, debris removed, unit levelled. Not included: gas leak repair, hardwiring.', 'To the first dry area. Not unboxed. No installation.'],
  ['Over-the-range microwaves and range hoods', 'To the kitchen. Unboxed and placed near the install location, debris removed. Placement only, no mounting. Not included: venting, brackets, cabinet changes.', 'To the first dry area. Not unboxed.'],
  ['Freezers (chest and upright)', 'To the room it will live in (garage, basement, utility). Unboxed and placed, debris removed. Not included: door reversal, levelling on uneven floors.', 'To the first dry area. Not unboxed.'],
  ['Wine coolers and beverage centres', 'To the room it will live in. Unboxed and placed, debris removed. Not included: built-in installation, cabinet changes.', 'To the first dry area. Not unboxed.']
];

const INSTALL = [
  ['Dishwasher: basic install', 'Disconnect the old dishwasher. Install the replacement in the same place. Connect the existing water, drain and power. Level, secure and test.', 'New electrical or plumbing lines. Electrical changes. Cabinet or countertop changes. Waterline replacement.'],
  ['Dishwasher: new build install', 'Install into a prepared cabinet space. Connect to existing plumbing and electrical stub-outs. Drill the cabinet for the lines. Mount, level and test.', 'New plumbing or electrical connections. Electrical changes.'],
  ['Gas range: basic install', 'Disconnect the old range. Install the replacement. Connect to the existing gas line. Level and test the burners.', 'A new gas line. Propane conversion.'],
  ['Gas dryer install', 'Disconnect the old dryer. Install the replacement. Connect to the existing gas supply and vent. Test.', 'A new gas line. A new or changed vent.'],
  ['Laundry: side-by-side', 'Place and level the washer and dryer. Connect the existing water and drain. Connect the dryer vent and power. Test.', 'A new vent. New plumbing lines.'],
  ['Laundry: pedestals', 'Install the pedestals. Mount the washer and dryer on them. Reconnect the water lines and vent.', ''],
  ['Laundry: stacked washer and dryer', 'Install the stacked unit. Connect the water, drain, vent and power. Level and test.', ''],
  ['Refrigerator: connect an existing waterline', 'Connect the fridge to the existing waterline. Check for leaks. Test the water dispenser.', ''],
  ['Refrigerator: waterline with adapter', 'Connect the fridge using a new adapter. Leak test and function test.', ''],
  ['Refrigerator: new waterline (up to 20 ft)', 'Install a new waterline in an open area, up to 20 ft. Connect it to the fridge. Leak and function test.', 'Running a line through closed walls or floors. Cabinet changes.'],
  ['Over-the-range microwave: basic install', 'Remove the old microwave if there is one. Install the new one. Secure the mounting bracket. Connect power and ventilation.', 'Cabinet changes. Moving the electrical.']
];

export default async function RatesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/partner/rates');
  const seat = hasDb() ? await getPartnerSeat(session.email) : null;
  if (!seat && !isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><p>This page is for Bargain Bay partners and their lead generators.</p></div></div>);
  }
  return (
    <div className="narrow">
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, flex: 1, color: 'var(--charcoal)' }}>Delivery and installation rates</h1>
          <a className="btn" href="/partner">← Back to my portal</a>
          <PrintButton />
        </div>
        <p className="hint" style={{ margin: '8px 0 0' }}>RS Solutions rates for delivery, haul-away and installation, and exactly what each service includes. Final prices for a customer are confirmed by our team.</p>
      </div>

      <Sec id="zones" title="Delivery rates">
        <p>Distance is measured from the pick up location.</p>
        <Table head={['Zone', 'Distance', 'Base rate']} rows={[['Zone A', '0 to 50 km', '$95'], ['Zone B', '51 to 100 km', '$140'], ['Zone C', '101 to 150 km', '$225']]} />
        <Note>Threshold delivery (to the front door or first dry area) is priced at 80% of the order pricing.</Note>
      </Sec>

      <Sec id="extras" title="Extra charges">
        <Table head={['Service', 'Charge']} rows={[
          ['Additional pieces (after 2)', '$15 per item'],
          ['Overweight products (over 350 lbs)', '$75'],
          ['Distance beyond Zone C', '$2 per km, one way, on top of the Zone C rate'],
          ['Haul away an old appliance', '$20 per item'],
          ['Internal move (same floor)', '$20 per item'],
          ['Fridge door removal', '$20 per item'],
          ['Home door removal', '$20 per item']
        ]} />
      </Sec>

      <Sec id="install" title="Installation rates">
        <Table head={['Installation', 'Price']} rows={[
          ['Laundry install (gas customers must provide hoses)', '$40'],
          ['Stacking or pedestal laundry install', '$75'],
          ['Dishwasher basic install (remove old and install new)', '$120'],
          ['Electric wall oven (remove old and install new)', '$175'],
          ['Fridge waterline, existing', '$25'],
          ['Fridge waterline, new (up to 20 ft)', '$150'],
          ['Gas dryer or range, existing connection', '$250'],
          ['Over-the-range microwave or vented range hood (remove old and install new)', '$125']
        ]} />
      </Sec>

      <Sec id="delivered" title="What a delivery includes">
        <p>There are two levels. <b>Threshold</b> delivery is to the first dry area. <b>White glove</b> delivery goes to the room it will be used in.</p>
        <Table head={['Appliance', 'White glove', 'Threshold']} rows={DELIVERY} />
      </Sec>

      <Sec id="installed" title="What each installation includes">
        <Table head={['Installation', 'Included', 'Not included']} rows={INSTALL.map((r) => [r[0], r[1], r[2] || 'Nothing extra listed.'])} />
      </Sec>

      <Sec id="limits" title="Good to know">
        <List items={[
          'Appliances are moved to the same floor as the delivery only, and only if they fit through every doorway and hallway without removing doors, railings or trim. This must be paid for in advance.',
          'Only appliances of the same type as the one being delivered are moved or hauled away (a fridge for a fridge, a washer for a washer).',
          'Haul-away is only done when it has been paid for in advance. The old appliance must be disconnected, emptied and free of water or ice.',
          'The team does not remove doors, handrails, trim or cabinets, and does not install anything that needs a new electrical, plumbing or gas connection. Those upgrades must be done before delivery.',
          'An adult (18 or over) must be at home to sign for the delivery and approve where it is placed.',
          'The customer needs a clear path to where the appliance will go, and any existing appliance being removed must be ready to move. Tell us about narrow stairs, tight turns, elevators, buzzer codes or gated entries when booking.',
          'Deliveries may be moved because of severe weather or unsafe access. The team can decline a job that is unsafe.'
        ]} />
      </Sec>
    </div>
  );
}
