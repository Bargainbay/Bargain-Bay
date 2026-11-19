import { redirect } from 'next/navigation';

// The old address. The tab is called Pricing now.
export default function MemberPricingRedirect() {
  redirect('/admin/pricing');
}
