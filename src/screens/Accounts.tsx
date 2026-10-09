import { useState } from 'react';
import { AccountAvatar, EmptyState, Panel, Progress, StatusPill } from '../design/components';
import { Icon } from '../design/Icon';
import { formatDate } from '../domain/dates';
import { balanceOf, billReserve, cardSnapshot } from '../domain/ledger';
import { formatINR } from '../domain/money';
import type { Account } from '../domain/types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { PeopleSummary } from './People';

export function Accounts() {
  const { accounts: all, transactions: txns, today } = useStore();
  const { go, openAccount } = useUI();
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = all.filter((a) => a.archived).length;
  const accounts = showArchived ? all : all.filter((a) => !a.archived);
  const r = billReserve(all, txns, today);
  const groups: [string, Account[]][] = [
    ['Bank accounts', accounts.filter((a) => a.kind === 'bank')],
    ['Cash & wallets', accounts.filter((a) => a.kind === 'cash' || a.kind === 'wallet')],
  ];
  const cards = accounts.filter((a) => a.kind === 'credit_card');

  return (
    <div className="page">
      <div className="page-head">
        <h1>Accounts</h1>
        <button className="btn btn-primary" onClick={() => openAccount()}>
          Add account
        </button>
      </div>

      <section className="panel summary-strip" aria-label="Money summary">
        <div>
          <div className="label">You have</div>
          <div className="num v">{formatINR(r.cash)}</div>
        </div>
        <div>
          <div className="label">Card dues</div>
          <div className="num v" style={{ color: 'var(--cycle)' }}>
            {r.owedToCards > 0 ? '−' : ''}
            {formatINR(r.owedToCards)}
          </div>
        </div>
        <div>
          <div className="label">Free to spend</div>
          <div className="num v" style={{ color: 'var(--accent)' }}>
            {formatINR(r.freeToSpend)}
          </div>
        </div>
      </section>

      {cards.length > 0 && (
        <Panel title="Credit cards">
          <div className="list">
            {cards.map((c) => {
              const s = cardSnapshot(c, txns, today);
              return (
                <button key={c.id} className="item" onClick={() => go(`card-${c.id}`)}>
                  <AccountAvatar account={c} />
                  <div className="item-main stack" style={{ gap: 6 }}>
                    <div className="row">
                      <span className="item-title">{c.name}</span>
                      {c.archived && <span className="pill pill-neutral">Archived</span>}
                      {c.last4 && (
                        <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                          •• {c.last4}
                        </span>
                      )}
                      <span className="spacer" />
                      <span className="num">{formatINR(Math.max(0, s.owed))}</span>
                    </div>
                    <Progress value={s.utilisation} color="var(--cycle)" thin />
                    <div className="row item-sub" style={{ flexWrap: 'wrap', gap: 8 }}>
                      {s.dueNow > 0 ? (
                        <StatusPill status={s.dueStatus}>
                          {formatINR(s.dueNow)} due {formatDate(s.dueDate!)}
                        </StatusPill>
                      ) : s.lastStatement.totalDue > 0 ? (
                        <StatusPill status="paid">Last bill paid</StatusPill>
                      ) : (
                        <StatusPill status="open">No bill yet</StatusPill>
                      )}
                      <span>
                        Next statement {formatDate(s.currentPeriod.end)}
                        {c.card!.creditLimit > 0 &&
                          ` · ${Math.round(s.utilisation * 100)}% of limit used`}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      <div className="grid-2">
        {groups
          .filter(([, list]) => list.length > 0)
          .map(([title, list]) => (
            <Panel key={title} title={title}>
              <div className="list">
                {list.map((a) => (
                  <button key={a.id} className="item" onClick={() => go(`acct-${a.id}`)}>
                    <AccountAvatar account={a} />
                    <div className="item-main">
                      <div className="item-title">{a.name}</div>
                      <div className="item-sub">
                        {a.institution ?? (a.kind === 'wallet' ? 'Prepaid wallet' : 'In hand')}
                        {a.last4 ? ` · •• ${a.last4}` : ''}
                        {a.upiIds?.length ? ` · ${a.upiIds[0]}` : ''}
                      </div>
                    </div>
                    <span className="num">{formatINR(balanceOf(a, txns, today))}</span>
                    <Icon name="right" size={16} className="faint" />
                  </button>
                ))}
              </div>
            </Panel>
          ))}
      </div>
      {/* D-07: your own accounts first; money with friends after. */}
      <PeopleSummary />
      {accounts.length === 0 && (
        <section className="panel">
          <EmptyState
            title="No accounts"
            body="Add a bank account, cash, a wallet or a credit card."
            action={
              <button className="btn btn-primary" onClick={() => openAccount()}>
                Add account
              </button>
            }
          />
        </section>
      )}
      {archivedCount > 0 && (
        <div>
          <button
            className="chip"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(!showArchived)}
          >
            Show {archivedCount} archived
          </button>
        </div>
      )}
      <p className="faint" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
        UPI payments are recorded on the account they come from — your bank, a RuPay credit card, or
        UPI Lite.
      </p>
    </div>
  );
}
