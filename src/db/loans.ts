import { debtBalance } from '../domain/ledger';
import type { Debt, ID, Transaction } from '../domain/types';
import { newId, stamp } from './db';
import { parseSms } from '../domain/sms/parse';
import { todayIST } from '../domain/dates';
import { loanFlows, personKey, shouldAskLoan, type PersonAnswers } from './inbox';
import { db, getMeta, refreshDebtSettlement, setMeta } from './repo';

/**
 * Captured payments to or from people. The bank SMS is the one record of the money moving;
 * answering "Spent, lent or paid back?" changes what that same transaction is — it never adds a
 * second one, so nothing is counted twice.
 */

export type PersonChoice =
  | 'spent' // money out: a real expense (payee happens to be a person)
  | 'lent' // money out: a loan you expect back
  | 'repay_them' // money out: paying back what you borrowed
  | 'income' // money in: real income / gift
  | 'repaid_me' // money in: someone paying back what you lent
  | 'borrowed'; // money in: a loan you will repay

const same = (a: string, b: string) => personKey(a) === personKey(b);

/** Open (unsettled) debts with this person in one direction, newest first. */
export async function openDebtsWith(person: string, direction: Debt['direction']) {
  const [debts, txns] = await Promise.all([db.debts.toArray(), db.transactions.toArray()]);
  return debts
    .filter(
      (d) => !d.deletedAt && !d.settledAt && d.direction === direction && same(d.person, person),
    )
    .map((d) => ({ debt: d, ...debtBalance(d, txns) }))
    .filter((d) => d.outstanding > 0)
    .sort((a, b) => b.debt.createdAt.localeCompare(a.debt.createdAt));
}

/** What to offer first for this payment. */
export async function suggestedChoice(t: Transaction, person: string): Promise<PersonChoice> {
  const answers = await getMeta<PersonAnswers>('personAnswers', {});
  const remembered = answers[personKey(person)];
  if (t.kind === 'income' || t.kind === 'refund') {
    if ((await openDebtsWith(person, 'lent')).length) return 'repaid_me';
    if (remembered === 'borrowed') return 'borrowed';
    return 'income';
  }
  if ((await openDebtsWith(person, 'borrowed')).length) return 'repay_them';
  if (remembered === 'lent') return 'lent';
  return 'spent';
}

async function findOrStartDebt(person: string, direction: Debt['direction']): Promise<Debt> {
  const open = await openDebtsWith(person, direction);
  if (open[0]) return open[0].debt;
  const now = stamp();
  const debt: Debt = {
    id: newId(),
    person: person.trim(),
    direction,
    createdAt: now,
    updatedAt: now,
  };
  await db.debts.add(debt);
  return debt;
}

/** Answer the question for one captured transaction. */
export async function resolvePersonPayment(txnId: ID, person: string, choice: PersonChoice) {
  const t = await db.transactions.get(txnId);
  if (!t) throw new Error('Transaction not found.');
  const base = { ...t, askLoan: undefined, updatedAt: stamp() };
  let debtId: ID | undefined;
  if (choice === 'spent' || choice === 'income') {
    // false = answered, so a later review never asks about it again.
    await db.transactions.put({ ...base, askLoan: false });
  } else {
    const direction: Debt['direction'] =
      choice === 'lent' || choice === 'repaid_me' ? 'lent' : 'borrowed';
    const debt = await findOrStartDebt(person, direction);
    debtId = debt.id;
    const flow = choice === 'lent' || choice === 'repay_them' ? 'out' : 'in';
    const note =
      choice === 'lent'
        ? `Lent to ${debt.person}`
        : choice === 'borrowed'
          ? `Borrowed from ${debt.person}`
          : choice === 'repaid_me'
            ? `${debt.person} paid back`
            : `Paid back ${debt.person}`;
    await db.transactions.put({
      ...base,
      kind: 'debt',
      flow,
      debtId,
      categoryId: undefined,
      splits: undefined,
      note: t.note ?? note,
    });
    await refreshDebtSettlement(debtId);
  }
  // Remember the answer for this person: "spent" stops future questions for them.
  const answers = await getMeta<PersonAnswers>('personAnswers', {});
  const remember =
    choice === 'spent'
      ? 'spent'
      : choice === 'lent'
        ? 'lent'
        : choice === 'borrowed'
          ? 'borrowed'
          : undefined;
  if (remember) await setMeta('personAnswers', { ...answers, [personKey(person)]: remember });
  return debtId;
}

/**
 * Paid for other people (U-21): a dinner, tickets, a group order. Each person's part becomes money
 * lent to them; your own part (if any) stays spending. The payment that left your account keeps
 * its full amount on the account and card bill — only what counts as *your* spending changes.
 *   Croma ₹12,000 = you ₹4,000 + Priya ₹8,000  → expense ₹4,000 (of ₹12,000) + lent ₹8,000.
 *   Tickets ₹3,000 for Asha and Ravi, nothing for you → two loans of ₹1,500, no spending.
 */
export async function paidForOthers(
  txnId: ID,
  shares: { person: string; amount: number }[],
): Promise<void> {
  const t = await db.transactions.get(txnId);
  if (!t) throw new Error('Transaction not found.');
  if (t.kind !== 'expense') throw new Error('Only a payment you made can be split.');
  if (t.grossAmount) throw new Error('This payment is already shared with others.');
  const clean = shares.map((x) => ({ person: x.person.trim(), amount: Math.round(x.amount) }));
  if (!clean.length) throw new Error('Add at least one person.');
  if (clean.some((x) => !x.person || x.amount <= 0))
    throw new Error('Each person needs a name and an amount.');
  const keys = clean.map((x) => personKey(x.person));
  if (new Set(keys).size !== keys.length) throw new Error('Each person only once.');
  const lent = clean.reduce((n, x) => n + x.amount, 0);
  if (lent > t.amount) throw new Error('The parts add up to more than you paid.');
  const mine = t.amount - lent;
  const now = stamp();
  const debtRow = async (person: string, amount: number) => {
    const debt = await findOrStartDebt(person, 'lent');
    return {
      debt,
      row: {
        kind: 'debt' as const,
        flow: 'out' as const,
        debtId: debt.id,
        date: t.date,
        time: t.time,
        amount,
        accountId: t.accountId,
        paymentMode: t.paymentMode,
        splitOf: t.id,
        note: `Lent to ${debt.person} · paid for them${t.merchant ? ` at ${t.merchant}` : ''}`,
        tags: [],
        source: t.source,
        status: 'confirmed' as const,
        createdAt: now,
        updatedAt: now,
      },
    };
  };
  const touched: ID[] = [];
  let rest = clean;
  if (mine > 0) {
    // Your share stays the spending row; the full amount is kept for display.
    await db.transactions.put({
      ...t,
      amount: mine,
      grossAmount: t.amount,
      splits: undefined,
      askLoan: false,
      updatedAt: now,
    });
  } else {
    // Nothing was yours: the payment itself becomes the first person's loan.
    const [first, ...others] = clean;
    const { debt, row } = await debtRow(first!.person, first!.amount);
    await db.transactions.put({
      ...t,
      ...row,
      id: t.id,
      createdAt: t.createdAt,
      merchant: t.merchant,
      rawText: t.rawText,
      externalRef: t.externalRef,
      splitOf: undefined,
      grossAmount: others.length ? t.amount : undefined,
      categoryId: undefined,
      splits: undefined,
      askLoan: undefined,
    });
    touched.push(debt.id);
    rest = others;
  }
  for (const x of rest) {
    const { debt, row } = await debtRow(x.person, x.amount);
    await db.transactions.add({ id: newId(), ...row });
    touched.push(debt.id);
  }
  for (const id of new Set(touched)) await refreshDebtSettlement(id);
}

/** Older name: friends' shares of a payment where part was yours. */
export async function splitWithFriends(
  txnId: ID,
  shares: { person: string; amount: number }[],
): Promise<void> {
  const t = await db.transactions.get(txnId);
  if (!t) throw new Error('Transaction not found.');
  if (shares.reduce((s, x) => s + x.amount, 0) >= t.amount)
    throw new Error('Friends’ shares must be less than the total.');
  return paidForOthers(txnId, shares);
}

/** Equal parts in paise; the odd paise go to the first people so the parts add up exactly. */
export function equalParts(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Everything waiting for one person was ordinary spending/income: answer them all at once. */
export async function allSpentFor(person: string): Promise<number> {
  const txns = (await db.transactions.toArray()).filter(
    (t) => t.askLoan && !t.deletedAt && t.merchant && personKey(t.merchant) === personKey(person),
  );
  for (const t of txns)
    await resolvePersonPayment(t.id, person, t.kind === 'income' ? 'income' : 'spent');
  return txns.length;
}

/**
 * Re-check every unanswered question with the current rules (contacts, recent, ₹500+ or two-way).
 * Runs on start and when contacts load, so older versions' long lists shrink on their own.
 */
export async function reviewLoanQuestions(): Promise<{ asked: number; cleared: number }> {
  const all = await db.transactions.toArray();
  const answers = await getMeta<PersonAnswers>('personAnswers', {});
  const flows = loanFlows(all.filter((t) => !t.deletedAt));
  const today = todayIST();
  let asked = 0;
  let cleared = 0;
  for (const t of all) {
    if (t.deletedAt || t.askLoan === false) continue;
    if (t.source !== 'sms' && t.source !== 'notification') continue;
    if (t.kind !== 'expense' && t.kind !== 'income') {
      if (t.askLoan) {
        await db.transactions.update(t.id, { askLoan: undefined });
        cleared++;
      }
      continue;
    }
    const vpa = t.rawText ? parseSms(t.rawText).vpa : undefined;
    const ask = shouldAskLoan(t, vpa, today, answers, flows);
    if (ask && !t.askLoan) {
      await db.transactions.update(t.id, { askLoan: true });
      asked++;
    } else if (!ask && t.askLoan) {
      await db.transactions.update(t.id, { askLoan: undefined });
      cleared++;
    }
  }
  return { asked, cleared };
}
