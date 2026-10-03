import { counted } from '../ledger';
import type { ID, MerchantRule, Paise, Transaction } from '../types';
import { guessCategory, merchantKey } from './categorize';

/**
 * "Where does your money go?": captured payments grouped by shop, biggest first, so a few
 * choices categorise most of your spending. Shops you've already sorted (a rule exists) and
 * payments still waiting for "Spent or lent?" are left out.
 */

export interface ShopToSort {
  key: string;
  name: string;
  payments: number;
  total: Paise;
  /** Our guess from the built-in list; undefined = we have no idea ("Pick"). */
  guess?: ID;
  txnIds: ID[];
}

export interface ShopSummary {
  shops: ShopToSort[];
  /** Spending at all unsorted shops (for "these N cover X%"). */
  unsortedTotal: Paise;
}

export function shopsToSort(txns: Transaction[], rules: MerchantRule[]): ShopSummary {
  const ruleKeys = new Set(rules.filter((r) => !r.deletedAt).map((r) => r.key));
  const map = new Map<string, ShopToSort>();
  for (const t of txns) {
    if (!counted(t) || t.kind !== 'expense' || !t.merchant || t.splits || t.askLoan) continue;
    if (t.source !== 'sms' && t.source !== 'notification') continue;
    const key = merchantKey(t.merchant);
    if (!key || ruleKeys.has(key)) continue;
    let s = map.get(key);
    if (!s) {
      const g = guessCategory(t.merchant, []);
      s = { key, name: t.merchant, payments: 0, total: 0, guess: g.categoryId, txnIds: [] };
      map.set(key, s);
    }
    s.payments++;
    s.total += t.amount;
    s.txnIds.push(t.id);
  }
  const shops = [...map.values()].sort((a, b) => b.total - a.total);
  return { shops, unsortedTotal: shops.reduce((sum, s) => sum + s.total, 0) };
}
