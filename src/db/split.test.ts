import 'fake-indexeddb/auto';
import {
  applyRulesToPast,
  db,
  deleteTransaction,
  learnRule,
  recategorise,
  samePayee,
  resetAll,
  restoreTransaction,
  saveAccount,
  saveTransaction,
  startDebt,
} from './repo';
import { notALoan, paidForOthers, resolvePersonPayment, unsplit, updateLoanEntry } from './loans';
import { balanceOf, debtBalance, summariseMonth } from '../domain/ledger';
import { findDuplicate } from '../domain/sms/match';
import type { Account, Transaction } from '../domain/types';

const base = { tags: [], source: 'manual' as const, status: 'confirmed' as const };
let hdfc: Account;
let icici: Account;
let croma: Transaction;

const all = () => db.transactions.toArray();
const live = async () => (await all()).filter((t) => !t.deletedAt);
const parts = async () => (await live()).filter((t) => t.splitOf === croma.id);
const debts = async () => (await db.debts.toArray()).filter((d) => !d.deletedAt);
const bal = async (a: Account) => balanceOf(a, await all());

beforeEach(async () => {
  await resetAll();
  const acct = (name: string, sortOrder: number) =>
    saveAccount({
      name,
      kind: 'bank',
      openingBalance: 50_000_00,
      openingDate: '2026-09-01',
      archived: false,
      sortOrder,
    });
  hdfc = await acct('HDFC', 0);
  icici = await acct('ICICI', 1);
  croma = await saveTransaction({
    ...base,
    kind: 'expense',
    date: '2026-10-05',
    time: '19:30',
    amount: 12_000_00,
    accountId: hdfc.id,
    merchant: 'Croma',
    categoryId: 'shopping',
    note: 'TV',
  });
});

describe('Paid for others: the group stays one payment', () => {
  it('a bank SMS for the full amount is a duplicate, not a second payment', async () => {
    await paidForOthers(croma.id, [{ person: 'Priya', amount: 8_000_00 }]);
    const dup = findDuplicate(
      { kind: 'expense', amount: 12_000_00, date: '2026-10-05', accountId: hdfc.id },
      await all(),
    );
    expect(dup?.txn.id).toBe(croma.id);
  });

  it('nothing for me: the payment stays as ₹0 of ₹12,000 and is still found as a duplicate', async () => {
    await paidForOthers(croma.id, [
      { person: 'Asha', amount: 6_000_00 },
      { person: 'Ravi', amount: 6_000_00 },
    ]);
    const t = (await db.transactions.get(croma.id))!;
    expect(t).toMatchObject({ kind: 'expense', amount: 0, grossAmount: 12_000_00, note: 'TV' });
    expect(summariseMonth(await all(), '2026-10').spent).toBe(0);
    expect(await bal(hdfc)).toBe(38_000_00);
    expect(
      findDuplicate(
        { kind: 'expense', amount: 12_000_00, date: '2026-10-05', accountId: hdfc.id },
        await all(),
      )?.txn.id,
    ).toBe(croma.id);
  });

  it('a double tap cannot lend twice', async () => {
    const share = [{ person: 'Priya', amount: 8_000_00 }];
    const r = await Promise.allSettled([
      paidForOthers(croma.id, share),
      paidForOthers(croma.id, share),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await parts()).toHaveLength(1);
    expect(await bal(hdfc)).toBe(38_000_00);
  });

  it('deleting the payment deletes friends’ parts; Undo brings all of it back', async () => {
    await paidForOthers(croma.id, [{ person: 'Priya', amount: 8_000_00 }]);
    await deleteTransaction(croma.id);
    expect(await bal(hdfc)).toBe(50_000_00);
    expect(await debts()).toHaveLength(0);
    await restoreTransaction(croma.id);
    expect(await bal(hdfc)).toBe(38_000_00);
    expect(await parts()).toHaveLength(1);
    expect((await debts()).map((d) => d.person)).toEqual(['Priya']);
  });

  it('removing one friend keeps the payment whole: their part is my spending again', async () => {
    await paidForOthers(croma.id, [
      { person: 'Asha', amount: 3_000_00 },
      { person: 'Ravi', amount: 3_000_00 },
    ]);
    const asha = (await parts()).find((p) => p.amount === 3_000_00)!;
    await deleteTransaction(asha.id);
    expect(await bal(hdfc)).toBe(38_000_00);
    expect(await db.transactions.get(croma.id)).toMatchObject({
      amount: 9_000_00,
      grossAmount: 12_000_00,
    });
    await restoreTransaction(asha.id);
    expect(await db.transactions.get(croma.id)).toMatchObject({
      amount: 6_000_00,
      grossAmount: 12_000_00,
    });
    expect(await bal(hdfc)).toBe(38_000_00);
  });

  it('editing the payment moves friends’ parts with it and keeps the total right', async () => {
    await paidForOthers(croma.id, [{ person: 'Priya', amount: 8_000_00 }]);
    const t = (await db.transactions.get(croma.id))!;
    // The editor shows ₹12,000 paid; you change it to ₹15,000 on ICICI a day earlier.
    await saveTransaction({ ...t, amount: 7_000_00, accountId: icici.id, date: '2026-10-04' });
    expect(await bal(hdfc)).toBe(50_000_00);
    expect(await bal(icici)).toBe(35_000_00);
    expect(await db.transactions.get(croma.id)).toMatchObject({ grossAmount: 15_000_00 });
    expect((await parts())[0]).toMatchObject({ accountId: icici.id, date: '2026-10-04' });
  });

  it('a split payment can’t change type while shared', async () => {
    await paidForOthers(croma.id, [{ person: 'Priya', amount: 8_000_00 }]);
    const t = (await db.transactions.get(croma.id))!;
    await expect(saveTransaction({ ...t, kind: 'income' })).rejects.toThrow(/Undo the split/);
  });

  it('undo split: the whole payment is my spending again and Priya disappears', async () => {
    await paidForOthers(croma.id, [{ person: 'Priya', amount: 8_000_00 }]);
    await unsplit(croma.id);
    const t = (await db.transactions.get(croma.id))!;
    expect(t.amount).toBe(12_000_00);
    expect(t.grossAmount).toBeUndefined();
    expect(await debts()).toHaveLength(0);
    expect(await bal(hdfc)).toBe(38_000_00);
  });

  it('refuses a payment split across categories', async () => {
    await db.transactions.update(croma.id, {
      splits: [
        { categoryId: 'shopping', amount: 10_000_00 },
        { categoryId: 'investments', amount: 2_000_00 },
      ],
    });
    await expect(paidForOthers(croma.id, [{ person: 'Priya', amount: 1_000_00 }])).rejects.toThrow(
      /categories/,
    );
  });
});

describe('Editing lent & borrowed entries', () => {
  it('a friend’s part: new amount comes out of my share; total and balance unchanged', async () => {
    await paidForOthers(croma.id, [{ person: 'Priya', amount: 8_000_00 }]);
    const p = (await parts())[0]!;
    await updateLoanEntry(p.id, {
      amount: 6_000_00,
      accountId: icici.id, // ignored: follows the payment
      date: '2026-01-01',
      person: 'Priya',
    });
    expect(await db.transactions.get(croma.id)).toMatchObject({
      amount: 6_000_00,
      grossAmount: 12_000_00,
    });
    expect(await db.transactions.get(p.id)).toMatchObject({
      amount: 6_000_00,
      accountId: hdfc.id,
      date: '2026-10-05',
    });
    expect(await bal(hdfc)).toBe(38_000_00);
    await expect(
      updateLoanEntry(p.id, {
        amount: 13_000_00,
        accountId: hdfc.id,
        date: '2026-10-05',
        person: 'Priya',
      }),
    ).rejects.toThrow(/left to give out/);
  });

  it('wrong person: moves the entry to the right person and drops the empty one', async () => {
    await paidForOthers(croma.id, [{ person: 'Ramesh', amount: 8_000_00 }]);
    const p = (await parts())[0]!;
    await updateLoanEntry(p.id, {
      amount: 8_000_00,
      accountId: hdfc.id,
      date: '2026-10-05',
      person: 'Ram',
    });
    expect((await debts()).map((d) => d.person)).toEqual(['Ram']);
  });

  it('a plain loan: change amount, account and date', async () => {
    const d = await startDebt({
      person: 'Asha',
      direction: 'lent',
      amount: 5_000_00,
      accountId: hdfc.id,
      date: '2026-10-01',
    });
    const t = (await live()).find((x) => x.debtId === d.id)!;
    await updateLoanEntry(t.id, {
      amount: 4_000_00,
      accountId: icici.id,
      date: '2026-10-02',
      time: '10:15',
      person: 'Asha',
    });
    expect(await bal(hdfc)).toBe(38_000_00); // only Croma left on HDFC
    expect(await bal(icici)).toBe(46_000_00);
    expect(debtBalance(d, await all()).outstanding).toBe(4_000_00);
  });

  it('a repayment can’t be edited to more than is owed', async () => {
    const d = await startDebt({
      person: 'Asha',
      direction: 'lent',
      amount: 5_000_00,
      accountId: hdfc.id,
      date: '2026-10-01',
    });
    const back = await saveTransaction({
      ...base,
      kind: 'debt',
      flow: 'in',
      debtId: d.id,
      date: '2026-10-03',
      amount: 2_000_00,
      accountId: hdfc.id,
    });
    await expect(
      updateLoanEntry(back.id, {
        amount: 6_000_00,
        accountId: hdfc.id,
        date: '2026-10-03',
        person: 'Asha',
      }),
    ).rejects.toThrow(/outstanding/);
  });

  it('not a loan: a captured "lent" goes back to spending', async () => {
    const d = await startDebt({
      person: 'Asha',
      direction: 'lent',
      amount: 5_000_00,
      accountId: hdfc.id,
      date: '2026-10-01',
    });
    const t = (await live()).find((x) => x.debtId === d.id)!;
    expect(await notALoan(t.id)).toBe('spending');
    expect(await db.transactions.get(t.id)).toMatchObject({ kind: 'expense', amount: 5_000_00 });
    expect(await debts()).toHaveLength(0);
  });
});

describe('U-27: a category choice fixes the payee’s past payments', () => {
  it('finds other payments at the same payee and moves them, with undo', async () => {
    const add = (date: string, categoryId: string, merchant = 'SWIGGY') =>
      saveTransaction(
        {
          ...base,
          kind: 'expense',
          date,
          amount: 300_00,
          accountId: hdfc.id,
          merchant,
          categoryId,
          source: 'sms',
        },
        { learn: false },
      );
    const a = await add('2026-09-01', 'other');
    const b = await add('2026-09-05', 'shopping');
    await add('2026-09-06', 'food'); // already right
    await add('2026-09-07', 'other', 'Zomato'); // another payee
    const others = samePayee(await all(), 'Swiggy', 'food', false);
    expect(others.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    const undo = await recategorise(others, 'food');
    expect((await db.transactions.get(a.id))?.categoryId).toBe('food');
    await undo();
    expect((await db.transactions.get(b.id))?.categoryId).toBe('shopping');
  });

  it('once: rules are applied to payments added from messages, not to typed ones', async () => {
    await saveTransaction(
      {
        ...base,
        kind: 'expense',
        date: '2026-09-01',
        amount: 100_00,
        accountId: hdfc.id,
        merchant: 'Swiggy',
        categoryId: 'other',
        source: 'sms',
      },
      { learn: false },
    );
    const typed = await saveTransaction(
      {
        ...base,
        kind: 'expense',
        date: '2026-09-02',
        amount: 100_00,
        accountId: hdfc.id,
        merchant: 'Swiggy',
        categoryId: 'shopping',
      },
      { learn: false },
    );
    await learnRule('Swiggy', 'food');
    expect(await applyRulesToPast()).toBe(1);
    expect((await db.transactions.get(typed.id))?.categoryId).toBe('shopping');
    expect(await applyRulesToPast()).toBe(0);
  });
});

describe('U-29: money from a person can be borrowed, and paid back later', () => {
  it('income → borrowed, a later payment → paid back; neither is income or spending', async () => {
    const got = await saveTransaction({
      ...base,
      kind: 'income',
      date: '2026-10-01',
      amount: 5_000_00,
      accountId: hdfc.id,
      merchant: 'Ravi',
      categoryId: 'salary',
    });
    await resolvePersonPayment(got.id, 'Ravi', 'borrowed');
    const back = await saveTransaction({
      ...base,
      kind: 'expense',
      date: '2026-10-06',
      amount: 5_000_00,
      accountId: hdfc.id,
      merchant: 'Ravi',
      categoryId: 'other',
    });
    await resolvePersonPayment(back.id, 'Ravi', 'repay_them');
    const txns = await all();
    const oct = summariseMonth(txns, '2026-10');
    expect(oct.income).toBe(0);
    expect(oct.spent).toBe(12_000_00); // only Croma
    const d = (await debts()).find((x) => x.person === 'Ravi')!;
    expect(d.direction).toBe('borrowed');
    expect(debtBalance(d, txns).outstanding).toBe(0);
  });
});
