// The order scorecard: plain numbers against the published standards. Null means "nothing to measure
// yet", and it is shown as such — never as 0% or 100%.
const show = (v, suffix = '%') => (v == null ? '—' : `${v}${suffix}`);

function Tile({ value, label, note, tone }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value" style={tone === 'bad' ? { color: 'var(--danger)' } : undefined}>{value}</div>
      <div style={{ fontSize: 13 }}>{label}</div>
      {note ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{note}</div> : null}
    </div>
  );
}

export default function VendorScorecard({ card, acceptHours = 24, readyHours = 72 }) {
  const low = (v) => (v != null && v < 90 ? 'bad' : undefined);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <Tile value={show(card.acceptedOnTimePct)} tone={low(card.acceptedOnTimePct)} label={`Accepted within ${acceptHours} h`}
          note={card.acceptDecided ? `${card.acceptDecided} order(s) judged` : 'no orders judged yet'} />
        <Tile value={show(card.readyOnTimePct)} tone={low(card.readyOnTimePct)} label={`Ready within ${readyHours} h`}
          note={card.readyDecided ? `${card.readyDecided} order(s) judged` : 'no orders judged yet'} />
        <Tile value={show(card.cancelRatePct)} tone={card.cancelRatePct > 0 ? 'bad' : undefined} label="Cancelled or lapsed"
          note={`${card.vendorCancelled} cancelled by you, ${card.lapsed} not accepted in time`} />
        <Tile value={card.notAsDescribed} tone={card.notAsDescribed ? 'bad' : undefined} label="Not as described" note="reported by our crew" />
        <Tile value={show(card.avgAcceptHours, ' h')} label="Average time to accept" />
        <Tile value={show(card.avgReadyHours, ' h')} label="Average time to ready" note="from payment confirmation" />
        <Tile value={card.delivered} label="Delivered" note={`of ${card.orders} order(s)`} />
        <Tile value={show(card.claimsRespondedOnTimePct)} tone={low(card.claimsRespondedOnTimePct)} label="Warranty claims answered on time"
          note={`${card.claims} claim(s)`} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>Last {card.days} days, counted from when payment was confirmed. A dash means there is nothing to measure yet.</p>
    </div>
  );
}
