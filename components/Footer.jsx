import { SALES_EMAIL, PICKUP_ADDRESS } from '../lib/constants';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="cols">
          <div>
            <img src="/bargain-bay-logo-on-charcoal.png" alt="Bargain Bay" className="footer-logo" />
            <p className="tagline">Tested. Working. Warrantied. Hamilton &amp; the GTA.</p>
            <p style={{ fontSize: 14, margin: '0 0 8px' }}>
              Name-brand appliances at liquidation prices — every unit tested &amp; working and backed
              by a one-year warranty. Pickup, delivery &amp; freight serving Hamilton, Scarborough and the GTA.
            </p>
            <p style={{ fontSize: 13.5, margin: 0 }}>
              {PICKUP_ADDRESS}<br />
              <a href={`mailto:${SALES_EMAIL}`} style={{ display: 'inline', padding: 0, color: 'var(--line)' }}>{SALES_EMAIL}</a>
            </p>
          </div>
          <div>
            <h4>Shop</h4>
            <a href="/shop">All inventory</a>
            <a href="/shop?collection=under-500">Deals under $500</a>
            <a href="/cart">Cart</a>
            <a href="/track">Track your order</a>
          </div>
          <div>
            <h4>Policies</h4>
            <a href="/policies/returns">Returns &amp; Refunds</a>
            <a href="/policies/shipping">Shipping &amp; Delivery</a>
            <a href="/policies/privacy">Privacy Policy</a>
            <a href="/policies/terms">Terms of Service</a>
            <a href="/contact">Contact Us</a>
          </div>
        </div>
        <div className="legal">
          © {new Date().getFullYear()} Bargain Bay / RS Solutions · Hamilton (Lynden), Ontario — serving Hamilton, Scarborough &amp; the GTA · All prices in CAD, HST added at checkout. · HST # 00000 0000 RT0001 (placeholder — update before launch)
        </div>
      </div>
    </footer>
  );
}
