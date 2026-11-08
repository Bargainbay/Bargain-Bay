// One load for the Financial page's first section: link any card receipts the bank has since shown, then
// read the bankroll and the receipt list together, so what is on screen agrees with itself.
import { bankrollSummary } from './bankroll';
import { listReceipts, linkWaitingReceipts } from './receipts';

export async function loadBankroll(date) {
  await linkWaitingReceipts().catch((e) => console.error('receipt linking failed', e?.message || e));
  const summary = await bankrollSummary(date);
  const receipts = await listReceipts(200).catch(() => []);
  return { ...summary, receipts };
}
