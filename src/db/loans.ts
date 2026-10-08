import { debtBalance } from '../domain/ledger';
import type { Debt, ID, ISODate, Paise, Transaction } from '../domain/types';
import { formatINR } from '../domain/money';
import { newId, stamp } from './db';
import { parseSms } from '../domain/sms/parse';
import { todayIST } from '../domain/dates';
import { loanFlows, personKey, shouldAskLoan, type PersonAnswers } from './inbox';
import {
  db,
  deleteTransaction,
  dropEmptyDebts,
  getMeta,
  refreshDebtSettlement,
  setMeta,
  splitPartsOf,
  validateTransaction,
  ValidationError,
} from './repo';

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
 * lent to them; your own part (if any) stays spending. The payment itself stays one row with the
 * full amount in `grossAmount`, so the account, card bill and duplicate checks still see what the
 * bank saw; only what counts as *your* spending changes.
 *   Croma ₹12,000 = you ₹4,000 + Priya ₹8,000  → expense ₹4,000 (of ₹12,000) + lent ₹8,000.
 *   Tickets ₹3,000 for Asha and Ravi, nothing for you → expense ₹0 (of ₹3,000) + two loans of ₹1,500.
 */
export async function paidForOthers(
  txnId: ID,
  shares: { person: string; amount: number }[],
): Promise<void> {
  const clean = shares.map((x) => ({ person: x.person.trim(), amount: Math.round(x.amount) }));
  if (!clean.length) throw new Error('Add at least one person.');
  if (clean.some((x) => !x.person || x.amount <= 0))
    throw new Error('Each person needs a name and an amount.');
  const keys = clean.map((x) => personKey(x.person));
  if (new Set(keys).size !== keys.length) throw new Error('Each person only once.');
  const touched: ID[] = [];
  // One database transaction: a double tap can't lend twice.
  await db.transaction('rw', db.transactions, db.debts, async () => {
    const t = await db.transactions.get(txnId);
    if (!t || t.deletedAt) throw new Error('Transaction not found.');
    if (t.kind !== 'expense') throw new Error('Only a payment you made can be split.');
    if (t.grossAmount) throw new Error('This payment is already shared with others.');
    if ((t.splits?.length ?? 0) > 1)
      throw new Error('This payment is split across categories. Remove that split first.');
    const lent = clean.reduce((n, x) => n + x.amount, 0);
    if (lent > t.amount) throw new Error('The parts add up to more than you paid.');
    const now = stamp();
    await db.transactions.put({
      ...t,
      amount: t.amount - lent,
      grossAmount: t.amount,
      splits: undefined,
      askLoan: false,
      updatedAt: now,
    });
    for (const x of clean) {
      const debt = await findOrStartDebt(x.person, 'lent');
      await db.transactions.add({
        id: newId(),
        kind: 'debt',
        flow: 'out',
        debtId: debt.id,
        date: t.date,
        time: t.time,
        amount: x.amount,
        accountId: t.accountId,
        paymentMode: t.paymentMode,
        splitOf: t.id,
        note: `Lent to ${debt.person} · paid for them${t.merchant ? ` at ${t.merchant}` : ''}`,
        tags: [],
        source: t.source,
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
      });
      touched.push(debt.id);
    }
  });
  for (const id of new Set(touched)) await refreshDebtSettlement(id);
}

/** Undo "paid for others": the whole payment is your spending again; friends' parts go. */
export async function unsplit(txnId: ID): Promise<void> {
  const parts = await splitPartsOf(txnId);
  for (const x of parts) await deleteTransaction(x.id);
  await dropEmptyDebts(parts.map((x) => x.debtId));
}

/**
 * Change a lent / borrowed / paid-back entry: amount, account, date, time, note, or the person.
 * A friend's part of a shared payment only changes its amount, person and note — its account and
 * date follow the payment, and the difference moves to (or from) your own share.
 */
export async function updateLoanEntry(
  id: ID,
  patch: {
    amount: Paise;
    accountId: ID;
    date: ISODate;
    time?: string;
    note?: string;
    person: string;
  },
): Promise<void> {
  const t = await db.transactions.get(id);
  if (!t || t.kind !== 'debt' || t.deletedAt) throw new ValidationError('Entry not found.');
  const debt = t.debtId ? await db.debts.get(t.debtId) : undefined;
  if (!debt) throw new ValidationError('Entry not found.');
  const person = patch.person.trim();
  if (!person) throw new ValidationError('Enter the person’s name.');
  if (!Number.isInteger(patch.amount) || patch.amount <= 0)
    throw new ValidationError('Enter an amount above ₹0.');
  const parent = t.splitOf ? await db.transactions.get(t.splitOf) : undefined;
  const delta = patch.amount - t.amount;
  if (parent && !parent.deletedAt && delta > parent.amount)
    throw new ValidationError(
      `Only ${formatINR(parent.amount)} of that payment is left to give out.`,
    );

  // Same person → same record; another person → their open record (or a new one).
  let debtId = debt.id;
  if (personKey(person) !== personKey(debt.person)) {
    debtId = (await findOrStartDebt(person, debt.direction)).id;
  } else if (person !== debt.person) {
    await db.debts.update(debt.id, { person, updatedAt: stamp() });
  }
  const next: Transaction = {
    ...t,
    debtId,
    amount: patch.amount,
    note: patch.note?.trim() || t.note,
    updatedAt: stamp(),
    ...(parent ? {} : { accountId: patch.accountId, date: patch.date, time: patch.time }),
  };
  if (!parent && !next.time) delete next.time;
  await validateTransaction(next);
  // Paid back more than is owed? Lending more never is.
  const isRepayment = (t.flow === 'in') === (debt.direction === 'lent');
  if (isRepayment) {
    const target = await db.debts.get(debtId);
    const others = (await db.transactions.toArray()).filter((x) => x.id !== id);
    const { outstanding } = debtBalance(target!, others);
    if (patch.amount > outstanding)
      throw new ValidationError(`That’s more than the ${formatINR(outstanding)} outstanding.`);
  }
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions.put(next);
    if (parent && !parent.deletedAt && delta) {
      const parts = (await splitPartsOf(parent.id)).reduce((n, x) => n + x.amount, 0);
      await db.transactions.put({
        ...parent,
        amount: parent.amount - delta,
        grossAmount: parent.amount - delta + parts,
        updatedAt: stamp(),
      });
    }
  });
  await refreshDebtSettlement(debt.id);
  if (debtId !== debt.id) await refreshDebtSettlement(debtId);
  await dropEmptyDebts([debt.id]);
}

/**
 * "Not a loan": a payment answered as lent / borrowed / paid back by mistake becomes ordinary
 * spending or income again. A friend's part of a shared payment goes back into your share.
 */
export async function notALoan(id: ID): Promise<'spending' | 'income'> {
  const t = await db.transactions.get(id);
  if (!t || t.kind !== 'debt') throw new ValidationError('Entry not found.');
  if (t.splitOf) {
    await deleteTransaction(id);
    await dropEmptyDebts([t.debtId]);
    return 'spending';
  }
  const kind = t.flow === 'in' ? 'income' : 'expense';
  const back: Transaction = { ...t, kind, askLoan: false, updatedAt: stamp() };
  delete back.debtId;
  delete back.flow;
  await db.transactions.put(back);
  await refreshDebtSettlement(t.debtId);
  await dropEmptyDebts([t.debtId]);
  return kind === 'income' ? 'income' : 'spending';
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
