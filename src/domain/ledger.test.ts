import {
  balanceOf,
  billReserve,
  calendarVsStatement,
  cardSnapshot,
  dailySpend,
  statementFor,
  summariseMonth,
} from './ledger';
import { periodClosingIn } from './cycle';
import { account, txn } from './testkit';

const bank = account({ id: 'bank', kind: 'bank', openingBalance: 100_000_00 });
const cash = account({ id: 'cash', kind: 'cash', openingBalance: 2_000_00 });
const card = account({
  id: 'card',
  kind: 'credit_card',
  card: { statementDay: 15, dueDaysAfterStatement: 20, creditLimit: 200_000_00 },
});

const txns = [
  txn({
    kind: 'income',
    date: '2026-09-01',
    amount: 90_000_00,
    accountId: 'bank',
    categoryId: 'salary',
  }),
  txn({
    kind: 'expense',
    date: '2026-08-20',
    amount: 4_000_00,
    accountId: 'card',
    categoryId: 'shopping',
  }),
  txn({
    kind: 'expense',
    date: '2026-09-10',
    amount: 3_000_00,
    accountId: 'card',
    categoryId: 'food',
  }),
  txn({
    kind: 'expense',
    date: '2026-09-20',
    amount: 5_000_00,
    accountId: 'card',
    categoryId: 'travel',
  }),
  txn({
    kind: 'refund',
    date: '2026-09-22',
    amount: 1_000_00,
    accountId: 'card',
    categoryId: 'travel',
  }),
  txn({
    kind: 'expense',
    date: '2026-09-05',
    amount: 500_00,
    accountId: 'cash',
    categoryId: 'food',
  }),
  txn({
    kind: 'transfer',
    date: '2026-09-12',
    amount: 1_000_00,
    accountId: 'bank',
    toAccountId: 'cash',
  }),
  // Paying the August statement — a transfer, must never count as spending.
  txn({
    kind: 'transfer',
    date: '2026-09-25',
    amount: 7_000_00,
    accountId: 'bank',
    toAccountId: 'card',
  }),
  txn({
    kind: 'expense',
    date: '2026-09-28',
    amount: 999_00,
    accountId: 'bank',
    status: 'pending',
  }),
];

describe('monthly spending by actual date', () => {
  it('counts expenses minus refunds; ignores transfers, card payments and pending items', () => {
    const s = summariseMonth(txns, '2026-09');
    expect(s.expenses).toBe(8_500_00);
    expect(s.refunds).toBe(1_000_00);
    expect(s.spent).toBe(7_500_00);
    expect(s.income).toBe(90_000_00);
    expect(s.byCategory.get('travel')).toBe(4_000_00);
    expect(s.byCategory.get('food')).toBe(3_500_00);
    expect(s.byAccount.get('card')).toBe(7_000_00);
  });

  it('honours splits', () => {
    const t = txn({
      kind: 'expense',
      date: '2026-09-03',
      amount: 1_000_00,
      accountId: 'cash',
      splits: [
        { categoryId: 'food', amount: 600_00 },
        { categoryId: 'home', amount: 400_00 },
      ],
    });
    const s = summariseMonth([t], '2026-09');
    expect(s.byCategory.get('food')).toBe(600_00);
    expect(s.byCategory.get('home')).toBe(400_00);
  });

  it('daily spend has one slot per day', () => {
    const d = dailySpend(txns, '2026-09');
    expect(d).toHaveLength(30);
    expect(d[9]).toBe(3_000_00);
    expect(d[21]).toBe(-1_000_00);
  });
});

describe('balances', () => {
  it('bank and cash', () => {
    expect(balanceOf(bank, txns, '2026-09-30')).toBe(100_000_00 + 90_000_00 - 1_000_00 - 7_000_00);
    expect(balanceOf(cash, txns, '2026-09-30')).toBe(2_000_00 - 500_00 + 1_000_00);
  });

  it('credit card shows amount owed', () => {
    expect(balanceOf(card, txns, '2026-09-30')).toBe(
      4_000_00 + 3_000_00 + 5_000_00 - 1_000_00 - 7_000_00,
    );
  });

  it('bill reserve', () => {
    const r = billReserve([bank, cash, card], txns, '2026-09-30');
    expect(r.owedToCards).toBe(4_000_00);
    expect(r.freeToSpend).toBe(r.cash - 4_000_00);
  });
});

describe('credit card statements', () => {
  it('statement closing 15 Sep bills 16 Aug – 15 Sep spending and is paid by the 25 Sep transfer', () => {
    const st = statementFor(card, txns, periodClosingIn(card.card!, '2026-09'), '2026-09-30');
    expect(st.charges).toBe(7_000_00);
    expect(st.totalDue).toBe(7_000_00);
    expect(st.paidAfter).toBe(7_000_00);
    expect(st.remaining).toBe(0);
    expect(st.status).toBe('paid');
  });

  it('partly paid statement is due, then overdue after the due date', () => {
    const partial = txns.map((t) => (t.date === '2026-09-25' ? { ...t, amount: 5_000_00 } : t));
    const p = periodClosingIn(card.card!, '2026-09');
    expect(statementFor(card, partial, p, '2026-09-30')).toMatchObject({
      remaining: 2_000_00,
      status: 'due',
    });
    expect(statementFor(card, partial, p, '2026-10-06').status).toBe('overdue');
  });

  it('unpaid balance carries into the next statement total', () => {
    const unpaid = txns.filter((t) => t.date !== '2026-09-25');
    const oct = statementFor(card, unpaid, periodClosingIn(card.card!, '2026-10'), '2026-10-20');
    expect(oct.charges).toBe(5_000_00);
    expect(oct.credits).toBe(1_000_00);
    expect(oct.totalDue).toBe(7_000_00 + 4_000_00);
  });

  it('snapshot gives due now, unbilled and total owed', () => {
    const s = cardSnapshot(card, txns, '2026-09-30');
    expect(s.currentPeriod.closesIn).toBe('2026-10');
    expect(s.dueNow).toBe(0);
    expect(s.unbilled).toBe(4_000_00);
    expect(s.owed).toBe(4_000_00);
    expect(s.available).toBe(200_000_00 - 4_000_00);
  });
});

describe('calendar month vs statement', () => {
  it('splits September card spending across the statements it lands on', () => {
    const v = calendarVsStatement(card, txns, '2026-09');
    expect(v.spentThisMonth).toBe(7_000_00);
    expect(v.onThisMonthsStatement).toBe(3_000_00);
    expect(v.onNextStatement).toBe(4_000_00);
    expect(v.closingStatementSpend).toBe(7_000_00);
    expect(v.fromPreviousMonth).toBe(4_000_00);
    expect(v.fromThisMonth).toBe(3_000_00);
  });
});
