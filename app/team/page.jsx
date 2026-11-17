import { redirect } from 'next/navigation';
import { getSession } from '../../lib/auth';
import { memberFromSession } from '../../lib/team-board';
import TeamChat from '../../components/TeamChat';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team board', robots: { index: false } };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#3A3937' };

// One place for the whole crew of both companies: chat and posts in General, Sales,
// Warehouse and Delivery. Which channels you see comes from your sign-in
// (lib/team-board-rules.js); nothing on the page chooses them.
export default async function TeamPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/team');
  const member = await memberFromSession(session);
  if (!member) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not on the team list yet</h1>
        <p style={{ fontSize: 14 }}>You&apos;re signed in as <b>{session.email}</b>, but that account isn&apos;t a driver, employee or staff member yet. Ask the office to add it.</p>
      </div></div>
    );
  }
  const back = member.groups.includes('admin') || member.groups.includes('staff') ? { href: '/admin', label: '← Back to the portal' }
    : member.groups.includes('driver') ? { href: '/driver', label: '← Back to my stops' }
    : member.groups.includes('dispatcher') ? { href: '/admin/dispatch', label: '← Back to dispatch' }
    : { href: '/clock', label: '← Back to the clock' };
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <p style={{ margin: '0 0 6px' }}><a href={back.href}>{back.label}</a></p>
      <h1 style={{ color: 'var(--charcoal)', marginTop: 0 }}>Team board</h1>
      <TeamChat initialChannel={sp?.channel || 'general'} />
    </div>
  );
}
