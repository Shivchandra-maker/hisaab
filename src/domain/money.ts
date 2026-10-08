import type { Paise } from './types';

/** Convert a rupee amount typed by the user ("1,250.50", 1250.5) to integer paise. */
export function toPaise(rupees: string | number): Paise {
  const n = typeof rupees === 'number' ? rupees : Number(rupees.replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(n)) throw new Error(`Not an amount: ${rupees}`);
  return Math.round(n * 100);
}

/** For half-typed input ("", ".", "1,"): anything that isn't an amount yet counts as ₹0. */
export function safePaise(rupees: string): Paise {
  try {
    return Math.max(0, toPaise(rupees || '0'));
  } catch {
    return 0;
  }
}

export const toRupees = (p: Paise): number => p / 100;

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const groupedFixed = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format paise as Indian rupees with lakh grouping: 125000000 → "₹12,50,000".
 * Paise are shown only when non-zero (or when `paise: 'always'`).
 */
export function formatINR(
  p: Paise,
  opts: { sign?: 'auto' | 'always' | 'never'; paise?: 'auto' | 'always' } = {},
): string {
  const { sign = 'auto', paise = 'auto' } = opts;
  const abs = Math.abs(p);
  const showPaise = paise === 'always' || abs % 100 !== 0;
  const body = (showPaise ? groupedFixed : grouped).format(
    showPaise ? abs / 100 : Math.round(abs / 100),
  );
  const prefix = p < 0 && sign !== 'never' ? '−' : p > 0 && sign === 'always' ? '+' : '';
  return `${prefix}₹${body}`;
}

/** Short form for charts and tight spaces: ₹950, ₹12.5k, ₹3.4L, ₹1.2Cr. */
export function formatINRCompact(p: Paise): string {
  const r = Math.abs(p) / 100;
  const sign = p < 0 ? '−' : '';
  const trim = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, ''));
  if (r >= 1e7) return `${sign}₹${trim(r / 1e7)}Cr`;
  if (r >= 1e5) return `${sign}₹${trim(r / 1e5)}L`;
  if (r >= 1e3) return `${sign}₹${trim(r / 1e3)}k`;
  return `${sign}₹${Math.round(r)}`;
}

export const sumPaise = (xs: Iterable<Paise>): Paise => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};

/**
 * Clean what the user types into an amount box: digits, commas and one decimal point,
 * at most two decimals. A keystroke that isn't part of an amount ("-", "e") is refused,
 * keeping `prev`, so "1e5" can't silently become 15. Pasted "₹1,250" is fine.
 */
export function cleanAmountInput(raw: string, prev = ''): string {
  if (/[^\d.,\s₹]/.test(raw)) return prev;
  const s = raw.replace(/[^\d.,]/g, '');
  const dot = s.indexOf('.');
  if (dot === -1) return s;
  return (
    s.slice(0, dot + 1) +
    s
      .slice(dot + 1)
      .replace(/[.,]/g, '')
      .slice(0, 2)
  );
}
