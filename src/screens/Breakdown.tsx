import { useMemo, useState } from 'react';
import {
  AccountAvatar,
  BackLink,
  BarChart,
  CategoryAvatar,
  EmptyState,
  MonthSwitcher,
  Panel,
  Progress,
} from '../design/components';
import { Icon } from '../design/Icon';
import { addMonths, formatDate, formatMonth, monthOf, monthRange } from '../domain/dates';
import {
  breakdownItems,
  breakdownRoute,
  byAccount,
  byCategory,
  byMerchant,
  sumItems,
  type BreakdownKey,
} from '../domain/breakdown';
import { summariseMonth } from '../domain/ledger';
import { formatINR } from '../domain/money';
import type { PaymentMode } from '../domain/types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { TxnRow } from './TxnRow';

export const MODE_NAMES: Record<PaymentMode, string> = {
  upi: 'UPI',
  card: 'Card swipe / online',
  netbanking: 'Net banking',
  cash: 'Cash',
  auto_debit: 'Auto-debit',
  cheque: 'Cheque',
  wallet: 'Wallet',
  other: 'Other',
};

/**
 * One category, way of paying or account from Insights, opened up (U-20): how much, how it
 * compares, where it went, and every payment behind the number, newest first.
 */
export function Breakdown({
  k,
  month,
  setMonth,
}: {
  k: BreakdownKey;
  month: string;
  setMonth: (m: string) => void;
}) {
  const { transactions: txns, categoryById, accountById, today } = useStore();
  const { go } = useUI();
  const [shop, setShop] = useState<string>();
  // A shop picked in one month or category means nothing in another.
  const [shopFor, setShopFor] = useState(`${k.by}:${k.id}:${month}`);
  if (shopFor !== `${k.by}:${k.id}:${month}`) {
    setShopFor(`${k.by}:${k.id}:${month}`);
    setShop(undefined);
  }
  const isCurrent = month === monthOf(today);
  const { start, end } = monthRange(month);

  const items = useMemo(() => breakdownItems(txns, k, start, end), [txns, k, start, end]);
  const total = sumItems(items);
  const monthSpent = summariseMonth(txns, month).spent;
  // Same days of last month while this month is still running.
  const prevMonth = addMonths(month, -1);
  const prevEnd = (() => {
    const pe = monthRange(prevMonth).end;
    if (!isCurrent) return pe;
    const day = String(Math.min(Number(today.slice(8)), Number(pe.slice(8)))).padStart(2, '0');
    return `${prevMonth}-${day}`;
  })();
  const prevTotal = sumItems(breakdownItems(txns, k, `${prevMonth}-01`, prevEnd));
  const change = total - prevTotal;
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const trend = months.map((m) => {
    const r = monthRange(m);
    return Math.max(0, sumItems(breakdownItems(txns, k, r.start, r.end)));
  });

  const cat = k.by === 'category' ? categoryById.get(k.id) : undefined;
  const acc = k.by === 'account' ? accountById.get(k.id) : undefined;
  const title =
    k.by === 'category'
      ? (cat?.name ?? 'Uncategorised')
      : k.by === 'mode'
        ? `Paid by ${MODE_NAMES[k.id as PaymentMode] ?? k.id}`
        : (acc?.name ?? 'Account');

  const shops = k.by === 'category' ? byMerchant(items) : [];
  const accounts = k.by === 'mode' ? byAccount(items) : [];
  const cats = k.by !== 'category' ? byCategory(items) : [];
  const shown = shop
    ? items.filter((i) => (i.t.merchant?.trim() || 'Other').toLowerCase() === shop)
    : items;
  const days = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const i of [...shown].reverse()) m.set(i.t.date, [...(m.get(i.t.date) ?? []), i]);
    return [...m.entries()];
  }, [shown]);

  return (
    <div className="page">
      <BackLink
        label="Insights"
        // Back, not a new visit: Android's back button then doesn't return here.
        onClick={() => (window.history.length > 1 ? window.history.back() : go('insights'))}
      />
      <div className="page-head">
        <div className="row" style={{ minWidth: 0 }}>
          {cat && <CategoryAvatar category={cat} small />}
          {acc && <AccountAvatar account={acc} small />}
          <h1 style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
        </div>
        <MonthSwitcher month={month} onChange={setMonth} max={monthOf(today)} />
      </div>

      <section className="hero">
        <span className="hero-amount num">{formatINR(total)}</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <span className="muted">
            {monthSpent > 0
              ? `${Math.max(0, Math.round((total / monthSpent) * 100))}% of your spending · `
              : ''}
            {items.length} payment{items.length === 1 ? '' : 's'}
          </span>
          {items.length > 1 && (
            <span className="muted nowrap">
              {formatINR(Math.round(total / items.length))} on average
            </span>
          )}
          {prevTotal > 0 && change !== 0 && (
            <span className={`pill ${change > 0 ? 'pill-warn' : 'pill-ok'}`}>
              {change > 0 ? '↑' : '↓'} <span className="num">{formatINR(Math.abs(change))}</span> vs{' '}
              {formatMonth(prevMonth, 'short')}
              {isCurrent ? ' by now' : ''}
            </span>
          )}
        </div>
        <BarChart
          values={trend}
          labels={months.map((m) => formatMonth(m, 'short'))}
          highlight={5}
          height={120}
          showValues
          label={`${title}, last 6 months`}
        />
      </section>

      {(shops.length > 1 || shop) && (
        <div className="chips scroll" role="group" aria-label="Where">
          <button className="chip" aria-pressed={!shop} onClick={() => setShop(undefined)}>
            All
          </button>
          {shops.slice(0, 8).map((s) => (
            <button
              key={s.name}
              className="chip"
              aria-pressed={shop === s.name.toLowerCase()}
              onClick={() =>
                setShop(shop === s.name.toLowerCase() ? undefined : s.name.toLowerCase())
              }
            >
              {s.name} · <span className="num">{formatINR(s.amount)}</span>
            </button>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <Panel title="From">
          <div className="list">
            {accounts.map((a) => {
              const ac = accountById.get(a.id);
              return (
                <button
                  key={a.id}
                  className="item"
                  onClick={() => go(breakdownRoute({ by: 'account', id: a.id }))}
                >
                  {ac && <AccountAvatar account={ac} small />}
                  <div className="item-main">
                    <div className="item-title">{ac?.name ?? 'Account'}</div>
                    <Progress value={total ? a.amount / total : 0} thin />
                  </div>
                  <span className="num">{formatINR(a.amount)}</span>
                  <Icon name="right" size={16} className="faint" />
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {cats.length > 0 && (
        <Panel title="What it went on">
          <div className="list">
            {cats.slice(0, 6).map((c) => {
              const cc = categoryById.get(c.id);
              return (
                <button
                  key={c.id}
                  className="item"
                  onClick={() => go(breakdownRoute({ by: 'category', id: c.id }))}
                >
                  <CategoryAvatar category={cc} small />
                  <div className="item-main">
                    <div className="item-title">{cc?.name ?? 'Uncategorised'}</div>
                    <Progress
                      value={total ? c.amount / total : 0}
                      color={`var(--${cc?.color ?? 'cat-6'})`}
                      thin
                    />
                  </div>
                  <span className="num">{formatINR(c.amount)}</span>
                  <Icon name="right" size={16} className="faint" />
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title="Payments">
        {days.length === 0 && (
          <EmptyState
            title={`Nothing here in ${formatMonth(month)}`}
            body="Pick another month above, or go back to Insights."
          />
        )}
        {days.map(([date, list]) => (
          <div key={date}>
            <div className="day-head">
              <span>{date === today ? 'Today' : formatDate(date, 'weekday')}</span>
              <span className="num">{formatINR(sumItems(list))}</span>
            </div>
            <div className="list">
              {list.map((i) => (
                <TxnRow key={i.t.id} t={i.t} />
              ))}
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
