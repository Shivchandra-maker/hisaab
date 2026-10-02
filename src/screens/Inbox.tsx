import { useMemo, useState } from 'react';
import { ConfirmButton, EmptyState, ErrorNote, Field, Panel } from '../design/components';
import { Icon } from '../design/Icon';
import { formatDate } from '../domain/dates';
import { formatINR, toPaise, toRupees } from '../domain/money';
import { suggest, type Suggestion } from '../domain/sms/match';
import type { InboxItem, TxnKind } from '../domain/types';
import {
  addAllReady,
  addFromInbox,
  clearHandled,
  dismissNotice,
  ignoreInboxItem,
  ingestMessages,
  restoreInboxItem,
  type IngestSummary,
} from '../db/inbox';
import { useStore } from '../store';
import { useUI } from '../ui';

const kindLabel: Record<string, string> = {
  expense: 'Spending',
  income: 'Income',
  refund: 'Refund',
  transfer: 'Transfer',
};

function summaryText(s: IngestSummary): string {
  const parts = [
    s.toReview && `${s.toReview} to review`,
    s.duplicates && `${s.duplicates} already recorded`,
    s.notices && `${s.notices} autopay/EMI notice${s.notices > 1 ? 's' : ''}`,
    s.ignored && `${s.ignored} skipped (OTP, promotion or declined)`,
    s.alreadySeen && `${s.alreadySeen} pasted before`,
  ].filter(Boolean);
  return `Read ${s.read} message${s.read === 1 ? '' : 's'}: ${parts.join(' · ') || 'nothing new'}.`;
}

/** Paste bank SMS → review → one tap to add. */
export function Inbox() {
  const { inbox, accounts, rules, transactions, today, meta } = useStore();
  const { toast } = useUI();
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const fresh = inbox.filter((i) => i.status === 'new');
  const dups = inbox.filter((i) => i.status === 'duplicate');
  const notices = inbox.filter((i) => i.status === 'notice');
  const handled = inbox.filter((i) => i.status === 'added' || i.status === 'ignored');

  const suggestions = useMemo(() => {
    const ctx = {
      accounts,
      rules,
      transactions,
      accountHints: (meta.accountHints as Record<string, string>) ?? {},
    };
    return new Map(
      fresh.map((i) => [i.id, suggest(i.parsed, { ...ctx, receivedAt: i.receivedAt })]),
    );
  }, [fresh, accounts, rules, transactions, meta.accountHints]);
  const readyCount = [...suggestions.values()].filter((s) => s.ready).length;

  const read = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const s = await ingestMessages(text, { source: 'paste', receivedAt: today });
      setResult(summaryText(s));
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
            Bank messages turn into transactions here. Nothing is added until you say so.
          </p>
        </div>
      </div>

      <Panel title="Paste bank SMS">
        <div className="stack">
          <label className="sr-only" htmlFor="sms-paste">
            Messages
          </label>
          <textarea
            id="sms-paste"
            className="input paste-box"
            rows={fresh.length ? 3 : 6}
            placeholder={
              'Copy one or more messages from your SMS app and paste them here.\nLeave a blank line between messages.'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={read} disabled={busy || !text.trim()}>
              Read messages
            </button>
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              Read on this device only. OTPs, offers and declined payments are skipped.
            </span>
          </div>
          {result && (
            <div className="note note-ok" role="status">
              {result}
            </div>
          )}
        </div>
      </Panel>

      {fresh.length > 0 && (
        <section className="stack" aria-label="To review">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 'var(--fs-md)' }}>To review ({fresh.length})</h2>
            <span className="spacer" />
            {readyCount > 0 && (
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const n = await addAllReady();
                  toast(`Added ${n} transaction${n === 1 ? '' : 's'}`);
                }}
              >
                <Icon name="check" size={16} />
                Add {readyCount} ready
              </button>
            )}
          </div>
          {fresh.map((i) => (
            <ReviewCard key={`${i.id}-${accounts.length}`} item={i} s={suggestions.get(i.id)!} />
          ))}
        </section>
      )}

      {fresh.length === 0 && inbox.length === 0 && (
        <section className="panel">
          <EmptyState
            title="Nothing to review"
            body="Paste a few bank or card messages above. Hisaab reads the amount, account, merchant and date, and suggests a category. The Android app (next phase) will do this automatically."
          />
        </section>
      )}

      {dups.length > 0 && (
        <Panel title={`Probably already recorded (${dups.length})`}>
          <div className="list">
            {dups.map((i) => (
              <DuplicateRow key={i.id} item={i} />
            ))}
          </div>
        </Panel>
      )}

      {notices.length > 0 && (
        <Panel title={`Autopay & EMI notices (${notices.length})`}>
          <p className="faint" style={{ margin: '0 0 8px', fontSize: 'var(--fs-sm)' }}>
            These aren’t payments yet. Autopay and EMI tracking will use them in the coming phases.
          </p>
          <div className="list">
            {notices.map((i) => (
              <NoticeRow key={i.id} item={i} />
            ))}
          </div>
        </Panel>
      )}

      {handled.length > 0 && (
        <details className="panel">
          <summary className="row" style={{ cursor: 'pointer' }}>
            <b>Handled ({handled.length})</b>
          </summary>
          <div className="list" style={{ marginTop: 8 }}>
            {handled.slice(0, 50).map((i) => (
              <div key={i.id} className="item">
                <div className="item-main">
                  <div className="item-title">
                    {i.parsed.merchant ??
                      (i.parsed.amount ? formatINR(i.parsed.amount) : i.rawText.slice(0, 40))}
                  </div>
                  <div className="item-sub">
                    {i.status === 'added' ? 'Added' : (i.note ?? 'Ignored')} ·{' '}
                    {i.rawText.slice(0, 70)}
                  </div>
                </div>
                {i.status === 'ignored' && i.parsed.kind !== 'ignore' && (
                  <button className="btn" onClick={() => restoreInboxItem(i.id)}>
                    Review again
                  </button>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <ConfirmButton
              label="Clear handled messages"
              confirmLabel="Tap again to clear"
              onConfirm={async () => toast(`Cleared ${await clearHandled()}`)}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function ReviewCard({ item, s }: { item: InboxItem; s: Suggestion }) {
  const { activeAccounts, categories, accountById } = useStore();
  const { openAccount, toast } = useUI();
  const [kind, setKind] = useState<TxnKind>(s.kind);
  const [amount, setAmount] = useState(String(toRupees(s.amount)));
  const [accountId, setAccountId] = useState(s.accountId ?? '');
  const [toAccountId, setToAccountId] = useState(s.toAccountId ?? '');
  const [categoryId, setCategoryId] = useState(s.categoryId ?? '');
  const [merchant, setMerchant] = useState(s.merchant ?? '');
  const [date, setDate] = useState(s.date);
  const [error, setError] = useState('');
  const p = item.parsed;

  const catKind = kind === 'income' ? 'income' : 'expense';
  const cats = categories.filter((c) => c.kind === catKind && !c.archived);

  const add = async () => {
    try {
      setError('');
      if (!accountId) throw new Error('Choose the account.');
      if (kind === 'transfer' && !toAccountId) throw new Error('Choose where the money went.');
      await addFromInbox(item.id, {
        kind,
        amount: toPaise(amount || '0'),
        date,
        accountId,
        toAccountId: kind === 'transfer' ? toAccountId : undefined,
        categoryId: kind === 'transfer' ? undefined : categoryId || undefined,
        merchant: kind === 'transfer' ? undefined : merchant.trim() || undefined,
        paymentMode: s.paymentMode,
        externalRef: s.externalRef,
      });
      toast(`Added ${merchant || kindLabel[kind]}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add.');
    }
  };

  const createAccount = () =>
    openAccount({
      kind:
        p.instrument === 'credit_card'
          ? 'credit_card'
          : p.instrument === 'upi_lite' || p.instrument === 'wallet'
            ? 'wallet'
            : 'bank',
      last4: s.unknownLast4,
      institution: p.bank,
      name: p.bank
        ? `${p.bank.replace(/ Bank$/, '')} ${p.instrument === 'credit_card' ? 'Card' : 'Account'}`
        : '',
    });

  const hints = [
    s.accountMatch === 'last4' && accountId === s.accountId && `Matched •• ${p.last4}`,
    s.accountMatch === 'only-one' && 'Your only bank account',
    s.accountMatch === 'wallet' && `${p.walletName ?? 'Wallet'} payment`,
    s.accountMatch === 'remembered' && 'Account you chose for similar messages',
    s.categorySource === 'fallback' && 'Unknown merchant — set a category once and it’s remembered',
    s.categorySource === 'rule' && 'Category from your past choice',
    s.categorySource === 'built-in' && 'Category guessed from merchant',
    p.ref && `Ref ${p.ref}`,
    p.balance !== undefined &&
      `${p.balanceIsLimit ? 'Limit left' : 'Balance'} ${formatINR(p.balance)}`,
  ].filter(Boolean);

  return (
    <article className="panel review-card">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span
          className={`num review-amount ${kind === 'income' || kind === 'refund' ? 'amt-income' : kind === 'transfer' ? 'amt-transfer' : ''}`}
        >
          {kind === 'income' || kind === 'refund' ? '+' : ''}
          {formatINR(toPaise(amount || '0'))}
        </span>
        <span
          className={`pill ${kind === 'transfer' ? 'pill-neutral' : kind === 'expense' ? 'pill-cycle' : 'pill-ok'}`}
        >
          {p.kind === 'card_payment'
            ? 'Card bill payment'
            : p.isAtm
              ? 'ATM withdrawal'
              : kindLabel[kind]}
        </span>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          {formatDate(date, 'weekday')}
          {!p.date && ' (received)'}
        </span>
      </div>

      <div className="grid-2 review-fields">
        {kind !== 'transfer' && (
          <Field label={kind === 'income' ? 'From' : 'Paid to'} htmlFor={`m-${item.id}`}>
            <input
              id={`m-${item.id}`}
              className="input"
              value={merchant}
              placeholder="Merchant or person"
              onChange={(e) => setMerchant(e.target.value)}
            />
          </Field>
        )}
        {kind !== 'transfer' && (
          <Field label="Category" htmlFor={`c-${item.id}`}>
            <select
              id={`c-${item.id}`}
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Choose…</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? `  ${c.name}` : c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label={
            kind === 'transfer'
              ? 'From'
              : kind === 'income' || kind === 'refund'
                ? 'Into'
                : 'Paid from'
          }
          htmlFor={`a-${item.id}`}
        >
          <select
            id={`a-${item.id}`}
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Choose account…</option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.last4 ? ` •• ${a.last4}` : ''}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'transfer' && (
          <Field label="To" htmlFor={`t-${item.id}`}>
            <select
              id={`t-${item.id}`}
              className="input"
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
            >
              <option value="">Choose account…</option>
              {activeAccounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Type" htmlFor={`k-${item.id}`}>
          <select
            id={`k-${item.id}`}
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as TxnKind)}
          >
            <option value="expense">Spending</option>
            <option value="income">Income</option>
            <option value="refund">Refund</option>
            <option value="transfer">Transfer between my accounts</option>
          </select>
        </Field>
        <div className="grid-2" style={{ gap: 'var(--sp-3)' }}>
          <Field label="Amount" htmlFor={`v-${item.id}`}>
            <input
              id={`v-${item.id}`}
              className="input num"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </Field>
          <Field label="Date" htmlFor={`d-${item.id}`}>
            <input
              id={`d-${item.id}`}
              type="date"
              className="input"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {s.unknownLast4 && !accountId && (
        <div className="note note-cycle row" style={{ flexWrap: 'wrap' }}>
          <span>
            No account ends in {s.unknownLast4}
            {p.bank ? ` (${p.bank})` : ''}.
          </span>
          <span className="spacer" />
          <button className="btn" onClick={createAccount}>
            Add this {p.instrument === 'credit_card' ? 'card' : 'account'}
          </button>
        </div>
      )}
      {!s.unknownLast4 && !s.accountId && (
        <div className="note note-cycle">
          This message doesn’t say which account it’s from. Choose it once — Hisaab remembers it for
          similar messages.
        </div>
      )}
      {p.isWalletTopUp && (
        <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          Wallet top-up — moves money into your {p.walletName ?? ''} wallet, not counted as
          spending. Payments you make from the wallet are recorded separately.
        </div>
      )}
      {kind === 'transfer' && accountById.get(toAccountId)?.kind === 'credit_card' && (
        <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          Card bill payment — moves money to the card, not counted as spending.
        </div>
      )}

      <details className="raw-sms">
        <summary className="faint">{hints.join(' · ') || 'Original message'}</summary>
        <pre>{item.rawText}</pre>
      </details>

      <ErrorNote message={error} />
      <div className="row">
        <button className="btn" onClick={() => ignoreInboxItem(item.id)}>
          Ignore
        </button>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={add}>
          Add
        </button>
      </div>
    </article>
  );
}

function DuplicateRow({ item }: { item: InboxItem }) {
  const { transactions, accountById } = useStore();
  const t = transactions.find((x) => x.id === item.duplicateOf);
  return (
    <div className="item" style={{ flexWrap: 'wrap' }}>
      <div className="item-main">
        <div className="item-title">
          {item.parsed.merchant ?? 'Message'} · {formatINR(item.parsed.amount ?? 0)}
        </div>
        <div className="item-sub">
          {item.note}
          {t
            ? ` — you have ${formatINR(t.amount)} on ${formatDate(t.date)} in ${accountById.get(t.accountId)?.name ?? 'an account'}`
            : ''}
        </div>
      </div>
      <button className="btn" onClick={() => ignoreInboxItem(item.id)}>
        Dismiss
      </button>
      <button className="btn" onClick={() => restoreInboxItem(item.id)}>
        It’s new — review
      </button>
    </div>
  );
}

function NoticeRow({ item }: { item: InboxItem }) {
  const p = item.parsed;
  const bits = [
    p.merchant,
    p.amount !== undefined && formatINR(p.amount),
    p.kind === 'emi_notice' &&
      p.emiMonths &&
      `${p.emiMonths} EMIs${p.emiAmount ? ` of ${formatINR(p.emiAmount)}` : ''}`,
    p.scheduledDate && `on ${formatDate(p.scheduledDate)}`,
    p.frequency,
    p.last4 && `•• ${p.last4}`,
  ].filter(Boolean);
  return (
    <div className="item">
      <span
        className="avatar avatar-sm"
        style={{ background: 'var(--surface-2)', color: 'var(--fg-2)' }}
      >
        <Icon name={p.kind === 'emi_notice' ? 'calendar' : 'repeat'} size={15} />
      </span>
      <div className="item-main">
        <div className="item-title">{item.note}</div>
        <div className="item-sub">{bits.join(' · ')}</div>
      </div>
      <button className="btn" onClick={() => dismissNotice(item.id)}>
        Dismiss
      </button>
    </div>
  );
}
