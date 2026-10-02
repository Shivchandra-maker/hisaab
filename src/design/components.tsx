import { useEffect, useState, type ReactNode } from 'react';
import { formatINR, formatINRCompact } from '../domain/money';
import { formatMonth } from '../domain/dates';
import type { Account, Category, MonthKey, Paise, TxnKind } from '../domain/types';
import type { StatementStatus } from '../domain/ledger';
import { Icon } from './Icon';

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
      <span className="m">{formatMonth(month)}</span>
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
      style={{ background: catColor(category) }}
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
    <span className={`avatar ${small ? 'avatar-sm' : ''}`} style={{ background: bg }}>
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

/** Vertical bars drawn to one scale, with a light grid and value labels. */
export function BarChart({
  values,
  labels,
  highlight,
  height = 160,
  showValues,
  variant = 'accent',
}: {
  values: Paise[];
  labels: (string | null)[];
  highlight?: number;
  height?: number;
  showValues?: boolean;
  variant?: 'accent' | 'cycle';
}) {
  const W = 640;
  const padL = 44;
  const padR = 8;
  const padT = showValues ? 18 : 8;
  const padB = 22;
  const max = niceMax(Math.max(...values, 1));
  const innerH = height - padT - padB;
  const step = (W - padL - padR) / values.length;
  const bw = Math.max(2, Math.min(36, step * 0.62));
  const y = (v: number) => padT + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, max / 2, max];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Bar chart">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
          <text className="axis" x={padL - 6} y={y(t) + 4} textAnchor="end">
            {formatINRCompact(t)}
          </text>
        </g>
      ))}
      {values.map((v, i) => {
        const x = padL + i * step + (step - bw) / 2;
        const top = y(v);
        return (
          <g key={i}>
            <rect
              className={`b ${variant === 'cycle' ? 'c' : ''} ${highlight === undefined || highlight === i ? 'hi' : ''}`}
              x={x}
              y={top}
              width={bw}
              height={Math.max(0, padT + innerH - top)}
              rx={Math.min(4, bw / 3)}
            />
            {showValues && v > 0 && (
              <text className="val" x={x + bw / 2} y={top - 5} textAnchor="middle">
                {formatINRCompact(v)}
              </text>
            )}
            {labels[i] && (
              <text className="axis" x={x + bw / 2} y={height - 6} textAnchor="middle">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
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
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))}
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
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={className}
      style={armed ? { color: 'var(--neg)', borderColor: 'var(--neg)' } : undefined}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
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
