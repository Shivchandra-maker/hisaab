import { useMemo } from 'react';
import { BarChart, CategoryAvatar, MonthSwitcher, Panel, Progress } from '../design/components';
import { addMonths, formatMonth, monthOf } from '../domain/dates';
import { counted, dailySpend, spendEffect, summariseMonth } from '../domain/ledger';
import { formatINR } from '../domain/money';
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
  const s = useMemo(() => summariseMonth(txns, month), [txns, month]);
  const prev = useMemo(() => summariseMonth(txns, addMonths(month, -1)), [txns, month]);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const trend = months.map((m) => summariseMonth(txns, m).spent);
  const daily = dailySpend(txns, month);
  const cats = [...s.byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const byMode = new Map<string, number>();
  for (const t of txns) {
    if (!counted(t) || monthOf(t.date) !== month || spendEffect(t) === 0) continue;
    const k = t.paymentMode ?? 'other';
    byMode.set(k, (byMode.get(k) ?? 0) + spendEffect(t));
  }
  const modes = [...byMode.entries()].sort((a, b) => b[1] - a[1]);
  const accts = [...s.byAccount.entries()].sort((a, b) => b[1] - a[1]);
  const totalSpent = Math.max(1, s.spent);
  const todayIdx = monthOf(today) === month ? Number(today.slice(8)) - 1 : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Insights</h1>
        <MonthSwitcher month={month} onChange={setMonth} max={monthOf(today)} />
      </div>

      <div className="grid-2">
        <Panel title="Last 6 months">
          <BarChart
            values={trend}
            labels={months.map((m) => formatMonth(m, 'short'))}
            highlight={5}
            showValues
          />
        </Panel>
        <Panel title={`Daily spending · ${formatMonth(month, 'short')}`}>
          <BarChart
            values={daily.map((v) => Math.max(0, v))}
            labels={daily.map((_, i) =>
              [0, 7, 14, 21].includes(i) || i === daily.length - 1 ? String(i + 1) : null,
            )}
            highlight={todayIdx}
          />
        </Panel>
      </div>

      <Panel
        title="By category"
        action={
          <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
            vs {formatMonth(addMonths(month, -1), 'short')}
          </span>
        }
      >
        <div className="stack">
          {cats.map(([id, amt]) => {
            const c = categoryById.get(id);
            const before = prev.byCategory.get(id) ?? 0;
            const change = before > 0 ? Math.round(((amt - before) / before) * 100) : null;
            return (
              <div key={id} className="row">
                <CategoryAvatar category={c} small />
                <div className="item-main stack" style={{ gap: 4 }}>
                  <div className="row">
                    <span style={{ fontWeight: 500 }}>{c?.name ?? 'Uncategorised'}</span>
                    <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      {Math.round((amt / totalSpent) * 100)}%
                    </span>
                    <span className="spacer" />
                    {change !== null && (
                      <span className={`pill ${change > 15 ? 'pill-warn' : 'pill-neutral'}`}>
                        {change > 0 ? '+' : ''}
                        {change}%
                      </span>
                    )}
                    <span className="num" style={{ minWidth: '6em', textAlign: 'right' }}>
                      {formatINR(amt)}
                    </span>
                  </div>
                  <Progress value={amt / totalSpent} color={`var(--${c?.color ?? 'cat-6'})`} thin />
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
                  <span className="spacer" />
                  <span className="num">{formatINR(v)}</span>
                </div>
                <Progress value={v / totalSpent} thin />
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
    </div>
  );
}
