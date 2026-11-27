// The Manager's morning brief: ONE page that says what the Manager did, what it is stuck on,
// what is waiting for the owner, and where the sales are leaking.
//
// WHY: the Manager's work was only visible as a phone call, an email, or a log on /admin/manager.
// A manager whose work you cannot see reads as one that does nothing. This page is the answer to
// "what did you do and what do you need from me", in one place.
//
// READ-ONLY and ADMIN-ONLY (it carries margin figures through the pricing watch). Every section is
// independently caught so one failing read shows "could not read" instead of a blank page.
import { businessSnapshot, recentActions } from './manager-actions';
import { scanIssues } from './manager-issues';
import { buildGrowthBrief } from './manager-growth';

const safe = async (f, fallback) => { try { return await f(); } catch { return fallback; } };

export async function buildMorningBrief() {
  const [snapshot, actions, scan, growth] = await Promise.all([
    safe(() => businessSnapshot(), null),
    safe(() => recentActions(30), []),
    safe(() => scanIssues(), { issues: [], hidden: [] }),
    buildGrowthBrief()
  ]);
  const dayAgo = Date.now() - 24 * 3600_000;
  const done = (actions || []).filter((a) => new Date(a.at).getTime() >= dayAgo);
  const needsYou = (scan.issues || []).filter((i) => i.severity === 'high').slice(0, 8);
  return {
    generatedAt: growth.generatedAt,
    snapshot, done, needsYou,
    open: (scan.issues || []).filter((i) => i.severity !== 'high').slice(0, 10),
    snoozed: (scan.hidden || []).length,
    growth
  };
}
