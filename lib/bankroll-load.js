// One load for the Financial page's first section: link any card receipts the bank has since shown, then
// read the bankroll and the receipt list together, so what is on screen agrees with itself.
import { bankrollSummary } from './bankroll';
import { listReceipts, linkWaitingReceipts } from './receipts';
import { payBalances, linkWaitingPayments } from './pay-ledger';
import { getExtraCategories } from './finance';

export async function loadBankroll(date, opts = {}) {
  await linkWaitingReceipts().catch((e) => console.error('receipt linking failed', e?.message || e));
  await linkWaitingPayments().catch((e) => console.error('payment linking failed', e?.message || e));
  const summary = await bankrollSummary(date, opts);
  const receipts = await listReceipts(200).catch(() => []);
  const pay = await payBalances().catch(() => ({ people: [], names: [] }));
  const customCategories = await getExtraCategories().catch(() => []);
  return { ...summary, receipts, pay, customCategories };
}
