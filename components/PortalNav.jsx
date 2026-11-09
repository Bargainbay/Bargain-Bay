import { cookies } from 'next/headers';
import AdminNav from './AdminNav';
import SalesNav from './SalesNav';
import { isAdmin, isSalesRep } from '../lib/auth';

// The header for the selling pages that live under /admin (quotes, invoices). The business-development rep gets the
// SAME Sales Hub header they have everywhere else, so they never meet the full Sales Portal menu (orders, warehouse,
// dispatch, intake…) that is not theirs; everyone else gets the admin nav exactly as before.
export default async function PortalNav({ active, session }) {
  if (isSalesRep(session) && !isAdmin(session)) {
    const side = (await cookies()).get('bb_hub_side')?.value;
    return <SalesNav side={side === 'bb' || side === 'rs' ? side : 'all'} name={session.name || ''} />;
  }
  return <AdminNav active={active} salesOnly={!isAdmin(session)} />;
}
