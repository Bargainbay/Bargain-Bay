import SmsSubscribe from '../../components/SmsSubscribe';

export const metadata = { title: 'Deals by text — Bargain Bay', description: 'Subscribe to Bargain Bay appliance deals by text message.' };

export default function TextsPage() {
  return (
    <div className="narrow">
      <h1 style={{ color: 'var(--charcoal)' }}>Deals by text</h1>
      <SmsSubscribe where="texts page" />
    </div>
  );
}
