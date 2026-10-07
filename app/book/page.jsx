import BookingForm from '../../components/BookingForm';

export const metadata = {
  title: { absolute: 'Book a service call or moving quote — RS Solutions' },
  description: 'Request an appliance service call or a moving quote from RS Solutions in Pickering and the GTA.'
};

// Self-branded RS Solutions page: SiteChrome renders no storefront header or
// footer for /book, because on the RS host that chrome is the other company.
export default function BookPage() {
  return (
    <div className="narrow" style={{ maxWidth: 620, margin: '0 auto' }}>
      <h1 style={{ color: 'var(--charcoal)', marginBottom: 4 }}>RS Solutions</h1>
      <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>Appliance service calls and moving — Pickering, Durham Region and the GTA.</p>
      <BookingForm />
    </div>
  );
}
