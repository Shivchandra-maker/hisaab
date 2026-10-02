import { addDays, addMonthsYM, daysInMonth, parseDate, parseMonth, ym, ymd } from './dates';
import type { CardDetails, ISODate, MonthKey } from './types';

/**
 * Credit-card statement periods.
 *
 * A card with statementDay = 15 has periods 16 Aug – 15 Sep, 16 Sep – 15 Oct, …
 * A period is identified by the month its statement closes in (`closesIn`).
 * A statement day past the month's end is clamped (31 → 30 Apr, 28/29 Feb).
 * `statementOverrides` lets the user record a date the bank moved.
 */

export interface StatementPeriod {
  /** Month the statement is generated in, e.g. '2026-09'. */
  closesIn: MonthKey;
  /** First day of spending included. */
  start: ISODate;
  /** Statement date: last day of spending included. */
  end: ISODate;
  /** Payment due date. */
  due: ISODate;
}

type CardCycleConfig = Pick<
  CardDetails,
  'statementDay' | 'dueDaysAfterStatement' | 'statementOverrides'
>;

/** The statement date for a card in a given month. */
export function statementDateIn(card: CardCycleConfig, y: number, m: number): ISODate {
  const override = card.statementOverrides?.[ym(y, m)];
  if (override) return override;
  return ymd(y, m, Math.min(Math.max(card.statementDay, 1), daysInMonth(y, m)));
}

/** The statement period that closes in the given month. */
export function periodClosingIn(card: CardCycleConfig, month: MonthKey): StatementPeriod {
  const [y, m] = parseMonth(month);
  const end = statementDateIn(card, y, m);
  const prevEnd = statementDateIn(card, ...addMonthsYM(y, m, -1));
  return {
    closesIn: month,
    start: addDays(prevEnd, 1),
    end,
    due: addDays(end, card.dueDaysAfterStatement),
  };
}

/** The statement period a spend on `date` belongs to. */
export function periodContaining(card: CardCycleConfig, date: ISODate): StatementPeriod {
  const [y, m] = parseDate(date);
  // Candidate: the statement closing this calendar month. If the date is after it, it's next month's.
  const thisMonth = periodClosingIn(card, ym(y, m));
  if (date > thisMonth.end) return periodClosingIn(card, ym(...addMonthsYM(y, m, 1)));
  if (date < thisMonth.start) return periodClosingIn(card, ym(...addMonthsYM(y, m, -1)));
  return thisMonth;
}

/** `count` consecutive periods ending with the one containing `date`, newest first. */
export function recentPeriods(
  card: CardCycleConfig,
  date: ISODate,
  count: number,
): StatementPeriod[] {
  const current = periodContaining(card, date);
  const [y, m] = parseMonth(current.closesIn);
  return Array.from({ length: count }, (_, i) =>
    periodClosingIn(card, ym(...addMonthsYM(y, m, -i))),
  );
}
