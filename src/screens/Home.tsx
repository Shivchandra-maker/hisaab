import { useMemo } from 'react';
import { catchUp } from '../native/capture';
import { usePullToRefresh } from '../design/usePullToRefresh';
import {
  Amount,
  CategoryAvatar,
  Delta,
  EmptyState,
  MonthSwitcher,
  PaceChart,
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
  relativeDay,
  ymd,
} from '../domain/dates';
import {
  billReserve,
  calendarVsStatement,
  cardSnapshot,
  dailySpend,
  summarise,
  summariseMonth,
} from '../domain/ledger';
import { formatINR } from '../domain/money';
import { Icon } from '../design/Icon';
import { needsHeadline } from '../db/needs';
import { useStore } from '../store';
import { setMeta } from '../db/repo';
import { useUI } from '../ui';
import { TxnRow } from './TxnRow';
import { shopsToSort } from '../domain/sms/shops';

export function Home({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const {
    transactions: txns,
    accounts,
    categoryById,
    today,
    subscriptions,
    inboxNew,
    needs,
    rules,
    meta,
  } = useStore();
  const toSort = useMemo(() => shopsToSort(txns, rules).shops.length, [txns, rules]);
  const { go, openTxn, toast } = useUI();
  const pull = usePullToRefresh(async () => {
    const n = await catchUp(3);
    toast(n ? `${n} new payment${n === 1 ? '' : 's'}` : 'Up to date');
  });
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
  const prevName = formatMonth(addMonths(month, -1), 'short');
  const daily = useMemo(() => dailySpend(txns, month), [txns, month]);
  const prevDaily = useMemo(() => dailySpend(txns, addMonths(month, -1)), [txns, month]);
  const upTo = isCurrent ? Number(today.slice(8)) : daily.length;
  // D-04: in the first days of a month the line is a stub — the pill above already compares
  // with last month, so the chart waits until there's a shape to show.
  const hasPace =
    (daily.some((v) => v > 0) || prevDaily.some((v) => v > 0)) && !(isCurrent && upTo < 5);
  const [rupee, ...digits] = formatINR(s.spent);

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
  // "Coming up" is about the real future, so it only shows on the current month.
  const upcoming = subscriptions
    .filter((x) => isCurrent && x.active && x.nextDate >= today)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))
    .slice(0, 3);
  const cardSpend = cvs.reduce((n, x) => n + x.v.spentThisMonth, 0);
  const dueCards = isCurrent ? cvs.filter((x) => x.snap.dueNow > 0) : [];
  const anyRollover = cvs.some((x) => x.v.onNextStatement > 0);

  // D-02: say what it is ("New account found · ICICI Credit Card ••5566"), not just a count.
  const headline = needsHeadline(needs);
  return (
    <div className="page">
      {pull.indicator}
      <div className="page-head">
        <MonthSwitcher month={month} onChange={setMonth} max={monthOf(today)} />
        <span className="spacer" />
        <button
          className="icon-btn bell-btn"
          aria-label={inboxNew ? `Inbox: ${inboxNew} need you` : 'Inbox'}
          onClick={() => go('inbox')}
        >
          <Icon name="inbox" size={20} />
          {inboxNew > 0 && <span className="badge badge-dot">{inboxNew}</span>}
        </button>
      </div>

      {inboxNew > 0 && (
        <button className="inbox-banner" onClick={() => go('inbox')}>
          <Icon name="inbox" size={18} />
          <span>
            <b>{headline?.title}</b> {headline?.detail}
          </span>
          <span className="spacer" />
          <Icon name="right" size={16} />
        </button>
      )}
      {inboxNew === 0 && toSort >= 3 && (
        <button className="inbox-banner" onClick={() => go('sort')}>
          <Icon name="sparkle" size={18} />
          <span>
            <b>Where does your money go?</b> {toSort} shops to sort
          </span>
          <span className="spacer" />
          <Icon name="right" size={16} />
        </button>
      )}

      <section className="hero" aria-label="Spending this month">
        <div className="row">
          <span className="label">
            {isCurrent ? 'Spent so far in ' : 'Spent in '}
            {formatMonth(month, 'short')}
          </span>
          <span className="spacer" />
          <button
            className="icon-btn hero-eye"
            aria-pressed={meta.hideAmounts === true}
            aria-label={meta.hideAmounts === true ? 'Show amounts' : 'Hide amounts'}
            onClick={() => void setMeta('hideAmounts', meta.hideAmounts !== true)}
          >
            <Icon name={meta.hideAmounts === true ? 'eye-off' : 'eye'} size={18} />
          </button>
        </div>
        <span className="hero-amount num" aria-label={formatINR(s.spent)}>
          <span className="cur">{rupee}</span>
          {digits.join('')}
        </span>
        {(s.spent > 0 || prev.spent > 0) && (
          <Delta value={delta} suffix={`${prevName}${isCurrent ? ' by this date' : ''}`} />
        )}
        {hasPace && (
          <div className="pace-box">
            <PaceChart
              current={daily}
              previous={prevDaily}
              upTo={upTo}
              height={96}
              label={`Running total of spending in ${formatMonth(month)} compared with ${prevName}`}
            />
            <div className="legend">
              <span>
                <i className="lg-line" />
                {formatMonth(month, 'short')}
              </span>
              <span>
                <i className="lg-dash" />
                {prevName}
              </span>
            </div>
          </div>
        )}
        <div className="hero-stats">
          <div className="stat">
            <div className="label">Income</div>
            <div className="v">
              <Amount value={s.income} kind={s.income > 0 ? 'income' : undefined} />
            </div>
          </div>
          <div className="stat">
            <div className="label">{s.net < 0 ? 'Over income' : 'Saved'}</div>
            <div className="v num">{formatINR(Math.abs(s.net))}</div>
          </div>
          {s.invested > 0 && (
            <div className="stat">
              <div className="label">Invested</div>
              <div className="v num">{formatINR(s.invested)}</div>
            </div>
          )}
          {cards.length > 0 && (
            <div className="stat">
              <div className="label">On cards</div>
              <div className="v num">{formatINR(cardSpend)}</div>
            </div>
          )}
        </div>
      </section>

      {cards.length > 0 && (
        <Panel
          title="Card spending by statement"
          action={
            <button className="btn btn-ghost" onClick={() => go('accounts')}>
              Cards
            </button>
          }
        >
          <div className="stack">
            {anyRollover && (
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
                  Next month’s statement
                </span>
              </div>
            )}
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
                      {v.spentThisMonth === 0
                        ? isCurrent
                          ? `No spending yet · statement on ${formatDate(v.closingPeriod.end)}`
                          : `No card spending in ${formatMonth(month, 'short')}`
                        : v.onNextStatement === 0
                          ? `All on the ${formatDate(v.closingPeriod.end)} statement`
                          : v.onThisMonthsStatement === 0
                            ? 'All on next month’s statement'
                            : `${formatINR(v.onThisMonthsStatement)} on ${formatDate(v.closingPeriod.end)} statement · ${formatINR(v.onNextStatement)} on the next`}
                    </div>
                  </div>
                </button>
              );
            })}
            {isCurrent && (
              <div className="note note-ok free-note">
                <span>
                  <span className="label">Free to spend</span>
                  <b className="num">{formatINR(reserve.freeToSpend)}</b>
                </span>
                <span>
                  after keeping {formatINR(reserve.owedToCards)} aside for card bills, out of{' '}
                  {formatINR(reserve.cash)} in your accounts.
                </span>
              </div>
            )}
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
                      <span className="cat-name">{c?.name ?? 'Uncategorised'}</span>
                      <span className="faint share">
                        {Math.round((amt / Math.max(1, s.spent)) * 100)}%
                      </span>
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
            {!isCurrent && (
              <p className="muted" style={{ margin: 0 }}>
                Upcoming bills show when you’re on {formatMonth(monthOf(today), 'short')}.
              </p>
            )}
            {isCurrent && upcoming.length === 0 && dueCards.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                Nothing due. Card bills and subscriptions will show here.
              </p>
            )}
            {dueCards.map(({ card, snap }) => (
              <div key={card.id} className="item">
                <div className="item-main">
                  <div className="item-title">{card.name} bill</div>
                  <div className="item-sub">
                    Due {formatDate(snap.dueDate!)} · {relativeDay(today, snap.dueDate!)}
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
                    {formatDate(x.nextDate)} · {relativeDay(today, x.nextDate)} ·{' '}
                    {x.autoPay ? 'Auto-pay' : 'Pay manually'}
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
            body={
              isCurrent
                ? 'Add what you spend as you go — amount, category, done.'
                : `Nothing was recorded in ${formatMonth(month)}.`
            }
            action={
              <button className="btn btn-primary" onClick={() => openTxn()}>
                Add expense
              </button>
            }
          />
        )}
        <div className="list">
          {recent.map((t) => (
            <TxnRow key={t.id} t={t} showDate />
          ))}
        </div>
      </Panel>
    </div>
  );
}
