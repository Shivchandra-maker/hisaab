import { useMemo } from 'react';
import {
  BarChart,
  CategoryAvatar,
  EmptyState,
  MonthSwitcher,
  Panel,
  Progress,
} from '../design/components';
import { Icon } from '../design/Icon';
import { addMonths, formatMonth, monthOf, monthRange } from '../domain/dates';
import { counted, dailySpend, spendEffect, summarise, summariseMonth } from '../domain/ledger';
import { formatINR, formatINRCompact } from '../domain/money';
import type { PaymentMode } from '../domain/types';
import { useStore } from '../store';

const modeNames: Record<PaymentMode, string> = {
  upi: 'UPI',
  card: 'Card swipe / online',
  netbanking: 'Net banking',
  cash: 'Cash',
  auto_debit: 'Auto-debit',
  cheque: 'Cheque',
  wallet: 'Wallet',
  other: 'Other',
};

export function Insights({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { transactions: txns, categoryById, accountById, today } = useStore();
  const isCurrent = month === monthOf(today);
  const prevMonth = addMonths(month, -1);
  const s = useMemo(() => summariseMonth(txns, month), [txns, month]);
  // Mid-month, compare with the same days of last month — a half month vs a full one says nothing.
  const prev = useMemo(() => {
    if (!isCurrent) return summariseMonth(txns, prevMonth);
    const end = monthRange(prevMonth).end;
    const day = String(Math.min(Number(today.slice(8)), Number(end.slice(8)))).padStart(2, '0');
    return summarise(txns, `${prevMonth}-01`, `${prevMonth}-${day}`);
  }, [txns, prevMonth, isCurrent, today]);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const trend = months.map((m) => summariseMonth(txns, m).spent);
  // Average of the full months before this one that have any spending.
  const past = trend.slice(0, 5).filter((v) => v > 0);
  const avg = past.length ? Math.round(past.reduce((a, b) => a + b, 0) / past.length) : 0;
  const daily = dailySpend(txns, month);
  const cats = [...s.byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const byMode = new Map<string, number>();
  for (const t of txns) {
    // Purchases only: a refund isn't a way of paying, and would show as a negative "Other".
    if (!counted(t) || monthOf(t.date) !== month || t.kind !== 'expense') continue;
    const k = t.paymentMode ?? 'other';
    byMode.set(k, (byMode.get(k) ?? 0) + spendEffect(t));
  }
  const modes = [...byMode.entries()].sort((a, b) => b[1] - a[1]);
  const accts = [...s.byAccount.entries()].sort((a, b) => b[1] - a[1]);
  const totalSpent = Math.max(1, s.spent);
  const totalPaid = Math.max(
    1,
    modes.reduce((n, [, v]) => n + v, 0),
  );
  const vsLabel = `vs ${formatMonth(prevMonth, 'short')}${isCurrent ? ' by this date' : ''}`;
  const todayIdx = monthOf(today) === month ? Number(today.slice(8)) - 1 : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Insights</h1>
        <MonthSwitcher month={month} onChange={setMonth} max={monthOf(today)} />
      </div>

      {s.spent === 0 && trend.every((v) => v === 0) ? (
        <section className="panel">
          <EmptyState
            title="Nothing to chart yet"
            body="Insights fill in as you add spending. A week of entries is enough to see a pattern."
          />
        </section>
      ) : (
        <>
          <div className="grid-2">
            <Panel
              title="Last 6 months"
              action={
                avg > 0 && (
                  <span className="faint panel-note">
                    <i className="lg-dash" /> avg {formatINRCompact(avg)}
                  </span>
                )
              }
            >
              <BarChart
                values={trend}
                labels={months.map((m) => formatMonth(m, 'short'))}
                highlight={5}
                showValues
                average={avg || undefined}
                label={`Spending per month, ${formatMonth(months[0]!)} to ${formatMonth(month)}`}
              />
            </Panel>
            <Panel title={`Daily spending · ${formatMonth(month, 'short')}`}>
              <BarChart
                values={daily.map((v) => Math.max(0, v))}
                labels={daily.map((_, i) =>
                  [0, 7, 14, 21].includes(i) || i === daily.length - 1 ? String(i + 1) : null,
                )}
                highlight={todayIdx}
                label={`Spending per day in ${formatMonth(month)}`}
              />
            </Panel>
          </div>

          <Panel title="By category" action={<span className="faint panel-note">{vsLabel}</span>}>
            <div className="stack">
              {cats.map(([id, amt]) => {
                const c = categoryById.get(id);
                const before = prev.byCategory.get(id) ?? 0;
                const change = before > 0 ? Math.round(((amt - before) / before) * 100) : null;
                return (
                  <div key={id} className="row cat-row">
                    <CategoryAvatar category={c} small />
                    <div className="item-main stack" style={{ gap: 4 }}>
                      <div className="row">
                        <span className="cat-name">{c?.name ?? 'Uncategorised'}</span>
                        <span className="spacer" />
                        <span className="num">{formatINR(amt)}</span>
                      </div>
                      <Progress
                        value={amt / totalSpent}
                        color={`var(--${c?.color ?? 'cat-6'})`}
                        thin
                      />
                      <div className="row cat-meta">
                        <span>{Math.round((amt / totalSpent) * 100)}% of spending</span>
                        <span className="spacer" />
                        {change === null ? (
                          <span className="faint">
                            {isCurrent ? 'None by now in ' : 'None in '}
                            {formatMonth(prevMonth, 'short')}
                          </span>
                        ) : change === 0 ? (
                          <span className="faint">Same as before</span>
                        ) : (
                          <span
                            className={change > 15 ? 'chg-up' : change < 0 ? 'chg-down' : 'faint'}
                          >
                            <Icon name={change > 0 ? 'up' : 'down'} size={12} />
                            {Math.abs(change)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <div className="grid-2">
            <Panel title="How you paid">
              <div className="stack">
                {modes.map(([k, v]) => (
                  <div key={k} className="stack" style={{ gap: 4 }}>
                    <div className="row">
                      <span>{modeNames[k as PaymentMode] ?? k}</span>
                      <span className="faint share">{Math.round((v / totalPaid) * 100)}%</span>
                      <span className="spacer" />
                      <span className="num">{formatINR(v)}</span>
                    </div>
                    <Progress value={v / totalPaid} thin />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="By account">
              <div className="stack">
                {accts.map(([id, v]) => {
                  const a = accountById.get(id);
                  return (
                    <div key={id} className="stack" style={{ gap: 4 }}>
                      <div className="row">
                        <span>{a?.name}</span>
                        <span className="spacer" />
                        <span className="num">{formatINR(v)}</span>
                      </div>
                      <Progress
                        value={v / totalSpent}
                        color={a?.kind === 'credit_card' ? 'var(--cycle)' : 'var(--accent)'}
                        thin
                      />
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
