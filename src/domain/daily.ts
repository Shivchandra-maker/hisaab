import type { Paise } from './types';

/**
 * Day-to-day view of a month (D-13). One big payment — rent, an SIP, a phone — shouldn't flatten
 * every other day on the chart or turn "average day" into a number nobody spends.
 */
export interface DailyStats {
  /** Days counted (all days of an earlier month; days so far in the current one). */
  days: number;
  /** Indexes of days far above the rest (more than 5× the median spending day, and ≥ ₹5,000). */
  outliers: number[];
  /** Average spend of the other days — what a normal day costs. 0 when nothing was spent. */
  typical: Paise;
  /** Top of the chart scale: the highest normal day (outliers are drawn cut off above it). */
  scaleTop: Paise;
}

const MIN_OUTLIER: Paise = 500_000; // ₹5,000

export function dailyStats(daily: Paise[], daysSoFar = daily.length): DailyStats {
  const days = Math.max(0, Math.min(daysSoFar, daily.length));
  const seen = daily.slice(0, days).map((v) => Math.max(0, v));
  const spending = seen.filter((v) => v > 0).sort((a, b) => a - b);
  if (!spending.length) return { days, outliers: [], typical: 0, scaleTop: 0 };
  const mid = Math.floor(spending.length / 2);
  const median =
    spending.length % 2 ? spending[mid]! : Math.round((spending[mid - 1]! + spending[mid]!) / 2);
  // Need a few spending days before calling anything unusual.
  const outliers =
    spending.length >= 3
      ? seen.flatMap((v, i) => (v >= MIN_OUTLIER && v > median * 5 ? [i] : []))
      : [];
  const normal = seen.filter((_, i) => !outliers.includes(i));
  const total = normal.reduce((a, b) => a + b, 0);
  const typical = normal.length ? Math.round(total / normal.length / 100) * 100 : 0;
  const scaleTop = normal.length ? Math.max(...normal, typical) : Math.max(...seen);
  return { days, outliers, typical, scaleTop };
}

/** "about a typical day" / "₹1,240 more than a typical day" — words, not "0.2×". */
export function vsTypical(spent: Paise, typical: Paise): 'about' | 'more' | 'less' {
  if (typical <= 0) return 'about';
  const diff = spent - typical;
  if (Math.abs(diff) <= Math.max(typical * 0.15, 5_000)) return 'about';
  return diff > 0 ? 'more' : 'less';
}
