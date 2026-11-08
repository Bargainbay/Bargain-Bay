import { redirect } from 'next/navigation';

// The bankroll lives at the top of the Financial page now; this keeps any saved link working.
export default function BankrollMoved() {
  redirect('/admin/financial');
}
