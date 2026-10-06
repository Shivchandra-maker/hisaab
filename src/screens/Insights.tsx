import { useMemo, useState } from 'react';
import {
  BarChart,
  CategoryAvatar,
  EmptyState,
  MonthSwitcher,
  Panel,
  Progress,
  Sheet,
} from '../design/components';
import { Icon } from '../design/Icon';
import { addDays, addMonths, formatDate, formatMonth, monthOf, monthRange } from '../domain/dates';
import { counted, dailySpend, spendEffect, summarise, summariseMonth } from '../domain/ledger';
import { formatINR, formatINRCompact } from '../domain/money';
import type { PaymentMode } from '../domain/types';
import { breakdownRoute } from '../domain/breakdown';
import { dailyStats, vsTypical } from '../domain/daily';
import { useStore } from '../store';
import { useUI } from '../ui';
import { MODE_NAMES as modeNames } from './Breakdown';
import { TxnRow } from './TxnRow';

export function Insights({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { transactions: txns, categoryById, accountById, today } = useStore();
  const { go } = useUI();
  const [day, setDay] = useState<string>();
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
  // Days that have passed (all of them for an earlier month).
  const daysSoFar = todayIdx !== undefined ? todayIdx + 1 : daily.length;
  // D-13: a "typical day" leaves out one-off big days (rent, SIPs), which are drawn cut off.
  const stats = dailyStats(daily, daysSoFar);
  const dailyAvg = stats.typical;
  const bigDays = stats.outliers.map((i) => ({ i, v: daily[i] ?? 0 }));
  const weekend = daily.map((_, i) => {
    const d = new Date(`${month}-${String(i + 1).padStart(2, '0')}T12:00:00+05:30`).getUTCDay();
    return d === 0 || d === 6;
  });

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
            <Panel
              title={`Daily spending · ${formatMonth(month, 'short')}`}
              action={
                dailyAvg > 0 && (
                  <span className="faint panel-note">
                    <i className="lg-dash" /> typical day {formatINR(dailyAvg)}
                  </span>
                )
              }
            >
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'baseline' }}>
                  <span className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 600 }}>
                    {formatINR(Math.max(0, s.spent))}
                  </span>
                  <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                    in {daysSoFar} day{daysSoFar === 1 ? '' : 's'} · {s.count} payments
                  </span>
                </div>
                <BarChart
                  values={daily.map((v) => Math.max(0, v))}
                  labels={daily.map((_, i) =>
                    [0, 7, 14, 21].includes(i) || i === daily.length - 1 ? String(i + 1) : null,
                  )}
                  height={220}
                  average={dailyAvg || undefined}
                  cap={bigDays.length ? stats.scaleTop : undefined}
                  dim={weekend}
                  selected={day ? Number(day.slice(8)) - 1 : todayIdx}
                  onSelect={(i) => setDay(`${month}-${String(i + 1).padStart(2, '0')}`)}
                  describe={(i) =>
                    `${formatDate(`${month}-${String(i + 1).padStart(2, '0')}`, 'weekday')}: ${formatINR(Math.max(0, daily[i] ?? 0))}`
                  }
                  label={`Spending per day in ${formatMonth(month)}`}
                />
                <div className="row chart-legend">
                  <span>
                    <i className="lg-box" /> Spent that day
                  </span>
                  <span>
                    <i className="lg-box lg-dim" /> Weekend
                  </span>
                  <span className="spacer" />
                  <span className="faint">Tap a day</span>
                </div>
                {bigDays.length > 0 && (
                  <p className="faint chart-foot">
                    Cut off to keep other days readable:{' '}
                    {bigDays
                      .map(({ i, v }) => `${i + 1} ${formatMonth(month, 'short')} ${formatINR(v)}`)
                      .join(', ')}
                    . Not in the typical day.
                  </p>
                )}
              </div>
            </Panel>
          </div>

          <Panel title="By category" action={<span className="faint panel-note">{vsLabel}</span>}>
            <div className="stack">
              {cats.map(([id, amt]) => {
                const c = categoryById.get(id);
                const before = prev.byCategory.get(id) ?? 0;
                const change = before > 0 ? Math.round(((amt - before) / before) * 100) : null;
                return (
                  <button
                    key={id}
                    className="row cat-row drill"
                    onClick={() => go(breakdownRoute({ by: 'category', id }))}
                  >
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
                    <Icon name="right" size={16} className="faint" />
                  </button>
                );
              })}
            </div>
          </Panel>

          <div className="grid-2">
            <Panel title="How you paid">
              <div className="stack">
                {modes.map(([k, v]) => (
                  <button
                    key={k}
                    className="stack drill"
                    style={{ gap: 4 }}
                    onClick={() => go(breakdownRoute({ by: 'mode', id: k }))}
                  >
                    <div className="row">
                      <span>{modeNames[k as PaymentMode] ?? k}</span>
                      <span className="faint share">{Math.round((v / totalPaid) * 100)}%</span>
                      <span className="spacer" />
                      <span className="num">{formatINR(v)}</span>
                      <Icon name="right" size={16} className="faint" />
                    </div>
                    <Progress value={v / totalPaid} thin />
                  </button>
                ))}
              </div>
            </Panel>
            <Panel title="By account">
              <div className="stack">
                {accts.map(([id, v]) => {
                  const a = accountById.get(id);
                  return (
                    <button
                      key={id}
                      className="stack drill"
                      style={{ gap: 4 }}
                      onClick={() => go(breakdownRoute({ by: 'account', id }))}
                    >
                      <div className="row">
                        <span>{a?.name}</span>
                        <span className="spacer" />
                        <span className="num">{formatINR(v)}</span>
                        <Icon name="right" size={16} className="faint" />
                      </div>
                      <Progress
                        value={v / totalSpent}
                        color={a?.kind === 'credit_card' ? 'var(--cycle)' : 'var(--accent)'}
                        thin
                      />
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>
        </>
      )}
      {day && (
        <DaySheet
          date={day}
          avg={dailyAvg}
          onMove={(d) => setDay(d)}
          onClose={() => setDay(undefined)}
          first={`${month}-01`}
          last={todayIdx !== undefined ? today : monthRange(month).end}
        />
      )}
    </div>
  );
}

/** One day's payments from the daily chart (U-19): spending, and what wasn't (faded). */
function DaySheet({
  date,
  avg,
  first,
  last,
  onMove,
  onClose,
}: {
  date: string;
  avg: number;
  first: string;
  last: string;
  onMove: (d: string) => void;
  onClose: () => void;
}) {
  const { transactions } = useStore();
  const list = transactions.filter((t) => counted(t) && t.date === date).reverse();
  const spent = list.reduce((n, t) => n + spendEffect(t), 0);
  const spendCount = list.filter((t) => t.kind === 'expense').length;
  const refundCount = list.filter((t) => t.kind === 'refund').length;
  const cmp = vsTypical(Math.max(0, spent), avg);
  const gap = Math.abs(Math.max(0, spent) - avg);
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  return (
    <Sheet title={formatDate(date, 'long')} onClose={onClose}>
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="hero-amount num" style={{ fontSize: 'var(--fs-2xl)' }}>
            {formatINR(Math.max(0, spent))}
          </span>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            {spendCount} payment{spendCount === 1 ? '' : 's'}
            {refundCount ? ` · ${refundCount} refund${refundCount === 1 ? '' : 's'}` : ''}
            {avg > 0 && spent > 0
              ? cmp === 'about'
                ? ' · about a typical day'
                : ` · ${formatINR(gap)} ${cmp} than a typical day`
              : ''}
          </span>
        </div>
        <div className="row">
          <button className="btn btn-sm" disabled={prev < first} onClick={() => onMove(prev)}>
            <Icon name="left" size={14} /> {formatDate(prev)}
          </button>
          <span className="spacer" />
          <button className="btn btn-sm" disabled={next > last} onClick={() => onMove(next)}>
            {formatDate(next)} <Icon name="right" size={14} />
          </button>
        </div>
        {list.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing on this day.
          </p>
        ) : (
          <div className="list">
            {list.map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
