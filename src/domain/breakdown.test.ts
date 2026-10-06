import { sampleData } from '../sample/sample';
import { breakdownItems, parseBreakdownRoute, breakdownRoute, sumItems } from './breakdown';
import { counted, spendEffect, summariseMonth } from './ledger';
import { monthOf, monthRange } from './dates';

/** U-20: each Insights number and its drill-down list add up to the same amount. */
describe('Insights drill-down', () => {
  const today = '2026-10-04';
  const { transactions: txns } = sampleData(today);
  const month = monthOf(today);
  const { start, end } = monthRange(month);
  const s = summariseMonth(txns, month);

  it('categories match Insights', () => {
    expect(s.byCategory.size).toBeGreaterThan(0);
    for (const [id, amt] of s.byCategory)
      expect(sumItems(breakdownItems(txns, { by: 'category', id }, start, end))).toBe(amt);
  });

  it('accounts match Insights', () => {
    for (const [id, amt] of s.byAccount)
      expect(sumItems(breakdownItems(txns, { by: 'account', id }, start, end))).toBe(amt);
  });

  it('ways of paying match Insights', () => {
    const byMode = new Map<string, number>();
    for (const t of txns) {
      if (!counted(t) || monthOf(t.date) !== month || t.kind !== 'expense') continue;
      const k = t.paymentMode ?? 'other';
      byMode.set(k, (byMode.get(k) ?? 0) + spendEffect(t));
    }
    for (const [id, amt] of byMode)
      expect(sumItems(breakdownItems(txns, { by: 'mode', id }, start, end))).toBe(amt);
  });

  it('routes round-trip', () => {
    const k = { by: 'account' as const, id: 'abc-123' };
    expect(parseBreakdownRoute(breakdownRoute(k))).toEqual(k);
    expect(parseBreakdownRoute('insights')).toBeUndefined();
  });
});
