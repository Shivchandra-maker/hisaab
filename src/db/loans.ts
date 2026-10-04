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
 * Split one captured payment: your share stays spending, the rest is lent to friends
 * (e.g. dinner ₹1,200: ₹400 mine, ₹400 each lent to two friends).
 */
export async function splitWithFriends(
  txnId: ID,
  shares: { person: string; amount: number }[],
): Promise<void> {
  const t = await db.transactions.get(txnId);
  if (!t) throw new Error('Transaction not found.');
  const lent = shares.reduce((s, x) => s + x.amount, 0);
  if (shares.some((x) => x.amount <= 0 || !x.person.trim()))
    throw new Error('Each friend needs a name and an amount.');
  if (lent >= t.amount) throw new Error('Friends’ shares must be less than the total.');
  const now = stamp();
  await db.transactions.put({ ...t, amount: t.amount - lent, askLoan: undefined, updatedAt: now });
  for (const x of shares) {
    const debt = await findOrStartDebt(x.person, 'lent');
    await db.transactions.add({
      id: newId(),
      kind: 'debt',
      flow: 'out',
      debtId: debt.id,
      date: t.date,
      amount: x.amount,
      accountId: t.accountId,
      paymentMode: t.paymentMode,
      note: `Lent to ${debt.person} (split of ${t.merchant ?? 'a payment'})`,
      tags: [],
      source: t.source,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    });
    await refreshDebtSettlement(debt.id);
  }
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
