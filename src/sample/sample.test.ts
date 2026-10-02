import { sampleData } from './sample';
import { balanceOf, cardSnapshot, summariseMonth } from '../domain/ledger';

describe('sample data', () => {
  const today = '2026-10-02';
  const { accounts, transactions } = sampleData(today);

  it('keeps asset balances positive and cards within limit', () => {
    for (const a of accounts) {
      const b = balanceOf(a, transactions, today);
      if (a.card) expect(b).toBeLessThan(a.card.creditLimit);
      else expect(b).toBeGreaterThan(0);
    }
  });

  it('has realistic monthly spending', () => {
    const s = summariseMonth(transactions, '2026-09');
    expect(s.spent).toBeGreaterThan(40_000_00);
    expect(s.spent).toBeLessThan(1_10_000_00);
  });

  it('cards have no overdue statements', () => {
    for (const a of accounts.filter((x) => x.card)) {
      expect(cardSnapshot(a, transactions, today).dueStatus).not.toBe('overdue');
    }
  });
});
