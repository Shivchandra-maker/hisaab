import { categoryParts, counted, INVESTMENTS } from './ledger';
import type { ID, ISODate, Paise, Transaction } from './types';

/**
 * Insights drill-down (U-20): every number on Insights opens the payments behind it. The amounts
 * here follow exactly the rules Insights uses, so a category, a way of paying or an account adds
 * up to the same figure on both screens.
 */

export type BreakdownBy = 'category' | 'mode' | 'account';
export interface BreakdownKey {
  by: BreakdownBy;
  /** Category id ('uncategorised' for none), payment mode, or account id. */
  id: string;
}

const PREFIX: Record<BreakdownBy, string> = {
  category: 'spend-cat-',
  mode: 'spend-mode-',
  account: 'spend-acct-',
};

export const breakdownRoute = (k: BreakdownKey) => `${PREFIX[k.by]}${k.id}`;

export function parseBreakdownRoute(route: string): BreakdownKey | undefined {
  for (const by of Object.keys(PREFIX) as BreakdownBy[])
    if (route.startsWith(PREFIX[by])) return { by, id: route.slice(PREFIX[by].length) };
  return undefined;
}

export interface BreakdownItem {
  t: Transaction;
  /** This payment's share of the total (negative for refunds). */
  amount: Paise;
}

/** Spending that belongs to `key` between two dates (inclusive), oldest first. */
export function breakdownItems(
  txns: Transaction[],
  key: BreakdownKey,
  start: ISODate,
  end: ISODate,
): BreakdownItem[] {
  const out: BreakdownItem[] = [];
  for (const t of txns) {
    if (!counted(t) || t.date < start || t.date > end) continue;
    if (t.kind !== 'expense' && t.kind !== 'refund') continue;
    const sign = t.kind === 'expense' ? 1 : -1;
    // Investments aren't spending: they never appear in these totals (same as Insights).
    const parts = categoryParts(t).filter((p) => p.categoryId !== INVESTMENTS);
    let amount = 0;
    if (key.by === 'category')
      amount = parts
        .filter((p) => (p.categoryId ?? 'uncategorised') === key.id)
        .reduce((n, p) => n + p.amount, 0);
    else if (key.by === 'account')
      amount = t.accountId === key.id ? parts.reduce((n, p) => n + p.amount, 0) : 0;
    else if (t.kind === 'expense' && (t.paymentMode ?? 'other') === key.id)
      amount = parts.reduce((n, p) => n + p.amount, 0);
    if (amount) out.push({ t, amount: sign * amount });
  }
  return out;
}

export const sumItems = (items: BreakdownItem[]) => items.reduce((n, i) => n + i.amount, 0);

/** Totals per merchant, biggest first ("Where" on a category). */
export function byMerchant(
  items: BreakdownItem[],
): { name: string; amount: Paise; count: number }[] {
  const m = new Map<string, { name: string; amount: Paise; count: number }>();
  for (const i of items) {
    const name = i.t.merchant?.trim() || 'Other';
    const k = name.toLowerCase();
    const cur = m.get(k) ?? { name, amount: 0, count: 0 };
    m.set(k, { name: cur.name, amount: cur.amount + i.amount, count: cur.count + 1 });
  }
  return [...m.values()].filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

/** Totals per account ("From" on a way of paying). */
export function byAccount(items: BreakdownItem[]): { id: ID; amount: Paise }[] {
  const m = new Map<ID, number>();
  for (const i of items) m.set(i.t.accountId, (m.get(i.t.accountId) ?? 0) + i.amount);
  return [...m.entries()]
    .map(([id, amount]) => ({ id, amount }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Totals per category ("What it went on" for a way of paying or an account). */
export function byCategory(items: BreakdownItem[]): { id: string; amount: Paise }[] {
  const m = new Map<string, number>();
  for (const i of items) {
    const sign = i.t.kind === 'refund' ? -1 : 1;
    for (const p of categoryParts(i.t)) {
      if (p.categoryId === INVESTMENTS) continue;
      const k = p.categoryId ?? 'uncategorised';
      m.set(k, (m.get(k) ?? 0) + sign * p.amount);
    }
  }
  return [...m.entries()]
    .map(([id, amount]) => ({ id, amount }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}
