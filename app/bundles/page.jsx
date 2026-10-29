import { getAvailable } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { liveBundles } from '../../lib/bundles';
import { money } from '../../lib/constants';
import AddBundleButton from '../../components/AddBundleButton';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Appliance Packages — Washer & Dryer Pairs and Kitchen Bundles',
  description: 'Buy appliances together and save: washer and dryer pairs, whole-kitchen packages. Every unit tested with a one-year warranty. One of each, while they last.',
  alternates: { canonical: '/bundles' }
};

export default async function BundlesPage() {
  const session = await getSession();
  const units = await decorate(await getAvailable(), session).catch(() => []);
  const bundles = await liveBundles(units);
  return (
    <div>
      <h1 style={{ color: 'var(--charcoal)' }}>Packages — buy together, save more</h1>
      <p style={{ color: 'var(--muted)', maxWidth: 640 }}>
        Matched pairs and whole-room sets at one package price. Each unit is tested with a one-year warranty,
        and when a package is gone, it&apos;s gone. Need something else? <a href="/bundle">Build your own bundle</a>.
      </p>
      {!bundles.length && <p>No packages right now — check back soon, or <a href="/bundle">ask for a custom package price</a>.</p>}
      <div className="grid">
        {bundles.map((b) => (
          <div key={b.id} className="card">
            <span className="off-badge">Save {money(b.save)}</span>
            <div className="card-body">
              <div className="card-title">{b.title}</div>
              {b.blurb && <div className="card-model">{b.blurb}</div>}
              <ul style={{ paddingLeft: 18, margin: '8px 0', fontSize: 14 }}>
                {b.units.map((u) => (
                  <li key={u.id}><a href={`/product/${encodeURIComponent(u.id)}`}>{u.title || `${u.make} ${u.model}`}</a> <span style={{ color: 'var(--muted)' }}>{u.condition}</span></li>
                ))}
              </ul>
              <div className="price-row">
                <span className="price">{money(b.price)}</span>
                <span className="compare">{money(b.regular)}</span>
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 8 }}><AddBundleButton skus={b.skus} /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
