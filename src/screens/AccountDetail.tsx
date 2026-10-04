import { useMemo, useState } from 'react';
import { AccountAvatar, EmptyState, Panel } from '../design/components';
import { Icon } from '../design/Icon';
import { formatDate } from '../domain/dates';
import { assetDelta, balanceOf, counted } from '../domain/ledger';
import { formatINR } from '../domain/money';
import { useStore } from '../store';
import { useUI } from '../ui';
import { AdjustSheet } from './AccountSheet';
import { TxnRow } from './TxnRow';
import { BankCheck } from './BankCheck';

/** Register for a bank, cash or wallet account: balance, running balance per day. */
export function AccountDetail({ id }: { id: string }) {
  const { accountById, transactions, today } = useStore();
  const { go, openAccount, openTxn } = useUI();
  const [adjusting, setAdjusting] = useState(false);
  const [limit, setLimit] = useState(60);
  const acc = accountById.get(id);

  const days = useMemo(() => {
    if (!acc) return [];
    const mine = transactions.filter(
      (t) =>
        counted(t) && t.date >= acc.openingDate && (t.accountId === id || t.toAccountId === id),
    );
    let running = acc.openingBalance;
    const rows = mine.map((t) => {
      running += assetDelta(t, id);
      return { t, after: running };
    });
    const groups = new Map<string, typeof rows>();
    for (const r of rows.reverse().slice(0, limit))
      groups.set(r.t.date, [...(groups.get(r.t.date) ?? []), r]);
    return [...groups.entries()];
  }, [acc, transactions, id, limit]);

  if (!acc)
    return (
      <EmptyState
        title="Account not found"
        action={
          <button className="btn" onClick={() => go('accounts')}>
            Back to accounts
          </button>
        }
      />
    );
  const balance = balanceOf(acc, transactions, today);
  const total = transactions.filter((t) => t.accountId === id || t.toAccountId === id).length;

  return (
    <div className="page">
      <div className="page-head">
        <div className="row">
          <button className="icon-btn" onClick={() => go('accounts')} aria-label="Back to accounts">
            <Icon name="left" size={18} />
          </button>
          <AccountAvatar account={acc} small />
          <h1>{acc.name}</h1>
          {acc.archived && <span className="pill pill-neutral">Archived</span>}
        </div>
        <div className="row">
          <button className="btn" onClick={() => openAccount(acc)}>
            Edit
          </button>
          <button
            className="btn btn-primary"
            onClick={() => openTxn({ kind: 'expense', accountId: id })}
          >
            Add
          </button>
        </div>
      </div>

      <section className="hero">
        <span className="label">Balance today</span>
        <span className="hero-amount num">{formatINR(balance)}</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="muted">
            {[acc.institution, acc.last4 && `•• ${acc.last4}`, acc.upiIds?.[0]]
              .filter(Boolean)
              .join(' · ') || (acc.kind === 'cash' ? 'Cash in hand' : 'Wallet')}
          </span>
          <button className="btn btn-ghost" onClick={() => setAdjusting(true)}>
            Doesn’t match? Update balance
          </button>
        </div>
        <BankCheck account={acc} />
      </section>

      <Panel title="Activity">
        {days.length === 0 && (
          <EmptyState
            title="Nothing here yet"
            body="Transactions paid from or into this account show up here with the balance after each one."
          />
        )}
        {days.map(([date, rows]) => (
          <div key={date}>
            <div className="day-head">
              <span>{date === today ? 'Today' : formatDate(date, 'weekday')}</span>
              <span className="num">Balance {formatINR(rows[0]!.after)}</span>
            </div>
            <div className="list">
              {rows.map(({ t }) => (
                <TxnRow key={t.id} t={t} perspective={id} />
              ))}
            </div>
          </div>
        ))}
        {total > limit && (
          <button
            className="btn btn-block"
            style={{ marginTop: 12 }}
            onClick={() => setLimit((n) => n + 100)}
          >
            Show older
          </button>
        )}
      </Panel>
      {adjusting && <AdjustSheet account={acc} onClose={() => setAdjusting(false)} />}
    </div>
  );
}
