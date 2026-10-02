import { addDays, addMonths, daysBetween, inRange, monthOf, monthRange } from './dates';
import { periodClosingIn, periodContaining, type StatementPeriod } from './cycle';
import type { Account, Debt, ID, ISODate, MonthKey, Paise, Transaction } from './types';
import { isLiability } from './types';

/**
 * Ledger maths. Pure functions over plain arrays so they are easy to test and reuse on the
 * server later. "Double-entry-lite": every transaction moves money out of or into accounts,
 * and only expenses/refunds/income touch categories. Transfers touch two accounts and nothing else.
 */

/** Transactions that count: not deleted, not waiting in the Review inbox. */
export const counted = (t: Transaction): boolean => !t.deletedAt && t.status === 'confirmed';

/**
 * How a transaction changes an account, seen as an asset (money you have).
 * For a credit card the amount owed moves the opposite way.
 */
export function assetDelta(t: Transaction, accountId: ID): Paise {
  let d = 0;
  if (t.accountId === accountId) {
    if (t.kind === 'adjustment' || t.kind === 'debt') d += t.flow === 'in' ? t.amount : -t.amount;
    else d += t.kind === 'income' || t.kind === 'refund' ? t.amount : -t.amount;
  }
  if (t.kind === 'transfer' && t.toAccountId === accountId) d += t.amount;
  return d;
}

/**
 * Account balance at the end of `asOf` (inclusive).
 * Asset accounts: money available. Credit cards: amount owed (positive = you owe).
 */
export function balanceOf(account: Account, txns: Transaction[], asOf?: ISODate): Paise {
  let delta = 0;
  for (const t of txns) {
    if (!counted(t) || t.date < account.openingDate) continue;
    if (asOf && t.date > asOf) continue;
    delta += assetDelta(t, account.id);
  }
  return isLiability(account.kind)
    ? account.openingBalance - delta
    : account.openingBalance + delta;
}

/** Category amounts of an expense/refund/income, honouring splits. */
export function categoryParts(t: Transaction): { categoryId: ID | undefined; amount: Paise }[] {
  if (t.splits?.length)
    return t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }));
  return [{ categoryId: t.categoryId, amount: t.amount }];
}

/** Signed effect on spending: expense adds, refund subtracts, everything else is 0. */
export const spendEffect = (t: Transaction): Paise =>
  t.kind === 'expense' ? t.amount : t.kind === 'refund' ? -t.amount : 0;

export interface PeriodSummary {
  /** Expenses minus refunds. The answer to "how much did I spend?" */
  spent: Paise;
  expenses: Paise;
  refunds: Paise;
  income: Paise;
  /** income − spent */
  net: Paise;
  byCategory: Map<ID | 'uncategorised', Paise>;
  byAccount: Map<ID, Paise>;
  count: number;
}

/** Spending summary for any date range, by actual transaction date. Transfers are excluded. */
export function summarise(txns: Transaction[], start: ISODate, end: ISODate): PeriodSummary {
  const s: PeriodSummary = {
    spent: 0,
    expenses: 0,
    refunds: 0,
    income: 0,
    net: 0,
    byCategory: new Map(),
    byAccount: new Map(),
    count: 0,
  };
  for (const t of txns) {
    if (!counted(t) || !inRange(t.date, start, end)) continue;
    if (t.kind !== 'expense' && t.kind !== 'refund' && t.kind !== 'income') continue;
    s.count++;
    if (t.kind === 'income') {
      s.income += t.amount;
      continue;
    }
    const sign = t.kind === 'expense' ? 1 : -1;
    if (sign > 0) s.expenses += t.amount;
    else s.refunds += t.amount;
    for (const p of categoryParts(t)) {
      const key = p.categoryId ?? 'uncategorised';
      s.byCategory.set(key, (s.byCategory.get(key) ?? 0) + sign * p.amount);
    }
    s.byAccount.set(t.accountId, (s.byAccount.get(t.accountId) ?? 0) + sign * t.amount);
  }
  s.spent = s.expenses - s.refunds;
  s.net = s.income - s.spent;
  return s;
}

export function summariseMonth(txns: Transaction[], month: MonthKey): PeriodSummary {
  const { start, end } = monthRange(month);
  return summarise(txns, start, end);
}

/** Spending per day of a month (index 0 = 1st). */
export function dailySpend(txns: Transaction[], month: MonthKey): Paise[] {
  const { end } = monthRange(month);
  const days = Number(end.slice(8));
  const out = new Array<Paise>(days).fill(0);
  for (const t of txns) {
    if (!counted(t) || monthOf(t.date) !== month) continue;
    const i = Number(t.date.slice(8)) - 1;
    out[i] = (out[i] ?? 0) + spendEffect(t);
  }
  return out;
}

/* ───────────────────────── Credit cards ───────────────────────── */

export type StatementStatus = 'open' | 'paid' | 'due' | 'overdue';

export interface Statement {
  period: StatementPeriod;
  /** Purchases, fees and cash withdrawals in the period. */
  charges: Paise;
  /** Refunds and cashback in the period. */
  credits: Paise;
  /** Payments made inside the period (reduce the closing balance). */
  paymentsInPeriod: Paise;
  /** Amount owed on the statement date, including anything unpaid from before. */
  totalDue: Paise;
  /** Payments received after the statement date, up to the next statement. */
  paidAfter: Paise;
  /** What is still left to pay on this statement. */
  remaining: Paise;
  status: StatementStatus;
}

function cardFlows(card: Account, txns: Transaction[], start: ISODate, end: ISODate) {
  let charges = 0;
  let credits = 0;
  let payments = 0;
  for (const t of txns) {
    if (!counted(t) || !inRange(t.date, start, end)) continue;
    if (t.accountId === card.id) {
      const out = assetDelta(t, card.id) < 0;
      if (out)
        charges += t.amount; // purchases, cash withdrawals, fees
      else credits += t.amount; // refunds, cashback, adjustments in
    } else if (t.kind === 'transfer' && t.toAccountId === card.id) {
      payments += t.amount;
    }
  }
  return { charges, credits, payments };
}

export function statementFor(
  card: Account,
  txns: Transaction[],
  period: StatementPeriod,
  today: ISODate,
): Statement {
  if (!card.card) throw new Error(`${card.name} is not a credit card`);
  const flows = cardFlows(card, txns, period.start, period.end);
  const totalDue = Math.max(0, balanceOf(card, txns, period.end));
  const next = periodClosingIn(card.card, addMonths(period.closesIn, 1));
  const paidAfter = cardFlows(card, txns, addDays(period.end, 1), next.end).payments;
  const remaining = Math.max(0, totalDue - paidAfter);
  let status: StatementStatus;
  if (today <= period.end) status = 'open';
  else if (remaining === 0) status = 'paid';
  else if (today > period.due) status = 'overdue';
  else status = 'due';
  return {
    period,
    charges: flows.charges,
    credits: flows.credits,
    paymentsInPeriod: flows.payments,
    totalDue,
    paidAfter: today <= period.end ? 0 : paidAfter,
    remaining: today <= period.end ? 0 : remaining,
    status,
  };
}

export interface CardSnapshot {
  /** Everything owed right now. */
  owed: Paise;
  /** Left to pay on the last generated statement. */
  dueNow: Paise;
  dueDate?: ISODate;
  dueStatus: StatementStatus;
  daysToDue?: number;
  /** Spending in the current (open) period, not yet on a statement. */
  unbilled: Paise;
  currentPeriod: StatementPeriod;
  lastStatement: Statement;
  available: Paise;
  /** owed / limit, 0–1+ */
  utilisation: number;
}

/**
 * The three numbers people need for a card (after Money Manager):
 * due now (last statement), unbilled (current period) and total owed.
 */
export function cardSnapshot(card: Account, txns: Transaction[], today: ISODate): CardSnapshot {
  if (!card.card) throw new Error(`${card.name} is not a credit card`);
  const currentPeriod = periodContaining(card.card, today);
  const lastPeriod = periodClosingIn(card.card, addMonths(currentPeriod.closesIn, -1));
  const lastStatement = statementFor(card, txns, lastPeriod, today);
  const owed = balanceOf(card, txns, today);
  const f = cardFlows(card, txns, currentPeriod.start, today);
  const limit = card.card.creditLimit;
  return {
    owed,
    dueNow: lastStatement.remaining,
    dueDate: lastStatement.remaining > 0 ? lastPeriod.due : undefined,
    dueStatus: lastStatement.status,
    daysToDue: lastStatement.remaining > 0 ? daysBetween(today, lastPeriod.due) : undefined,
    unbilled: f.charges - f.credits,
    currentPeriod,
    lastStatement,
    available: Math.max(0, limit - owed),
    utilisation: limit > 0 ? owed / limit : 0,
  };
}

export interface CalendarVsStatement {
  cardId: ID;
  /** Card spending dated in this calendar month. */
  spentThisMonth: Paise;
  /** …of which lands on the statement that closes this month. */
  onThisMonthsStatement: Paise;
  /** …of which rolls into next month's statement. */
  onNextStatement: Paise;
  /** The statement that closes this month, and where its spending came from. */
  closingPeriod: StatementPeriod;
  closingStatementSpend: Paise;
  fromPreviousMonth: Paise;
  fromThisMonth: Paise;
}

/**
 * The core Hisaab view: for one card, how this calendar month's spending maps onto statements,
 * and how the statement closing this month is made up of two calendar months.
 */
export function calendarVsStatement(
  card: Account,
  txns: Transaction[],
  month: MonthKey,
): CalendarVsStatement {
  if (!card.card) throw new Error(`${card.name} is not a credit card`);
  const closingPeriod = periodClosingIn(card.card, month);
  let spentThisMonth = 0;
  let onThis = 0;
  let closingSpend = 0;
  let fromPrev = 0;
  for (const t of txns) {
    if (!counted(t) || t.accountId !== card.id) continue;
    const e = spendEffect(t);
    if (e === 0) continue;
    if (monthOf(t.date) === month) {
      spentThisMonth += e;
      if (t.date <= closingPeriod.end) onThis += e;
    }
    if (inRange(t.date, closingPeriod.start, closingPeriod.end)) {
      closingSpend += e;
      if (monthOf(t.date) < month) fromPrev += e;
    }
  }
  return {
    cardId: card.id,
    spentThisMonth,
    onThisMonthsStatement: onThis,
    onNextStatement: spentThisMonth - onThis,
    closingPeriod,
    closingStatementSpend: closingSpend,
    fromPreviousMonth: fromPrev,
    fromThisMonth: closingSpend - fromPrev,
  };
}

/** Bill reserve (after YNAB): how much of the money you have is already owed to cards. */
export function billReserve(accounts: Account[], txns: Transaction[], today: ISODate) {
  let cash = 0;
  let owedToCards = 0;
  for (const a of accounts) {
    if (a.archived || a.deletedAt) continue;
    const b = balanceOf(a, txns, today);
    if (isLiability(a.kind)) owedToCards += Math.max(0, b);
    else cash += b;
  }
  return { cash, owedToCards, freeToSpend: cash - owedToCards };
}

/* ───────────────────────── Money lent & borrowed ───────────────────────── */

export interface DebtBalance {
  /** Total lent (or borrowed). */
  principal: Paise;
  /** Total repaid so far. */
  repaid: Paise;
  /** Still to come back (lent) or still to pay (borrowed). */
  outstanding: Paise;
  lastDate?: ISODate;
}

export function debtBalance(debt: Debt, txns: Transaction[]): DebtBalance {
  // For "lent", money going out is the loan and money coming in is repayment. Reverse for "borrowed".
  const loanFlow = debt.direction === 'lent' ? 'out' : 'in';
  let principal = 0;
  let repaid = 0;
  let lastDate: ISODate | undefined;
  for (const t of txns) {
    if (!counted(t) || t.kind !== 'debt' || t.debtId !== debt.id) continue;
    if (t.flow === loanFlow) principal += t.amount;
    else repaid += t.amount;
    if (!lastDate || t.date > lastDate) lastDate = t.date;
  }
  return { principal, repaid, outstanding: principal - repaid, lastDate };
}
