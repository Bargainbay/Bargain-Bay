// The page the unsubscribe link in a marketing message lands on.
//
// Nothing is written here. A GET must not opt anybody out: mail scanners and
// link-preview crawlers fetch every URL in a message, and this repo has already
// had a one-time link burned that way (the driver sign-in link — see
// lib/drivers.js). The button POSTs.
import { Suspense } from 'react';
import { verifyUnsubToken } from '../../lib/links';
import UnsubscribeForm from './UnsubscribeForm';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Unsubscribe — Bargain Bay',
  // An unsubscribe page has no business in a search index.
  robots: { index: false, follow: false }
};

export default async function UnsubscribePage({ searchParams }) {
  const sp = await searchParams;
  const identity = String(sp?.i || '').trim();
  const token = String(sp?.t || '').trim();
  const channel = sp?.c === 'sms' ? 'sms' : 'email';

  if (!identity || !verifyUnsubToken(identity, token)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>That link isn&apos;t valid</h1>
        <p style={{ fontSize: 15 }}>
          It may have been cut in half by your email program. Forward the message to
          {' '}<a href="mailto:sales@bargainbay.ca">sales@bargainbay.ca</a> and we&apos;ll take you
          off the list by hand.
        </p>
      </div></div>
    );
  }

  return (
    <div className="narrow">
      <Suspense fallback={<div className="panel">Loading…</div>}>
        <UnsubscribeForm identity={identity} token={token} channel={channel} />
      </Suspense>
    </div>
  );
}
