import { useMemo } from 'react';
import {
  Amount,
  CategoryAvatar,
  EmptyState,
  MonthSwitcher,
  Panel,
  Progress,
  StatusPill,
} from '../design/components';
import {
  addMonths,
  formatDate,
  formatMonth,
  monthOf,
  monthRange,
  parseDate,
  ymd,
} from '../domain/dates';
import {
  billReserve,
  calendarVsStatement,
  cardSnapshot,
  summarise,
  summariseMonth,
} from '../domain/ledger';
import { formatINR } from '../domain/money';
import { Icon } from '../design/Icon';
import { useStore } from '../store';
import { useUI } from '../ui';
import { TxnRow } from './TxnRow';

export function Home({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { transactions: txns, accounts, categoryById, today, subscriptions, inboxNew } = useStore();
  const { go, openTxn } = useUI();
  const cards = accounts.filter((a) => a.card && !a.archived);
  const isCurrent = month === monthOf(today);

  const s = useMemo(() => summariseMonth(txns, month), [txns, month]);
  // Compare with the same point last month, so a half-finished month is not compared to a full one.
  const prev = useMemo(() => {
    const pm = addMonths(month, -1);
    if (!isCurrent) return summariseMonth(txns, pm);
    const [py, pmm] = parseDate(`${pm}-01`);
    const day = Math.min(Number(today.slice(8)), Number(monthRange(pm).end.slice(8)));
    return summarise(txns, `${pm}-01`, ymd(py, pmm, day));
  }, [txns, month, isCurrent, today]);
  const delta = s.spent - prev.spent;

  const topCats = [...s.byCategory.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxCat = topCats[0]?.[1] ?? 1;
  const cvs = cards.map((c) => ({
    card: c,
    v: calendarVsStatement(c, txns, month),
    snap: cardSnapshot(c, txns, today),
  }));
  const reserve = billReserve(accounts, txns, today);
  const recent = txns
    .filter((t) => monthOf(t.date) === month)
    .slice(-6)
    .reverse();
  const upcoming = subscriptions
    .filter((x) => x.active && x.nextDate >= today)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))
    .slice(0, 3);
  const cardSpend = cvs.reduce((n, x) => n + x.v.spentThisMonth, 0);

  return (
    <div className="page">
      <div className="page-head">
        <MonthSwitcher month={month} onChange={setMonth} max={monthOf(today)} />
      </div>

      {inboxNew > 0 && (
        <button className="inbox-banner" onClick={() => go('inbox')}>
          <Icon name="inbox" size={18} />
          <span>
            <b>
              {inboxNew} bank message{inboxNew === 1 ? '' : 's'}
            </b>{' '}
            waiting for review
          </span>
          <span className="spacer" />
          <Icon name="right" size={16} />
        </button>
      )}

      <section className="hero" aria-label="Spending this month">
        <span className="label">
          {isCurrent ? 'Spent so far in ' : 'Spent in '}
          {formatMonth(month, 'short')}
        </span>
        <span className="hero-amount num">{formatINR(s.spent)}</span>
        <span className="muted">
          {delta <= 0 ? `${formatINR(-delta)} less` : `${formatINR(delta)} more`} than{' '}
          {formatMonth(addMonths(month, -1), 'short')}
          {isCurrent ? ' by this date' : ''}
        </span>
        <div className="hero-stats">
          <div className="stat">
            <div className="label">Income</div>
            <div className="v">
              <Amount value={s.income} kind="income" />
            </div>
          </div>
          <div className="stat">
            <div className="label">Saved</div>
            <div className="v num">{formatINR(s.net)}</div>
          </div>
          <div className="stat">
            <div className="label">On credit cards</div>
            <div className="v num">{formatINR(cardSpend)}</div>
          </div>
        </div>
      </section>

      {cards.length > 0 && (
        <Panel
          title="This month vs your card statements"
          action={
            <button className="btn btn-ghost" onClick={() => go('accounts')}>
              Cards
            </button>
          }
        >
          <div className="stack">
            <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
              Card spending is counted on the day you spent it. Here is where{' '}
              {formatMonth(month, 'short')}'s card spending will be billed.
            </p>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--cycle)' }} />
                On the statement closing this month
              </span>
              <span>
                <i
                  style={{
                    background:
                      'repeating-linear-gradient(135deg, var(--cycle) 0 2px, var(--cycle-soft) 2px 5px)',
                  }}
                />
                Rolls to next month's statement
              </span>
            </div>
            {cvs.map(({ card, v }) => {
              const total = Math.max(v.spentThisMonth, 1);
              return (
                <button key={card.id} className="item" onClick={() => go(`card-${card.id}`)}>
                  <div className="item-main stack" style={{ gap: 6 }}>
                    <div className="row">
                      <span className="item-title">{card.name}</span>
                      <span className="spacer" />
                      <span className="num">{formatINR(v.spentThisMonth)}</span>
                    </div>
                    <div className="split-bar">
                      <span
                        className="now"
                        style={{ width: `${(v.onThisMonthsStatement / total) * 100}%` }}
                      />
                      <span
                        className="next"
                        style={{ width: `${(v.onNextStatement / total) * 100}%` }}
                      />
                    </div>
                    <div className="item-sub">
                      {formatINR(v.onThisMonthsStatement)} on {formatDate(v.closingPeriod.end)}{' '}
                      statement · {formatINR(v.onNextStatement)} rolls over
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="note note-ok">
              {formatINR(reserve.owedToCards)} of the {formatINR(reserve.cash)} in your accounts is
              already owed to cards. Free to spend: <b>{formatINR(reserve.freeToSpend)}</b>.
            </div>
          </div>
        </Panel>
      )}

      <div className="grid-2">
        <Panel
          title="Where it went"
          action={
            <button className="btn btn-ghost" onClick={() => go('insights')}>
              Insights
            </button>
          }
        >
          <div className="stack">
            {topCats.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                No spending in {formatMonth(month, 'short')} yet.
              </p>
            )}
            {topCats.map(([id, amt]) => {
              const c = categoryById.get(id);
              return (
                <div key={id} className="row">
                  <CategoryAvatar category={c} small />
                  <div className="item-main stack" style={{ gap: 4 }}>
                    <div className="row">
                      <span style={{ fontWeight: 500 }}>{c?.name ?? 'Uncategorised'}</span>
                      <span className="spacer" />
                      <span className="num">{formatINR(amt)}</span>
                    </div>
                    <Progress value={amt / maxCat} color={`var(--${c?.color ?? 'cat-6'})`} thin />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Coming up">
          <div className="list">
            {upcoming.length === 0 && !cvs.some((x) => x.snap.dueNow > 0) && (
              <p className="muted" style={{ margin: 0 }}>
                No bills or subscriptions due.
              </p>
            )}
            {cvs
              .filter((x) => x.snap.dueNow > 0)
              .map(({ card, snap }) => (
                <div key={card.id} className="item">
                  <div className="item-main">
                    <div className="item-title">{card.name} bill</div>
                    <div className="item-sub">
                      Due {formatDate(snap.dueDate!)} · in {snap.daysToDue} days
                    </div>
                  </div>
                  <StatusPill status={snap.dueStatus} />
                  <span className="num">{formatINR(snap.dueNow)}</span>
                </div>
              ))}
            {upcoming.map((x) => (
              <div key={x.id} className="item">
                <CategoryAvatar category={categoryById.get(x.categoryId)} small />
                <div className="item-main">
                  <div className="item-title">{x.name}</div>
                  <div className="item-sub">
                    {formatDate(x.nextDate)} · {x.autoPay ? 'Auto-pay' : 'Pay manually'}
                  </div>
                </div>
                <span className="num">{formatINR(x.amount)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="Recent"
        action={
          <button className="btn btn-ghost" onClick={() => go('transactions')}>
            See all
          </button>
        }
      >
        {recent.length === 0 && (
          <EmptyState
            title="Nothing logged this month"
            body="Add what you spend as you go — it takes three taps."
            action={
              <button className="btn btn-primary" onClick={() => openTxn()}>
                Add expense
              </button>
            }
          />
        )}
        <div className="list">
          {recent.map((t) => (
            <TxnRow key={t.id} t={t} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
