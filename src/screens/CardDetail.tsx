import { BackLink, Panel, StatusPill } from '../design/components';
import { BankCheck } from './BankCheck';
import { periodClosingIn, recentPeriods, type StatementPeriod } from '../domain/cycle';
import {
  addMonths,
  ordinal,
  daysBetween,
  formatDate,
  formatMonth,
  inRange,
  monthOf,
  monthRange,
} from '../domain/dates';
import { cardSnapshot, counted, statementFor } from '../domain/ledger';
import { formatINR } from '../domain/money';
import type { Account } from '../domain/types';
import { useState } from 'react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { AdjustSheet } from './AccountSheet';
import { TxnRow } from './TxnRow';

/** Two calendar months with the statement periods laid over them: the core idea of Hisaab, drawn. */
function PeriodTimeline({
  card,
  current,
  today,
}: {
  card: Account;
  current: StatementPeriod;
  today: string;
}) {
  const m1 = monthOf(current.start);
  const m2 = monthOf(current.end);
  const w0 = monthRange(m1).start;
  const w1 = monthRange(m2).end;
  const total = daysBetween(w0, w1) + 1;
  const pos = (d: string) => (Math.max(0, Math.min(total, daysBetween(w0, d))) / total) * 100;
  const seg = (start: string, end: string) => {
    const s = start < w0 ? w0 : start;
    const e = end > w1 ? w1 : end;
    return { left: `${pos(s)}%`, width: `${((daysBetween(s, e) + 1) / total) * 100}%` };
  };
  const prev = periodClosingIn(card.card!, addMonths(current.closesIn, -1));
  const next = periodClosingIn(card.card!, addMonths(current.closesIn, 1));
  const months = m1 === m2 ? [m1] : [m1, m2];
  return (
    <div className="timeline" aria-label="Calendar months compared with statement periods">
      <div className="label">Calendar month</div>
      <div className="tl-track">
        {months.map((m) => (
          <div
            key={m}
            className="tl-seg tl-month"
            style={seg(monthRange(m).start, monthRange(m).end)}
          >
            {formatMonth(m, 'short')}
          </div>
        ))}
        <div className="tl-today" style={{ left: `${pos(today)}%` }} title="Today" />
      </div>
      <div className="label">Statement period</div>
      <div className="tl-track">
        {[prev, current, next].map((p) =>
          p.end < w0 || p.start > w1 ? null : (
            <div
              key={p.closesIn}
              className="tl-seg tl-period"
              style={{ ...seg(p.start, p.end), opacity: p === current ? 1 : 0.45 }}
            >
              {p === current ? `${formatDate(p.start)} – ${formatDate(p.end)}` : ''}
            </div>
          ),
        )}
        <div className="tl-today" style={{ left: `${pos(today)}%` }} />
      </div>
      {/* D-08: "Today" sits under the today line, not in the middle whatever the date. */}
      <div className="tl-axis">
        <span>{formatDate(w0)}</span>
        <span
          className="tl-today-label"
          style={{ left: `${Math.min(88, Math.max(12, pos(today)))}%` }}
        >
          Today
        </span>
        <span>{formatDate(w1)}</span>
      </div>
    </div>
  );
}

export function CardDetail({ id }: { id: string }) {
  const { accountById, transactions: txns, today, accounts } = useStore();
  const { go, openAccount, openTxn } = useUI();
  const [adjusting, setAdjusting] = useState(false);
  const card = accountById.get(id);
  if (!card?.card) return <p>Card not found.</p>;
  const s = cardSnapshot(card, txns, today);
  const statements = recentPeriods(card.card, today, 5).map((p) =>
    statementFor(card, txns, p, today),
  );
  const unbilledTxns = txns
    .filter(
      (t) => counted(t) && t.accountId === card.id && inRange(t.date, s.currentPeriod.start, today),
    )
    .reverse();
  const payFrom =
    (card.card.paymentAccountId && accountById.get(card.card.paymentAccountId)) ||
    accounts.find((a) => a.kind === 'bank');

  return (
    <div className="page">
      <BackLink label="Accounts" onClick={() => go('accounts')} />
      <div className="page-head">
        <div className="row">
          <h1>{card.name}</h1>
          {card.last4 && <span className="faint">•• {card.last4}</span>}
        </div>
        <div className="row">
          <button className="btn" onClick={() => openAccount(card)}>
            Edit
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              openTxn({
                kind: 'transfer',
                accountId: payFrom?.id,
                toAccountId: card.id,
                amount: s.dueNow || s.owed || undefined,
                note: `${card.name} bill`,
                paymentMode: 'netbanking',
              })
            }
          >
            Pay bill
          </button>
        </div>
      </div>

      <section className="card-tile" aria-label="Card summary">
        <div className="three">
          <div>
            <div className="label">Due now</div>
            <div className="v num">{formatINR(s.dueNow)}</div>
            <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.85 }}>
              {s.dueNow > 0 ? `by ${formatDate(s.dueDate!)}` : 'Nothing due'}
            </div>
          </div>
          <div>
            <div className="label">Unbilled</div>
            <div className="v num">{formatINR(s.unbilled)}</div>
            <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.85 }}>
              bills on {formatDate(s.currentPeriod.end)}
            </div>
          </div>
          <div>
            <div className="label">Total owed</div>
            <div className="v num">{formatINR(Math.max(0, s.owed))}</div>
            <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.85 }}>
              {s.owed < 0
                ? `${formatINR(-s.owed)} credit on the card`
                : `${formatINR(s.available)} available`}
            </div>
          </div>
        </div>
        <div className="bar bar-thin" style={{ background: 'rgb(255 255 255 / 0.25)' }}>
          <span
            style={{ width: `${Math.min(100, s.utilisation * 100)}%`, background: 'currentColor' }}
          />
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', opacity: 0.85 }}>
          {Math.round(s.utilisation * 100)}% of {formatINR(card.card.creditLimit)} limit · statement
          on the {ordinal(card.card.statementDay)} · due {card.card.dueDaysAfterStatement} days
          later · paid from {payFrom?.name}
        </div>
      </section>

      <details className="explain">
        <summary>What do these numbers mean?</summary>
        <dl>
          <dt>Due now</dt>
          <dd>What’s still unpaid on your last bill (statement). Pay it by the due date.</dd>
          <dt>Unbilled</dt>
          <dd>
            Spent on the card since the last bill. It goes on the next bill, on{' '}
            {formatDate(s.currentPeriod.end)}.
          </dd>
          <dt>Total owed</dt>
          <dd>
            Everything you owe the card today — the unpaid bill plus unbilled spending
            {s.dueNow > 0 || s.unbilled > 0
              ? ` (${formatINR(s.dueNow)} + ${formatINR(Math.max(0, s.unbilled))} ≈ ${formatINR(Math.max(0, s.owed))})`
              : ''}
            . When your bank’s messages say the available limit, Hisaab uses it: owed = credit limit
            − available limit.
          </dd>
        </dl>
      </details>

      <BankCheck account={card} />
      {card.check &&
        card.check.date >= s.currentPeriod.start &&
        (() => {
          // CRED-style unbilled from the bank's own numbers: owed − what's left on the last bill.
          const bankUnbilled = Math.max(0, card.check.amount - s.dueNow);
          const gap = bankUnbilled - s.unbilled;
          if (Math.abs(gap) < 100) return null;
          return (
            <div className="note note-warn">
              Your bank’s numbers put unbilled spending at about <b>{formatINR(bankUnbilled)}</b>;
              Hisaab found {formatINR(s.unbilled)} in your messages.{' '}
              {gap > 0
                ? `The ${formatINR(gap)} gap is usually an EMI instalment, a fee or a charge that had no SMS.`
                : `${formatINR(-gap)} more than the bank — check the list below for a payment counted twice.`}
            </div>
          );
        })()}

      <div className="row" style={{ marginTop: -8 }}>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={() => setAdjusting(true)}>
          Amount owed doesn’t match? Update it
        </button>
      </div>

      <Panel title="Statement period vs calendar month">
        <PeriodTimeline card={card} current={s.currentPeriod} today={today} />
      </Panel>

      <Panel title="Statements">
        <div className="list">
          {statements.map((st) => (
            <div key={st.period.closesIn} className="item">
              {/* D-08: one amount per statement — the bill (or what's built up so far). */}
              <div className="item-main">
                <div className="item-title">{formatMonth(st.period.closesIn)}</div>
                <div className="item-sub wrap">
                  {formatDate(st.period.start)} – {formatDate(st.period.end)}
                </div>
                <div className="item-sub wrap">
                  {st.status === 'open'
                    ? `Closes ${formatDate(st.period.end)}`
                    : st.remaining > 0
                      ? `${formatINR(st.remaining)} left · due ${formatDate(st.period.due)}`
                      : `Due ${formatDate(st.period.due)}`}
                </div>
              </div>
              <div className="item-amt stmt-amt">
                <div className="num">
                  {formatINR(st.status === 'open' ? s.unbilled : st.totalDue)}
                </div>
                <StatusPill status={st.status}>
                  {st.status === 'open' ? 'So far' : undefined}
                </StatusPill>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Unbilled"
        action={
          <span className="faint panel-note">
            {formatINR(s.unbilled)} · {unbilledTxns.length} payment
            {unbilledTxns.length === 1 ? '' : 's'}
          </span>
        }
      >
        <div className="list">
          {unbilledTxns.map((t) => (
            <TxnRow key={t.id} t={t} />
          ))}
        </div>
      </Panel>
      {adjusting && <AdjustSheet account={card} onClose={() => setAdjusting(false)} />}
    </div>
  );
}
