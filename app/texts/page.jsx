import SmsSubscribe from '../../components/SmsSubscribe';
import { safeNext } from '../../lib/oauth';

export const metadata = { title: 'Deals by text — Bargain Bay', description: 'Subscribe to Bargain Bay appliance deals by text message.' };

// Also the skippable step a new Google / Microsoft account lands on (?welcome=1&next=/path).
export default async function TextsPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const welcome = sp.welcome === '1';
  const next = welcome ? safeNext(sp.next) : '';
  return (
    <div className="narrow">
      <h1 style={{ color: 'var(--charcoal)' }}>{welcome ? 'Your account is ready' : 'Deals by text'}</h1>
      {welcome && <p style={{ fontSize: 15 }}>Want our deals by text too? It&apos;s optional.</p>}
      <SmsSubscribe where={welcome ? 'new account page' : 'texts page'} next={next} />
      {welcome && <p style={{ textAlign: 'center' }}><a href={next} style={{ textDecoration: 'underline' }}>No thanks, continue →</a></p>}
    </div>
  );
}
