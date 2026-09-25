// "This is not production." Rendered on every page of a non-production
// deployment, and nothing at all on the real site.
//
// A staging environment that looks identical to production is its own hazard:
// somebody refunds an order on it, or reads a dashboard off it and quotes the
// number in a meeting. The outbound guards in lib/environment stop staging
// reaching customers; this stops it fooling the team.
import { deployEnv, isProduction } from '../lib/environment';

export default function EnvBanner() {
  if (isProduction()) return null;
  const env = deployEnv();
  return (
    <div
      role="status"
      style={{
        background: '#7a1fa2', color: '#fff', textAlign: 'center',
        padding: '5px 12px', fontSize: 12.5, fontWeight: 700,
        letterSpacing: '0.04em', textTransform: 'uppercase'
      }}
    >
      {env} — not the live site. Orders, emails and texts here do not reach customers.
    </div>
  );
}
