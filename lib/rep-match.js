// Pure helpers for the sales scorecard. NO IMPORTS — the quota form runs in the
// browser too, and the matching rule is the one thing worth testing without a
// database.

// The key a person is grouped on: case and spacing folded away, so "Roushi",
// "roushi " and "ROUSHI" are one rep. Same reasoning as the lead-by grouping.
export const repKey = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const firstToken = (k) => k.split(' ')[0];

/**
 * Does this "sent by" name belong to this rep?
 *
 * Exact (folded) match always counts. A single-word "sent by" also counts when
 * it is the first name of exactly ONE rep on the team — somebody typing "Roushi"
 * for the rep "Roushi Sharma" is the ordinary case. If two reps share a first
 * name it matches neither: crediting the wrong person's quota is worse than
 * leaving it for the owner to tidy.
 */
export function isOwnLead(closerKey, leadKey, allRepKeys = []) {
  if (!closerKey || !leadKey) return false;
  if (closerKey === leadKey) return true;
  if (leadKey.includes(' ')) return false;
  if (firstToken(closerKey) !== leadKey) return false;
  const sharing = new Set(allRepKeys.filter((k) => k && firstToken(k) === leadKey));
  sharing.add(closerKey);
  return sharing.size === 1;
}

/**
 * How a measure stands against its target part-way through a month.
 * `pace` is the fraction of the month gone (0..1). Returns null with no target.
 */
/**
 * Whose lead is it? The rep a "sent by" name belongs to, or '' when it is not a
 * rep at all (Sai, Ravi, a referral). This is who gets the LEAD credit — the
 * person who closed the sale is a different question and a different column.
 */
export function leadOwner(leadKey, repKeys = []) {
  for (const k of repKeys) if (isOwnLead(k, leadKey, repKeys)) return k;
  return '';
}

export function standing(actual, target, pace) {
  if (target == null || target === '') return null;
  const t = Number(target);
  const a = Number(actual) || 0;
  if (!(t > 0)) return { pct: a > 0 ? 100 : 0, status: a > 0 ? 'hit' : 'none', gap: 0 };
  const pct = (a / t) * 100;
  const status = pct >= 100 ? 'hit' : pct >= pace * 100 ? 'on_pace' : pct >= pace * 100 * 0.75 ? 'close' : 'behind';
  return { pct, status, gap: Math.max(0, t - a) };
}
