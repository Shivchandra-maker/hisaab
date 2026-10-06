import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cleanAmountInput, formatINR, formatINRCompact } from '../domain/money';
import { formatMonth } from '../domain/dates';
import type { Account, Category, MonthKey, Paise, TxnKind } from '../domain/types';
import type { StatementStatus } from '../domain/ledger';
import { Icon } from './Icon';
import type React from 'react';

export const catColor = (c?: Pick<Category, 'color'>) => `var(--${c?.color ?? 'cat-6'})`;

export function Amount({
  value,
  kind,
  compact,
  className = '',
}: {
  value: Paise;
  kind?: TxnKind;
  compact?: boolean;
  className?: string;
}) {
  const text = compact ? formatINRCompact(value) : formatINR(value);
  const cls =
    kind === 'income' || kind === 'refund'
      ? 'amt-income'
      : kind === 'transfer'
        ? 'amt-transfer'
        : '';
  const prefix = kind === 'income' || kind === 'refund' ? '+' : '';
  return <span className={`num ${cls} ${className}`}>{prefix + text}</span>;
}

export function MonthSwitcher({
  month,
  onChange,
  max,
}: {
  month: MonthKey;
  onChange: (m: MonthKey) => void;
  max?: MonthKey;
}) {
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const t = y * 12 + m - 1 + n;
    const next = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    if (!max || next <= max) onChange(next);
  };
  return (
    <div className="month-switch">
      <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
        <Icon name="left" size={18} />
      </button>
      <span className="m" aria-live="polite">
        {formatMonth(month)}
      </span>
      <button
        className="icon-btn"
        onClick={() => shift(1)}
        aria-label="Next month"
        disabled={!!max && month >= max}
      >
        <Icon name="right" size={18} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CategoryAvatar({ category, small }: { category?: Category; small?: boolean }) {
  return (
    <span
      className={`avatar ${small ? 'avatar-sm' : ''}`}
      style={{ '--c': catColor(category) } as React.CSSProperties}
    >
      <Icon name={category?.icon ?? 'dots'} size={small ? 15 : 18} />
    </span>
  );
}

const accountIcon: Record<Account['kind'], string> = {
  bank: 'bank',
  cash: 'cash',
  wallet: 'phone',
  credit_card: 'card',
};

export function AccountAvatar({ account, small }: { account: Account; small?: boolean }) {
  const bg =
    account.kind === 'credit_card'
      ? 'var(--cycle)'
      : account.kind === 'cash'
        ? 'var(--cat-2)'
        : 'var(--accent)';
  return (
    <span
      className={`avatar ${small ? 'avatar-sm' : ''}`}
      style={{ '--c': bg } as React.CSSProperties}
    >
      <Icon name={accountIcon[account.kind]} size={small ? 15 : 18} />
    </span>
  );
}

export function StatusPill({
  status,
  children,
}: {
  status: StatementStatus;
  children?: ReactNode;
}) {
  const map: Record<StatementStatus, [string, string]> = {
    open: ['pill-cycle', 'Open'],
    paid: ['pill-ok', 'Paid'],
    due: ['pill-warn', 'Due'],
    overdue: ['pill-bad', 'Overdue'],
  };
  const [cls, text] = map[status];
  return <span className={`pill ${cls}`}>{children ?? text}</span>;
}

export function Progress({
  value,
  color = 'var(--accent)',
  thin,
}: {
  value: number;
  color?: string;
  thin?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={`bar ${thin ? 'bar-thin' : ''}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Width of an element in CSS pixels, so charts draw text at its real size on every screen. */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

/** Vertical bars drawn to one scale, with a light grid and value labels. */
export function BarChart({
  values,
  labels,
  highlight,
  height = 160,
  showValues,
  variant = 'accent',
  label = 'Bar chart',
  average,
  dim,
  onSelect,
  selected,
  describe,
  cap,
}: {
  values: Paise[];
  labels: (string | null)[];
  highlight?: number;
  height?: number;
  showValues?: boolean;
  variant?: 'accent' | 'cycle';
  label?: string;
  /** Draws a dashed reference line (e.g. the monthly average). */
  average?: Paise;
  /** Lighter bars (e.g. weekends). */
  dim?: boolean[];
  /** Bars become buttons (U-19: tap a day to see its payments). */
  onSelect?: (i: number) => void;
  /** The bar shown as picked. */
  selected?: number;
  /** Accessible name for each bar button. */
  describe?: (i: number) => string;
  /**
   * Scale top (D-13). Bars above it are drawn cut off at the top with a break mark and their
   * value written above, so one big day doesn't flatten all the others.
   */
  cap?: Paise;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const padL = 40;
  const padR = 4;
  const capped = cap !== undefined && cap > 0 && values.some((v) => v > cap);
  const padT = showValues || capped ? 20 : 8;
  const padB = 22;
  const max = niceMax(
    capped ? Math.max(cap!, average ?? 0, 1) : Math.max(...values, average ?? 0, 1),
  );
  const innerH = height - padT - padB;
  const step = (W - padL - padR) / values.length;
  const bw = Math.max(2, Math.min(40, step * 0.6));
  const y = (v: number) => padT + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, max / 2, max];
  // Leave out value labels that would collide on narrow screens.
  const valuesFit = step >= 34;
  return (
    <div ref={ref} className="chart-wrap">
      <svg
        className="chart"
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={label}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text className="axis" x={padL - 6} y={y(t) + 4} textAnchor="end">
              {formatINRCompact(t)}
            </text>
          </g>
        ))}
        {average !== undefined && average > 0 && (
          <line className="avg" x1={padL} x2={W - padR} y1={y(average)} y2={y(average)} />
        )}
        {values.map((v, i) => {
          const x = padL + i * step + (step - bw) / 2;
          const over = capped && v > max;
          const top = over ? padT : y(v);
          const hi = highlight === undefined || highlight === i;
          const press = onSelect ? () => onSelect(i) : undefined;
          return (
            <g
              key={i}
              className={onSelect ? 'bar-btn' : undefined}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? (describe?.(i) ?? `${labels[i] ?? i + 1}`) : undefined}
              onClick={press}
              onKeyDown={
                press
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        press();
                      }
                    }
                  : undefined
              }
            >
              {onSelect && (
                <rect className="hit" x={padL + i * step} y={padT} width={step} height={innerH} />
              )}
              <title>{`${labels[i] ?? i + 1}: ${formatINR(v)}`}</title>
              <rect
                className={`b ${variant === 'cycle' ? 'c' : ''} ${hi ? 'hi' : ''} ${dim?.[i] ? 'dim' : ''} ${selected === i ? 'sel' : ''}`}
                x={x}
                y={top}
                width={bw}
                height={Math.max(v > 0 ? 2 : 0, padT + innerH - top)}
                rx={Math.min(5, bw / 3)}
              />
              {over && (
                <>
                  <path
                    className="cut"
                    d={`M${x - 2},${padT + 9} l${bw + 4},-4 M${x - 2},${padT + 14} l${bw + 4},-4`}
                  />
                  <text className="val val-hi" x={x + bw / 2} y={padT - 6} textAnchor="middle">
                    {formatINRCompact(v)}
                  </text>
                </>
              )}
              {showValues && valuesFit && v > 0 && !over && (
                <text
                  className={`val ${hi ? 'val-hi' : ''}`}
                  x={x + bw / 2}
                  y={top - 6}
                  textAnchor="middle"
                >
                  {formatINRCompact(v)}
                </text>
              )}
              {labels[i] && (
                <text
                  className={`axis ${highlight === i ? 'axis-hi' : ''}`}
                  x={x + bw / 2}
                  y={height - 5}
                  textAnchor="middle"
                >
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Running total through the month, against the same days last month — "am I spending faster
 * than usual?" (the pace view used by Copilot and Monzo Trends).
 */
export function PaceChart({
  current,
  previous,
  upTo,
  height = 120,
  label,
}: {
  /** Daily spend for this month (one value per day). */
  current: Paise[];
  /** Daily spend for last month. */
  previous: Paise[];
  /** Days of this month that have happened (draw the line only that far). */
  upTo: number;
  height?: number;
  label: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const cum = (xs: Paise[]) => {
    let n = 0;
    return xs.map((v) => (n += Math.max(0, v)));
  };
  const c = cum(current).slice(0, upTo);
  const p = cum(previous);
  const days = Math.max(current.length, previous.length, 28);
  const max = niceMax(Math.max(...c, ...p, 1));
  const padT = 8;
  const padB = 18;
  const padX = 2;
  const x = (i: number) => padX + (i / (days - 1)) * (W - padX * 2);
  const y = (v: number) => padT + (height - padT - padB) * (1 - v / max);
  const path = (xs: number[]) =>
    xs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = c.length - 1;
  const area =
    c.length > 1 ? `${path(c)}L${x(last).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
  return (
    <div ref={ref} className="chart-wrap">
      <svg
        className="chart pace"
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={label}
      >
        <line className="grid" x1={0} x2={W} y1={y(0)} y2={y(0)} />
        {p.length > 1 && <path className="pace-prev" d={path(p)} />}
        {area && <path className="pace-area" d={area} />}
        {c.length > 1 && <path className="pace-now" d={path(c)} />}
        {last >= 0 && <circle className="pace-dot" cx={x(last)} cy={y(c[last]!)} r={4} />}
        <text className="axis" x={padX} y={height - 3}>
          1
        </text>
        <text className="axis" x={W / 2} y={height - 3} textAnchor="middle">
          15
        </text>
        <text className="axis" x={W - padX} y={height - 3} textAnchor="end">
          {days}
        </text>
      </svg>
    </div>
  );
}

/** "↑ ₹4,350 more than Sept" in a quiet pill; up = warn tint, down = calm green. */
export function Delta({ value, suffix }: { value: Paise; suffix: string }) {
  if (value === 0) return <span className="delta delta-flat">Same as {suffix}</span>;
  const up = value > 0;
  return (
    <span className={`delta ${up ? 'delta-up' : 'delta-down'}`}>
      <Icon name={up ? 'up' : 'down'} size={13} />
      {formatINR(Math.abs(value))} {up ? 'more' : 'less'} than {suffix}
    </span>
  );
}

export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

/** Bottom sheet on phones, centred dialog on desktop. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = `sheet-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="scrim" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h2 id={id} style={{ fontSize: 'var(--fs-lg)' }}>
            {title}
          </h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

/** Rupee text field. Keeps the typed string; convert with toPaise on save. */
export function MoneyInput({
  id,
  value,
  onChange,
  placeholder = '0',
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="input row" style={{ gap: 6, padding: '0 12px' }}>
      <span className="faint">₹</span>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(cleanAmountInput(e.target.value, value))}
        style={{
          border: 0,
          outline: 0,
          background: 'none',
          padding: '10px 0',
          flex: 1,
          minWidth: 0,
        }}
        className="num"
      />
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && (
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="note"
      role="alert"
      style={{ background: 'var(--neg-soft)', color: 'var(--neg)' }}
    >
      {message}
    </div>
  );
}

/** A destructive button that asks for a second tap instead of a browser confirm(). */
export function ConfirmButton({
  label,
  confirmLabel = 'Tap again to confirm',
  onConfirm,
  className = 'btn',
  canArm,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
  /** Checked on the first tap; return false to skip arming (e.g. the input is invalid). */
  canArm?: () => boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={className}
      style={armed ? { color: 'var(--neg)', borderColor: 'var(--neg)' } : undefined}
      onClick={() => (armed ? onConfirm() : (!canArm || canArm()) && setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="stack"
      style={{ alignItems: 'center', textAlign: 'center', padding: 'var(--sp-6) var(--sp-4)' }}
    >
      <h3 style={{ fontSize: 'var(--fs-lg)' }}>{title}</h3>
      {body && (
        <p className="muted" style={{ margin: 0, maxWidth: '40ch' }}>
          {body}
        </p>
      )}
      {action}
    </div>
  );
}

/**
 * A row of chips that scrolls sideways (D-14). Keeps the chosen chip in view — on open and when
 * the choice changes — so you always see which account is picked, and fades the edges that have
 * more chips behind them.
 */
export function ChipRow({ value, children }: { value: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  };
  useLayoutEffect(() => {
    const el = ref.current;
    const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el && chip) {
      // Only the row scrolls (not the sheet): centre the chosen chip when it's out of view.
      const l = chip.offsetLeft - el.offsetLeft;
      if (l < el.scrollLeft || l + chip.offsetWidth > el.scrollLeft + el.clientWidth)
        el.scrollLeft = l - (el.clientWidth - chip.offsetWidth) / 2;
    }
    measure();
  }, [value]);
  return (
    <div
      ref={ref}
      className={`chips scroll ${edges.left ? 'fade-l' : ''} ${edges.right ? 'fade-r' : ''}`}
      onScroll={measure}
    >
      {children}
    </div>
  );
}

/**
 * "‹ Insights" above a page title (D-15). A labelled text link, so it never looks like the month
 * switcher's "‹" and says where it goes.
 */
export function BackLink({
  label,
  onClick,
  phoneOnly,
}: {
  label: string;
  onClick: () => void;
  phoneOnly?: boolean;
}) {
  return (
    <button className={`back-link ${phoneOnly ? 'phone-only-flex' : ''}`} onClick={onClick}>
      <Icon name="left" size={16} />
      {label}
    </button>
  );
}
