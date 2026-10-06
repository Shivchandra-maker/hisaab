import type { ISODate, MonthKey } from './types';

/**
 * Calendar-date helpers. All dates are plain 'YYYY-MM-DD' strings in IST, so string comparison
 * (`a < b`) orders them correctly and no time-zone maths leaks into reports.
 */

export const IST = 'Asia/Kolkata';

const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;
export const ym = (y: number, m: number): MonthKey => `${y}-${pad(m)}`;

export function parseDate(s: ISODate): [y: number, m: number, d: number] {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Bad date: ${s}`);
  return [y, m, d];
}

export function parseMonth(k: MonthKey): [y: number, m: number] {
  const [y, m] = k.split('-').map(Number);
  if (!y || !m) throw new Error(`Bad month: ${k}`);
  return [y, m];
}

/** Today's date in IST, regardless of the device's time zone. */
export function todayIST(now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Clock time in IST as "HH:mm" (24h, for storing). */
export function timeIST(now: Date | number = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(typeof now === 'number' ? new Date(now) : now);
}

/** "21:05" → "9:05 pm". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export const daysInMonth = (y: number, m: number): number =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(s: ISODate, n: number): ISODate {
  const [y, m, d] = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonthsYM(y: number, m: number, n: number): [number, number] {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const [y, m] = parseMonth(k);
  return ym(...addMonthsYM(y, m, n));
}

export const monthOf = (s: ISODate): MonthKey => s.slice(0, 7);

export function monthRange(k: MonthKey): { start: ISODate; end: ISODate } {
  const [y, m] = parseMonth(k);
  return { start: ymd(y, m, 1), end: ymd(y, m, daysInMonth(y, m)) };
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = parseDate(a);
  const [by, bm, bd] = parseDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export const inRange = (d: ISODate, start: ISODate, end: ISODate): boolean =>
  d >= start && d <= end;

export function formatDate(s: ISODate, style: 'short' | 'long' | 'weekday' = 'short'): string {
  const [y, m, d] = parseDate(s);
  const date = new Date(y, m - 1, d);
  if (style === 'long')
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (style === 'weekday')
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatMonth(k: MonthKey, style: 'long' | 'short' = 'long'): string {
  const [y, m] = parseMonth(k);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
    month: style === 'long' ? 'long' : 'short',
    year: style === 'long' ? 'numeric' : undefined,
  });
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${s}`;
}

/** "Today", "Tomorrow", "Yesterday", "in 5 days", "3 days ago" — for due dates and recent items. */
export function relativeDay(today: ISODate, d: ISODate): string {
  const n = daysBetween(today, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
