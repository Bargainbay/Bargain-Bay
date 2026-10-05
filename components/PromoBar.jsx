// The site-wide promotion line, in the header's top strip.
//
// Server component, handed to the client Header as a prop. `connection()` marks
// it dynamic: without it, a page that is otherwise static would bake whatever
// promotion was running at BUILD time into its HTML, and show it until the next
// deploy. On any failure it renders the header's ordinary
// announcement; a promotion line must never be able to break a page.
import { connection } from 'next/server';
import { dealsSnapshot } from '../lib/deals';
import { bannerFor } from '../lib/deals-config';

// With no promotion running it renders the header's ordinary line, because a
// React element is truthy even when it renders nothing: returning null here
// would leave the strip empty rather than falling back.
const DEFAULT_LINE = (
  <>New lot just landed — tested &amp; working, <b>up to ~70% off retail</b>. <a href="/shop">Shop now →</a></>
);

export default async function PromoBar() {
  try {
    await connection();
    const b = bannerFor(await dealsSnapshot());
    if (!b) return DEFAULT_LINE;
    return (
      <>
        <b>{b.text}</b>{' '}
        <a href={b.href}>See the deal →</a>
        {b.extra && <> · <a href={b.extra.href}>{b.extra.text}</a></>}
      </>
    );
  } catch {
    return DEFAULT_LINE;
  }
}
