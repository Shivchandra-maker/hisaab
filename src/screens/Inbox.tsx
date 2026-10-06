import { useEffect, useState } from 'react';
import { CategoryAvatar, ConfirmButton, EmptyState, ErrorNote, Field } from '../design/components';
import { Icon } from '../design/Icon';
import { addDays, formatDate } from '../domain/dates';
import { cleanAmountInput, formatINR, toPaise, toRupees } from '../domain/money';
import { suggest, type Suggestion } from '../domain/sms/match';
import type { InboxItem, Transaction, TxnKind } from '../domain/types';
import {
  allSpentFor,
  openDebtsWith,
  resolvePersonPayment,
  splitWithFriends,
  suggestedChoice,
  type PersonChoice,
} from '../db/loans';
import { setMeta } from '../db/repo';
import {
  addAllReady,
  addFromInbox,
  clearHandled,
  ignoreInboxItem,
  ingestMessages,
  personKey,
  restoreInboxItem,
  type IngestSummary,
} from '../db/inbox';
import { needsDupCheck, useStore } from '../store';
import { foundAccountName } from '../db/needs';
import { Capture, isAndroidApp } from '../native/capture';
import { ContactsAllow } from './ContactsAllow';
import { refreshCheckpoints } from '../db/checkpoints';
import { useUI } from '../ui';

const kindLabel: Record<string, string> = {
  expense: 'Spending',
  income: 'Income',
  refund: 'Refund',
  transfer: 'Transfer',
};

function summaryText(s: IngestSummary, added = 0): string {
  const parts = [
    added && `${added} added`,
    s.toReview - added > 0 && `${s.toReview - added} need you`,
    s.duplicates && `${s.duplicates} already recorded`,
    s.notices && `${s.notices} autopay/EMI notice${s.notices > 1 ? 's' : ''}`,
    s.ignored && `${s.ignored} skipped (OTP, promotion or declined)`,
    s.alreadySeen && `${s.alreadySeen} pasted before`,
  ].filter(Boolean);
  return `Read ${s.read} message${s.read === 1 ? '' : 's'}: ${parts.join(' · ') || 'nothing new'}.`;
}

/** Inbox = only what needs you. Everything Hisaab understood is already added. */
export function Inbox() {
  const { inbox, accounts, transactions, today, meta, needs } = useStore();
  const { toast, go } = useUI();
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const autoAdd = meta.autoAdd !== false;

  // D-01: the same grouping (and the same count) the badge and Home banner use.
  const { people, groups, dups, other, ready, suggestions, count: needYou } = needs;
  // Autopay and EMI notices aren't payments: kept for the coming autopay tracking, not shown (U-14).
  const handled = inbox.filter(
    (i) =>
      i.status === 'added' ||
      i.status === 'ignored' ||
      (i.status === 'duplicate' && !needsDupCheck(i)),
  );
  const weekAgo = addDays(today, -7);
  const autoThisWeek = transactions.filter(
    (t) =>
      (t.source === 'sms' || t.source === 'notification') && t.createdAt.slice(0, 10) >= weekAgo,
  ).length;

  const read = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const s = await ingestMessages(text, { source: 'paste', receivedAt: today });
      const added = autoAdd ? await addAllReady() : 0;
      await refreshCheckpoints();
      setResult(summaryText(s, added));
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
            {needYou
              ? `${needYou} need${needYou === 1 ? 's' : ''} you. Everything else is already added.`
              : 'Nothing needs you. New payments are added automatically.'}
          </p>
        </div>
      </div>

      {isAndroidApp && <ContactsPrompt />}

      {people.map((list) => (
        <PersonGroup key={personKey(list[0]!.merchant ?? '?')} txns={list} />
      ))}

      {groups.map(([key, items]) => (
        <NewAccountCard key={key} items={items} />
      ))}

      {dups.map((i) => (
        <DupCard key={i.id} item={i} />
      ))}

      {other.map((i) => (
        <ReviewCard key={`${i.id}-${accounts.length}`} item={i} s={suggestions.get(i.id)!} />
      ))}

      {!autoAdd && ready.length > 0 && (
        <section className="stack" aria-label="Ready to add">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 'var(--fs-md)' }}>Ready to add ({ready.length})</h2>
            <span className="spacer" />
            <button
              className="btn btn-primary"
              onClick={async () => {
                const n = await addAllReady();
                toast(`Added ${n} transaction${n === 1 ? '' : 's'}`);
              }}
            >
              <Icon name="check" size={16} />
              Add all
            </button>
          </div>
          {ready.map((i) => (
            <ReviewCard key={i.id} item={i} s={suggestions.get(i.id)!} />
          ))}
        </section>
      )}

      {needYou === 0 && (
        <section className="panel">
          <EmptyState
            title="All clear"
            body="Payments from your bank messages are added on their own. Anything unclear — a new account, a possible duplicate, a payment to a friend — shows up here."
          />
        </section>
      )}

      {autoThisWeek > 0 && (
        <button className="auto-link" onClick={() => go('transactions')}>
          <span>
            <b>{autoThisWeek} added automatically this week</b>
            <span>Tap any in Activity to fix it.</span>
          </span>
          <Icon name="right" size={18} />
        </button>
      )}

      <details className="panel paste-details" open={!inbox.length && !transactions.length}>
        <summary>
          <Icon name="message" size={16} />
          Paste bank messages
        </summary>
        <div className="stack" style={{ marginTop: 'var(--sp-3)' }}>
          <label className="sr-only" htmlFor="sms-paste">
            Messages
          </label>
          <textarea
            id="sms-paste"
            className="input paste-box"
            rows={4}
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
      </details>

      {handled.length > 0 && (
        <details className="panel">
          <summary className="row fold" style={{ cursor: 'pointer' }}>
            <b>Handled messages ({handled.length})</b>
            <Icon name="chevdown" size={16} className="fold-chev" />
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
                {i.status !== 'added' && i.parsed.kind !== 'ignore' && (
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

/** "Spent or lent?" for a payment to (or from) a person. Changes that transaction; never adds one. */
/** Ask for contacts once: with them we only ask about friends, never shops. */
function ContactsPrompt() {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    void Capture.status()
      .then((s) => setGranted(!!s.contacts))
      .catch(() => setGranted(true));
  }, []);
  if (granted !== false) return null;
  return (
    <article className="panel needs-card">
      <div className="needs-label is-person">Payments to friends</div>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
        Allow contacts and Hisaab only asks “Spent or lent?” for people you know — never for shops.
        Contacts are read on this phone and never leave it.
      </p>
      <ContactsAllow onGranted={() => setGranted(true)} />
    </article>
  );
}

/** Everything waiting for one person: answer all at once, or one by one. */
function PersonGroup({ txns }: { txns: Transaction[] }) {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const person = txns[0]!.merchant ?? 'Someone';
  const out = txns.filter((t) => t.kind === 'expense');
  const inn = txns.filter((t) => t.kind !== 'expense');
  const sum = (l: Transaction[]) => l.reduce((n, t) => n + t.amount, 0);
  if (txns.length === 1) return <PersonCard txn={txns[0]!} />;
  return (
    <>
      <article className="panel needs-card">
        <div className="needs-label is-person">Spent or lent?</div>
        <div className="item-main">
          <div className="item-title">{person}</div>
          <div className="item-sub" style={{ whiteSpace: 'normal' }}>
            {txns.length} payments
            {out.length > 0 && ` · paid ${formatINR(sum(out))}`}
            {inn.length > 0 && ` · received ${formatINR(sum(inn))}`}
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const n = await allSpentFor(person);
              toast(`${n} payments kept as normal · won’t ask about ${person} again`);
            }}
          >
            {inn.length && !out.length ? 'All income' : 'All spent'}
          </button>
          <button className="btn" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Review each'}
          </button>
        </div>
      </article>
      {open && txns.map((t) => <PersonCard key={t.id} txn={t} />)}
    </>
  );
}

function PersonCard({ txn }: { txn: Transaction }) {
  const { accountById } = useStore();
  const { toast } = useUI();
  const person = txn.merchant ?? 'Someone';
  const out = txn.kind === 'expense';
  const [preferred, setPreferred] = useState<PersonChoice>();
  const [canRepay, setCanRepay] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [friend, setFriend] = useState('');
  const [share, setShare] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void suggestedChoice(txn, person).then(setPreferred);
    void openDebtsWith(person, out ? 'borrowed' : 'lent').then((d) => setCanRepay(d.length > 0));
  }, [txn, person, out]);

  const choices: { c: PersonChoice; label: string }[] = out
    ? [
        { c: 'spent', label: 'Spent' },
        { c: 'lent', label: 'Lent' },
        ...(canRepay ? [{ c: 'repay_them' as const, label: 'Paid back' }] : []),
      ]
    : [
        ...(canRepay ? [{ c: 'repaid_me' as const, label: 'Paid me back' }] : []),
        { c: 'income', label: 'Income' },
        { c: 'borrowed', label: 'Borrowed' },
      ];

  const answer = async (c: PersonChoice) => {
    await resolvePersonPayment(txn.id, person, c);
    toast(
      c === 'spent' || c === 'income'
        ? `Kept as ${c === 'spent' ? 'spending' : 'income'} · won’t ask about ${person} again`
        : c === 'lent'
          ? `Lent to ${person} — see Lent & borrowed`
          : c === 'borrowed'
            ? `Borrowed from ${person}`
            : 'Loan updated',
    );
  };

  const split = async () => {
    try {
      setError('');
      await splitWithFriends(txn.id, [{ person: friend, amount: toPaise(share || '0') }]);
      toast(`${formatINR(toPaise(share))} lent to ${friend.trim()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not split.');
    }
  };

  return (
    <article className="panel needs-card">
      <div className="needs-label is-person">{out ? 'Spent or lent?' : 'Money from a person'}</div>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <div className="item-main">
          <div className="item-title">{person}</div>
          <div className="item-sub">
            {formatDate(txn.date)} · {accountById.get(txn.accountId)?.name ?? ''}
          </div>
        </div>
        <span className={`num ${out ? '' : 'amt-income'}`} style={{ fontWeight: 600 }}>
          {out ? '' : '+'}
          {formatINR(txn.amount)}
        </span>
      </div>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {choices.map(({ c, label }) => (
          <button
            key={c}
            className={`btn ${preferred === c ? 'btn-primary' : ''}`}
            onClick={() => answer(c)}
          >
            {label}
          </button>
        ))}
        {out && !splitting && (
          <button className="link-btn" onClick={() => setSplitting(true)}>
            Split with a friend
          </button>
        )}
      </div>
      {splitting && (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <div className="grid-2" style={{ gap: 'var(--sp-2)' }}>
            <Field label="Friend" htmlFor={`f-${txn.id}`}>
              <input
                id={`f-${txn.id}`}
                className="input"
                value={friend}
                onChange={(e) => setFriend(e.target.value)}
              />
            </Field>
            <Field label="Their share" htmlFor={`s-${txn.id}`}>
              <input
                id={`s-${txn.id}`}
                className="input num"
                inputMode="decimal"
                value={share}
                onChange={(e) => setShare(cleanAmountInput(e.target.value, share))}
              />
            </Field>
          </div>
          <ErrorNote message={error} />
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button className="btn btn-primary" onClick={split} disabled={!friend.trim() || !share}>
              Save split
            </button>
            <button className="btn" onClick={() => setSplitting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/** Messages from an account we don't know yet, as one question. */
function NewAccountCard({ items }: { items: InboxItem[] }) {
  const { openAccount, toast } = useUI();
  const { meta } = useStore();
  const p = items[0]!.parsed;
  const total = items.reduce((s, i) => s + (i.parsed.amount ?? 0), 0);
  const since = items.map((i) => i.parsed.date ?? i.receivedAt).sort()[0]!;
  const isCard = p.instrument === 'credit_card' || p.kind === 'card_payment';
  const isWallet = p.instrument === 'wallet' || p.instrument === 'upi_lite';
  const name = foundAccountName(p);
  return (
    <article className="panel needs-card">
      <div className="needs-label is-account">New account found</div>
      <div className="item-main">
        <div className="item-title">{name}</div>
        <div className="item-sub">
          {items.length} payment{items.length === 1 ? '' : 's'} since {formatDate(since)} ·{' '}
          {formatINR(total)}
        </div>
      </div>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button
          className="btn btn-primary"
          onClick={() =>
            openAccount({
              kind: isCard ? 'credit_card' : isWallet ? 'wallet' : 'bank',
              last4: p.last4,
              institution: p.bank ?? p.walletName,
              name,
            })
          }
        >
          Add account
        </button>
        <button
          className="btn"
          onClick={async () => {
            if (p.last4) await setMeta('notMine', [...((meta.notMine as string[]) ?? []), p.last4]);
            for (const i of items) await ignoreInboxItem(i.id, 'Not your account');
            toast('Set aside — we won’t ask about it again');
          }}
        >
          Not mine
        </button>
      </div>
    </article>
  );
}

/** A possible repeat we're not sure about. */
function DupCard({ item }: { item: InboxItem }) {
  const { transactions, accounts, rules, meta } = useStore();
  const { toast } = useUI();
  const t = transactions.find((x) => x.id === item.duplicateOf);
  const addAnyway = async () => {
    const s = suggest(item.parsed, {
      accounts,
      rules,
      transactions,
      receivedAt: item.receivedAt,
      accountHints: (meta.accountHints as Record<string, string>) ?? {},
    });
    if (!s.accountId) {
      await restoreInboxItem(item.id);
      return;
    }
    await addFromInbox(item.id, {
      kind: s.kind,
      amount: s.amount,
      date: s.date,
      accountId: s.accountId,
      toAccountId: s.toAccountId,
      categoryId: s.categoryId,
      merchant: s.merchant,
      paymentMode: s.paymentMode,
      externalRef: s.externalRef,
    });
    toast('Added as a separate payment');
  };
  return (
    <article className="panel needs-card">
      <div className="needs-label is-dup">Maybe counted twice</div>
      <div className="item-main">
        <div className="item-title">
          {item.parsed.merchant ?? t?.merchant ?? 'Payment'} · {formatINR(item.parsed.amount ?? 0)}
        </div>
        <div className="item-sub" style={{ whiteSpace: 'normal' }}>
          {item.note}
          {t ? ` — already have ${formatINR(t.amount)} on ${formatDate(t.date)}` : ''}
        </div>
      </div>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button
          className="btn btn-primary"
          onClick={() => ignoreInboxItem(item.id, 'Same payment (you confirmed)')}
        >
          Same payment
        </button>
        <button className="btn" onClick={addAnyway}>
          Two payments
        </button>
      </div>
    </article>
  );
}

function ReviewCard({
  item,
  s,
  duplicate,
}: {
  item: InboxItem;
  s: Suggestion;
  /** 'added' if a transaction with this reference exists, else the id of the matching message. */
  duplicate?: string;
}) {
  const { activeAccounts, categories, accountById, categoryById } = useStore();
  // Messages Hisaab fully understood start as a one-line summary; the rest open for editing.
  const [editing, setEditing] = useState(!s.ready);
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
          className={`pill ${kind === 'income' || kind === 'refund' ? 'pill-ok' : 'pill-neutral'}`}
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

      {duplicate && (
        <div className="note note-warn row" style={{ flexWrap: 'wrap' }}>
          <span>
            {duplicate === 'added'
              ? 'Looks already added — a transaction has the same reference number.'
              : 'Same reference number as another message here — probably the same payment.'}
          </span>
          <span className="spacer" />
          <button
            className="btn btn-sm"
            onClick={() => ignoreInboxItem(item.id, 'Duplicate message')}
          >
            Ignore duplicate
          </button>
        </div>
      )}

      {!editing && (
        <div className="review-summary">
          {kind !== 'transfer' && <CategoryAvatar category={categoryById.get(categoryId)} />}
          <div className="item-main">
            <div className="item-title">
              {kind === 'transfer'
                ? `${accountById.get(accountId)?.name ?? '?'} → ${accountById.get(toAccountId)?.name ?? '?'}`
                : merchant || 'Unknown merchant'}
            </div>
            <div className="item-sub">
              {[
                kind !== 'transfer' && (categoryById.get(categoryId)?.name ?? 'No category'),
                kind !== 'transfer' && accountById.get(accountId)?.name,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
      )}

      {editing && (
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
                onChange={(e) => setAmount(cleanAmountInput(e.target.value, amount))}
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
      )}

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
        {!editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button className="btn btn-primary" onClick={add}>
          <Icon name="check" size={16} />
          Add
        </button>
      </div>
    </article>
  );
}
