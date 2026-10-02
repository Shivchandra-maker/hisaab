import 'fake-indexeddb/auto';
import {
  adjustBalance,
  db,
  deleteTransaction,
  ensureDefaults,
  exportBackup,
  importBackup,
  recordDebtMovement,
  resetAll,
  restoreTransaction,
  saveAccount,
  saveCategory,
  saveTransaction,
  startDebt,
} from './repo';
import { balanceOf, debtBalance, summariseMonth } from '../domain/ledger';
import type { Account, Transaction } from '../domain/types';

const base = { tags: [], source: 'manual' as const, status: 'confirmed' as const };
let bank: Account;
let card: Account;

beforeEach(async () => {
  await resetAll();
  bank = await saveAccount({
    name: 'HDFC',
    kind: 'bank',
    openingBalance: 50_000_00,
    openingDate: '2026-09-01',
    archived: false,
    sortOrder: 0,
  });
  card = await saveAccount({
    name: 'Card',
    kind: 'credit_card',
    openingBalance: 0,
    openingDate: '2026-09-01',
    archived: false,
    sortOrder: 1,
    card: { statementDay: 15, dueDaysAfterStatement: 20, creditLimit: 1_00_000_00 },
  });
});

const all = () => db.transactions.toArray();

describe('accounts', () => {
  it('rejects bad card details', async () => {
    await expect(
      saveAccount({
        ...card,
        id: undefined,
        card: { statementDay: 0, dueDaysAfterStatement: 20, creditLimit: 0 },
      }),
    ).rejects.toThrow('Statement day');
    await expect(saveAccount({ ...bank, id: undefined, name: '  ' })).rejects.toThrow('name');
  });

  it('drops card details from non-card accounts', async () => {
    const a = await saveAccount({
      ...bank,
      id: undefined,
      name: 'Cash',
      kind: 'cash',
      card: card.card,
    });
    expect(a.card).toBeUndefined();
  });
});

describe('transactions', () => {
  it('validates transfers and splits', async () => {
    await expect(
      saveTransaction({
        ...base,
        kind: 'transfer',
        date: '2026-09-02',
        amount: 100,
        accountId: bank.id,
        toAccountId: bank.id,
      }),
    ).rejects.toThrow('two different');
    await expect(
      saveTransaction({
        ...base,
        kind: 'expense',
        date: '2026-09-02',
        amount: 1000,
        accountId: bank.id,
        splits: [
          { categoryId: 'food', amount: 600 },
          { categoryId: 'home', amount: 300 },
        ],
      }),
    ).rejects.toThrow('add up');
    await expect(
      saveTransaction({
        ...base,
        kind: 'expense',
        date: '2026-09-02',
        amount: 0,
        accountId: bank.id,
      }),
    ).rejects.toThrow('amount');
  });

  it('cleans fields that do not belong to the kind', async () => {
    const t = await saveTransaction({
      ...base,
      kind: 'transfer',
      date: '2026-09-02',
      amount: 500,
      accountId: bank.id,
      toAccountId: card.id,
      categoryId: 'food',
    });
    expect(t.categoryId).toBeUndefined();
  });

  it('edits in place, soft-deletes and restores', async () => {
    const t = await saveTransaction({
      ...base,
      kind: 'expense',
      date: '2026-09-02',
      amount: 500,
      accountId: bank.id,
      categoryId: 'food',
    });
    await saveTransaction({ ...t, amount: 700 });
    expect((await all()).length).toBe(1);
    expect(summariseMonth(await all(), '2026-09').spent).toBe(700);
    await deleteTransaction(t.id);
    expect(summariseMonth(await all(), '2026-09').spent).toBe(0);
    await restoreTransaction(t.id);
    expect(summariseMonth(await all(), '2026-09').spent).toBe(700);
  });
});

describe('balance adjustment', () => {
  it('moves the balance to the real figure without counting as spending', async () => {
    await saveTransaction({
      ...base,
      kind: 'expense',
      date: '2026-09-05',
      amount: 2_000_00,
      accountId: bank.id,
      categoryId: 'food',
    });
    await adjustBalance(bank.id, 47_500_00, '2026-09-10');
    const txns = await all();
    expect(balanceOf(bank, txns, '2026-09-30')).toBe(47_500_00);
    expect(summariseMonth(txns, '2026-09').spent).toBe(2_000_00);
  });

  it('works on credit cards as amount owed', async () => {
    await adjustBalance(card.id, 1_200_00, '2026-09-10');
    expect(balanceOf(card, await all(), '2026-09-30')).toBe(1_200_00);
    await adjustBalance(card.id, 200_00, '2026-09-11');
    expect(balanceOf(card, await all(), '2026-09-30')).toBe(200_00);
  });

  it('does nothing when the balance already matches', async () => {
    expect(await adjustBalance(bank.id, 50_000_00, '2026-09-10')).toBeNull();
  });
});

describe('money lent and borrowed', () => {
  it('tracks a loan through repayment to settled, without touching spending', async () => {
    const d = await startDebt({
      person: 'Rahul',
      direction: 'lent',
      amount: 3_000_00,
      accountId: bank.id,
      date: '2026-09-03',
    });
    expect(balanceOf(bank, await all(), '2026-09-30')).toBe(47_000_00);
    await recordDebtMovement({
      debtId: d.id,
      type: 'repayment',
      amount: 1_000_00,
      accountId: bank.id,
      date: '2026-09-10',
    });
    expect(debtBalance(d, await all()).outstanding).toBe(2_000_00);
    await expect(
      recordDebtMovement({
        debtId: d.id,
        type: 'repayment',
        amount: 5_000_00,
        accountId: bank.id,
        date: '2026-09-11',
      }),
    ).rejects.toThrow('more than');
    await recordDebtMovement({
      debtId: d.id,
      type: 'repayment',
      amount: 2_000_00,
      accountId: bank.id,
      date: '2026-09-12',
    });
    expect((await db.debts.get(d.id))?.settledAt).toBe('2026-09-12');
    const s = summariseMonth(await all(), '2026-09');
    expect(s.spent).toBe(0);
    expect(s.income).toBe(0);
    expect(balanceOf(bank, await all(), '2026-09-30')).toBe(50_000_00);
  });

  it('borrowing adds money to the account', async () => {
    await startDebt({
      person: 'Priya',
      direction: 'borrowed',
      amount: 800_00,
      accountId: bank.id,
      date: '2026-09-03',
    });
    expect(balanceOf(bank, await all(), '2026-09-30')).toBe(50_800_00);
  });

  it('un-settles when a repayment is deleted', async () => {
    const d = await startDebt({
      person: 'Amit',
      direction: 'lent',
      amount: 500_00,
      accountId: bank.id,
      date: '2026-09-03',
    });
    const r = await recordDebtMovement({
      debtId: d.id,
      type: 'repayment',
      amount: 500_00,
      accountId: bank.id,
      date: '2026-09-04',
    });
    expect((await db.debts.get(d.id))?.settledAt).toBeDefined();
    await deleteTransaction(r.id);
    expect((await db.debts.get(d.id))?.settledAt).toBeUndefined();
  });
});

describe('categories', () => {
  it('allows one level of sub-categories of the same type', async () => {
    await ensureDefaults();
    const sub = await saveCategory({
      name: 'Eating out',
      kind: 'expense',
      parentId: 'food',
      icon: 'utensils',
      color: 'cat-1',
      archived: false,
      sortOrder: 0,
    });
    await expect(
      saveCategory({
        name: 'Too deep',
        kind: 'expense',
        parentId: sub.id,
        icon: 'dots',
        color: 'cat-1',
        archived: false,
        sortOrder: 0,
      }),
    ).rejects.toThrow('main category');
    await expect(
      saveCategory({
        name: 'Mixed',
        kind: 'income',
        parentId: 'food',
        icon: 'dots',
        color: 'cat-1',
        archived: false,
        sortOrder: 0,
      }),
    ).rejects.toThrow('same type');
  });
});

describe('backup', () => {
  it('round-trips everything', async () => {
    await saveTransaction({
      ...base,
      kind: 'expense',
      date: '2026-09-02',
      amount: 500,
      accountId: card.id,
      categoryId: 'food',
    });
    const json = JSON.stringify(await exportBackup());
    await resetAll();
    expect(await db.accounts.count()).toBe(0);
    const r = await importBackup(json);
    expect(r).toEqual({ accounts: 2, transactions: 1 });
    const t = (await all())[0] as Transaction;
    expect(t.accountId).toBe(card.id);
  });

  it('rejects files that are not backups', async () => {
    await expect(importBackup('{"hello":1}')).rejects.toThrow('isn’t a Hisaab backup');
    await expect(importBackup('nope')).rejects.toThrow('valid JSON');
  });
});
