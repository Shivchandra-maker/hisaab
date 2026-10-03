import { useMemo, useState } from 'react';
import { EmptyState, MonthSwitcher, Segmented } from '../design/components';
import { Icon } from '../design/Icon';
import { formatDate, formatMonth, monthOf } from '../domain/dates';
import { counted, spendEffect } from '../domain/ledger';
import { formatINR } from '../domain/money';
import type { TxnKind } from '../domain/types';
import { useStore } from '../store';
import { TxnRow } from './TxnRow';

type Filter = 'all' | 'spending' | 'income' | 'transfer';

export function Transactions({
  month,
  setMonth,
}: {
  month: string;
  setMonth: (m: string) => void;
}) {
  const { transactions, accounts, categoryById, today } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [accountId, setAccountId] = useState('');
  const [q, setQ] = useState('');

  const days = useMemo(() => {
    const match = (k: TxnKind) =>
      filter === 'all' ||
      (filter === 'spending' ? k === 'expense' || k === 'refund' : k === filter);
    const needle = q.trim().toLowerCase();
    const list = transactions
      .filter((t) => counted(t) && monthOf(t.date) === month && match(t.kind))
      .filter((t) => !accountId || t.accountId === accountId || t.toAccountId === accountId)
      .filter(
        (t) =>
          !needle ||
          [t.merchant, t.note, t.categoryId && categoryById.get(t.categoryId)?.name]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(needle)),
      )
      .reverse();
    const groups = new Map<string, typeof list>();
    for (const t of list) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
    return [...groups.entries()];
  }, [transactions, month, filter, accountId, q, categoryById]);
  const count = days.reduce((n, [, l]) => n + l.length, 0);
  const net = days.reduce((n, [, l]) => n + l.reduce((m, t) => m + spendEffect(t), 0), 0);
  const filtered = filter !== 'all' || !!accountId || !!q.trim();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Activity</h1>
        <MonthSwitcher month={month} onChange={setMonth} max={monthOf(today)} />
      </div>
      <div className="stack">
        <div className="filter-row">
          <Segmented
            label="Type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'spending', label: 'Spending' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfers' },
            ]}
          />
        </div>
        <div className="row filter-row">
          <div className="row input search-box">
            <Icon name="search" size={18} className="faint" />
            <label className="sr-only" htmlFor="tx-search">
              Search
            </label>
            <input
              id="tx-search"
              aria-label="Search merchant, note or category"
              type="search"
              placeholder="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <label className="sr-only" htmlFor="tx-account">
            Account
          </label>
          <select
            id="tx-account"
            className="input account-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {count > 0 && (
        <div className="list-summary">
          <span>
            {count} transaction{count === 1 ? '' : 's'}
            {filtered ? (count === 1 ? ' matches' : ' match') : ''}
          </span>
          {net !== 0 && (
            <span>
              {net > 0 ? 'Spent ' : 'Refunded '}
              <b className="num">{formatINR(Math.abs(net))}</b>
            </span>
          )}
        </div>
      )}

      <section className="panel" aria-label="Transactions">
        {days.length === 0 && (
          <EmptyState
            title={filtered ? 'No matches' : `Nothing in ${formatMonth(month)}`}
            body={
              filtered
                ? 'Try another word, or clear the filters.'
                : 'Transactions you add or accept from the Inbox show up here, grouped by day.'
            }
            action={
              filtered && (
                <button
                  className="btn"
                  onClick={() => {
                    setFilter('all');
                    setAccountId('');
                    setQ('');
                  }}
                >
                  Clear filters
                </button>
              )
            }
          />
        )}
        {days.map(([date, list]) => {
          const spent = list.reduce((n, t) => n + spendEffect(t), 0);
          return (
            <div key={date}>
              <div className="day-head">
                <span>{date === today ? 'Today' : formatDate(date, 'weekday')}</span>
                {spent !== 0 && <span className="num">{formatINR(spent)}</span>}
              </div>
              <div className="list">
                {list.map((t) => (
                  <TxnRow key={t.id} t={t} />
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
