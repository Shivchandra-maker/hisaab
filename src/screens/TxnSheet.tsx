import { useMemo, useState } from 'react';
import { Icon } from '../design/Icon';
import {
  CategoryAvatar,
  ConfirmButton,
  ErrorNote,
  Field,
  MoneyInput,
  Segmented,
  Sheet,
} from '../design/components';
import { periodContaining } from '../domain/cycle';
import { addDays, formatDate } from '../domain/dates';
import { cleanAmountInput, formatINR, toPaise, toRupees } from '../domain/money';
import type { Account, PaymentMode, Split, Transaction } from '../domain/types';
import { deleteTransaction, restoreTransaction, saveTransaction } from '../db/repo';
import { guessCategory } from '../domain/sms/categorize';
import { useStore } from '../store';
import { resolvePersonPayment, splitWithFriends } from '../db/loans';
import { useUI, type TxnDraft } from '../ui';

type Tab = 'expense' | 'income' | 'transfer';

const modeOptions: { value: PaymentMode; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'auto_debit', label: 'Auto-debit' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

function defaultMode(acc?: Account): PaymentMode | undefined {
  if (!acc) return undefined;
  if (acc.kind === 'cash') return 'cash';
  if (acc.kind === 'wallet') return 'upi';
  if (acc.kind === 'credit_card') return acc.card?.network === 'rupay' ? 'upi' : 'card';
  return 'upi';
}

const text = (p?: number) => (p ? String(toRupees(p)) : '');

interface SplitRow {
  categoryId: string;
  amount: string;
}

/** Add or edit a transaction. Common case: amount → category → Save. */
export function TxnSheet({ initial, onClose }: { initial?: TxnDraft; onClose: () => void }) {
  const { debts } = useStore();
  const { go } = useUI();
  if (initial?.kind === 'adjustment' || initial?.kind === 'debt') {
    return (
      <SystemTxn
        t={initial as Transaction}
        onClose={onClose}
        onOpenPeople={() => {
          onClose();
          go('people');
        }}
        debtName={debts.find((d) => d.id === initial.debtId)?.person}
      />
    );
  }
  return <TxnEditor initial={initial} onClose={onClose} />;
}

function TxnEditor({ initial, onClose }: { initial?: TxnDraft; onClose: () => void }) {
  const { categories, activeAccounts, accountById, today, meta, transactions, rules } = useStore();
  const { toast, openTxn } = useUI();
  const editing = !!initial?.id;

  const startTab: Tab =
    initial?.kind === 'income' || initial?.kind === 'refund'
      ? 'income'
      : initial?.kind === 'transfer'
        ? 'transfer'
        : 'expense';
  const fallbackAcc =
    (initial?.accountId && accountById.get(initial.accountId)?.id) ||
    (meta.lastAccountId as string | undefined) ||
    activeAccounts[0]?.id ||
    '';

  const [tab, setTab] = useState<Tab>(startTab);
  const [refund, setRefund] = useState(initial?.kind === 'refund');
  const [amount, setAmount] = useState(text(initial?.amount));
  const [categoryId, setCategoryId] = useState(
    initial?.categoryId ?? (startTab === 'income' ? 'salary' : 'food'),
  );
  const [accountId, setAccountId] = useState(
    accountById.has(fallbackAcc) ? fallbackAcc : (activeAccounts[0]?.id ?? ''),
  );
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? '');
  const [date, setDate] = useState(initial?.date ?? today);
  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  // Once you pick a category yourself, typing a payee no longer changes it.
  const [catTouched, setCatTouched] = useState(!!initial?.categoryId);
  const pickCategory = (id: string) => {
    setCategoryId(id);
    setCatTouched(true);
  };
  const payees = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = transactions.length - 1; i >= 0 && out.length < 300; i--) {
      const m = transactions[i]!.merchant;
      if (m && !seen.has(m.toLowerCase())) {
        seen.add(m.toLowerCase());
        out.push(m);
      }
    }
    for (const r of rules) if (!seen.has(r.name.toLowerCase())) out.push(r.name);
    return out;
  }, [transactions, rules]);
  const onMerchant = (v: string) => {
    setMerchant(v);
    if (catTouched || splits) return;
    const g = guessCategory(v, rules);
    const c = g.categoryId && categories.find((x) => x.id === g.categoryId && !x.archived);
    if (c && (c.kind === 'income') === (tab === 'income' && !refund)) setCategoryId(c.id);
  };
  const [note, setNote] = useState(initial?.note ?? '');
  const [mode, setMode] = useState<PaymentMode | undefined>(initial?.paymentMode);
  const [splits, setSplits] = useState<SplitRow[] | null>(
    initial?.splits?.length
      ? initial.splits.map((s) => ({ categoryId: s.categoryId, amount: text(s.amount) }))
      : null,
  );
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');

  const catKind = tab === 'income' && !refund ? 'income' : 'expense';
  const pickable = categories.filter((c) => c.kind === catKind && !c.archived);
  const mains = pickable.filter((c) => !c.parentId);
  const selected = categories.find((c) => c.id === categoryId);
  const selectedMain = selected?.parentId ? selected.parentId : selected?.id;
  const subs = pickable.filter((c) => c.parentId && c.parentId === selectedMain);
  const visibleMains = showAll ? mains : mains.slice(0, 11);
  if (!showAll && selectedMain && !visibleMains.some((c) => c.id === selectedMain)) {
    const m = mains.find((c) => c.id === selectedMain);
    if (m) visibleMains.splice(10, 1, m);
  }

  const acc = accountById.get(accountId);
  const to = accountById.get(toAccountId);
  const effectiveMode = mode ?? defaultMode(acc);

  const splitTotal = useMemo(() => {
    if (!splits) return 0;
    let n = 0;
    for (const s of splits) {
      try {
        n += toPaise(s.amount || '0');
      } catch {
        /* ignore */
      }
    }
    return n;
  }, [splits]);
  let total = 0;
  try {
    total = toPaise(amount || '0');
  } catch {
    /* handled on save */
  }

  const switchTab = (t: Tab) => {
    setTab(t);
    setRefund(false);
    setSplits(null);
    setCategoryId(t === 'income' ? 'salary' : 'food');
    if (t === 'transfer' && !toAccountId)
      setToAccountId(activeAccounts.find((a) => a.id !== accountId)?.id ?? '');
  };

  const build = (): TxnDraft => {
    const kind =
      tab === 'transfer'
        ? 'transfer'
        : tab === 'income'
          ? refund
            ? 'refund'
            : 'income'
          : 'expense';
    const parsed: Split[] | undefined = splits?.map((s) => ({
      categoryId: s.categoryId,
      amount: toPaise(s.amount || '0'),
    }));
    return {
      ...initial,
      kind,
      amount: toPaise(amount || '0'),
      date,
      accountId,
      toAccountId: kind === 'transfer' ? toAccountId : undefined,
      categoryId:
        kind === 'transfer' ? undefined : parsed?.length ? parsed[0]!.categoryId : categoryId,
      splits: kind === 'expense' && parsed && parsed.length > 1 ? parsed : undefined,
      merchant: merchant.trim() || undefined,
      note: note.trim() || undefined,
      paymentMode: kind === 'transfer' ? mode : effectiveMode,
      tags: initial?.tags ?? [],
      source: initial?.source ?? 'manual',
      status: 'confirmed',
    };
  };

  const save = async () => {
    try {
      setError('');
      if (date > today)
        throw new Error('That date is in the future. Add it on the day the money actually moves.');
      await saveTransaction(build() as Transaction);
      toast(
        editing
          ? 'Saved'
          : tab === 'transfer'
            ? 'Transfer added'
            : tab === 'income'
              ? refund
                ? 'Refund added'
                : 'Income added'
              : 'Expense added',
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  const remove = async () => {
    await deleteTransaction(initial!.id!);
    onClose();
    toast('Deleted', () => restoreTransaction(initial!.id!));
  };

  const duplicate = () => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = build() as Transaction;
    void _id;
    void _c;
    void _u;
    onClose();
    setTimeout(() => openTxn({ ...rest, date: today }), 0);
  };

  const cardNote =
    tab === 'expense' && acc?.card
      ? `Counted as spending on ${formatDate(date)}. Billed on the ${formatDate(periodContaining(acc.card, date).end)} statement.`
      : tab === 'transfer' && to?.kind === 'credit_card'
        ? 'Card bill payment: moves money to the card. Not counted as spending.'
        : tab === 'transfer' && acc && to
          ? 'Moving money between your own accounts is not spending or income.'
          : null;

  return (
    <Sheet title={editing ? 'Edit transaction' : 'Add'} onClose={onClose}>
      <Segmented<Tab>
        label="Type"
        value={tab}
        onChange={switchTab}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' },
        ]}
      />

      <label className="amount-input" htmlFor="qa-amount">
        <span>₹</span>
        <input
          id="qa-amount"
          inputMode="decimal"
          placeholder="0"
          autoFocus={!editing}
          value={amount}
          style={{ width: `${Math.max(1, amount.length) + 0.6}ch` }}
          onChange={(e) => {
            setAmount(cleanAmountInput(e.target.value, amount));
            setError('');
          }}
        />
      </label>

      {tab === 'income' && (
        <div className="chips">
          <button
            className="chip"
            aria-pressed={!refund}
            onClick={() => {
              setRefund(false);
              setCategoryId('salary');
            }}
          >
            Income
          </button>
          <button
            className="chip"
            aria-pressed={refund}
            onClick={() => {
              setRefund(true);
              setCategoryId('shopping');
            }}
          >
            Refund of a purchase
          </button>
        </div>
      )}

      {tab !== 'transfer' && !splits && (
        <div className="field">
          <div className="row">
            <span className="label">Category</span>
            <span className="spacer" />
            {tab === 'expense' && (
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 4px' }}
                onClick={() =>
                  setSplits([
                    { categoryId, amount },
                    { categoryId: mains[1]?.id ?? categoryId, amount: '' },
                  ])
                }
              >
                Split
              </button>
            )}
          </div>
          <div className="cat-grid">
            {visibleMains.map((c) => (
              <button
                key={c.id}
                aria-pressed={c.id === selectedMain}
                onClick={() => pickCategory(c.id)}
              >
                <CategoryAvatar category={c} small />
                {c.name}
              </button>
            ))}
            {!showAll && mains.length > 11 && (
              <button onClick={() => setShowAll(true)}>
                <span
                  className="avatar avatar-sm"
                  style={{ background: 'var(--surface-2)', color: 'var(--fg-2)' }}
                >
                  <Icon name="dots" size={15} />
                </span>
                More
              </button>
            )}
          </div>
          {subs.length > 0 && (
            <div className="chips">
              <button
                className="chip"
                aria-pressed={categoryId === selectedMain}
                onClick={() => pickCategory(selectedMain!)}
              >
                All {mains.find((m) => m.id === selectedMain)?.name}
              </button>
              {subs.map((s) => (
                <button
                  key={s.id}
                  className="chip"
                  aria-pressed={s.id === categoryId}
                  onClick={() => pickCategory(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {splits && (
        <div className="field">
          <div className="row">
            <span className="label">Split across categories</span>
            <span className="spacer" />
            <button
              className="btn btn-ghost"
              style={{ padding: '2px 4px' }}
              onClick={() => {
                setCategoryId(splits[0]?.categoryId ?? categoryId);
                setSplits(null);
              }}
            >
              Don’t split
            </button>
          </div>
          {splits.map((s, i) => (
            <div key={i} className="row">
              <label className="sr-only" htmlFor={`split-cat-${i}`}>
                Category
              </label>
              <select
                id={`split-cat-${i}`}
                className="input"
                style={{ flex: 1.3 }}
                value={s.categoryId}
                onChange={(e) =>
                  setSplits(
                    splits.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)),
                  )
                }
              >
                {pickable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? `  ${c.name}` : c.name}
                  </option>
                ))}
              </select>
              <div style={{ flex: 1 }}>
                <MoneyInput
                  id={`split-amt-${i}`}
                  value={s.amount}
                  onChange={(v) =>
                    setSplits(splits.map((x, j) => (j === i ? { ...x, amount: v } : x)))
                  }
                />
              </div>
              {splits.length > 2 && (
                <button
                  className="icon-btn"
                  aria-label="Remove split"
                  onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>
          ))}
          <div className="row">
            <button
              className="btn"
              onClick={() =>
                setSplits([
                  ...splits,
                  {
                    categoryId: mains[0]?.id ?? '',
                    amount: total > splitTotal ? String(toRupees(total - splitTotal)) : '',
                  },
                ])
              }
            >
              Add row
            </button>
            <span className="spacer" />
            <span
              className={`num ${splitTotal === total ? 'muted' : ''}`}
              style={splitTotal !== total ? { color: 'var(--warn)' } : undefined}
            >
              {splitTotal === total
                ? 'Adds up'
                : total > splitTotal
                  ? `${formatINR(total - splitTotal)} left`
                  : `${formatINR(splitTotal - total)} over`}
            </span>
          </div>
        </div>
      )}

      <div className="field">
        <span className="label">
          {tab === 'transfer' ? 'From' : tab === 'income' ? 'Into' : 'Paid from'}
        </span>
        <div className="chips scroll">
          {activeAccounts.map((a) => (
            <button
              key={a.id}
              className="chip"
              aria-pressed={a.id === accountId}
              onClick={() => {
                setAccountId(a.id);
                setMode(undefined);
              }}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>
      {tab === 'transfer' && (
        <div className="field">
          <span className="label">To</span>
          <div className="chips scroll">
            {activeAccounts
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <button
                  key={a.id}
                  className="chip"
                  aria-pressed={a.id === toAccountId}
                  onClick={() => setToAccountId(a.id)}
                >
                  {a.name}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="grid-2">
        {tab !== 'transfer' && (
          <Field label={tab === 'income' ? 'From' : 'Paid to'} htmlFor="qa-merchant">
            <input
              id="qa-merchant"
              className="input"
              placeholder={tab === 'income' ? 'e.g. Employer' : 'e.g. Swiggy, landlord'}
              value={merchant}
              list="qa-payees"
              autoComplete="off"
              onChange={(e) => onMerchant(e.target.value)}
            />
            <datalist id="qa-payees">
              {payees.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        )}
        <Field label="How" htmlFor="qa-mode">
          <select
            id="qa-mode"
            className="input"
            value={effectiveMode ?? ''}
            onChange={(e) => setMode((e.target.value || undefined) as PaymentMode | undefined)}
          >
            {tab === 'transfer' && <option value="">Not set</option>}
            {modeOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="field">
        <span className="label">Date</span>
        <div className="chips">
          <button className="chip" aria-pressed={date === today} onClick={() => setDate(today)}>
            Today
          </button>
          <button
            className="chip"
            aria-pressed={date === addDays(today, -1)}
            onClick={() => setDate(addDays(today, -1))}
          >
            Yesterday
          </button>
          <label className="sr-only" htmlFor="qa-date">
            Pick a date
          </label>
          <input
            id="qa-date"
            type="date"
            className="input"
            style={{ width: 'auto', padding: '5px 10px' }}
            max={today}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
      </div>

      <Field label="Note" htmlFor="qa-note">
        <input
          id="qa-note"
          className="input"
          placeholder="Optional"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      {cardNote && <div className="note note-cycle">{cardNote}</div>}
      {editing && initial?.kind === 'expense' && initial.id && (
        <PaidForSomeone txnId={initial.id} total={initial.amount ?? 0} onDone={onClose} />
      )}
      <ErrorNote message={error} />
      <div className="row">
        {editing && (
          <ConfirmButton label="Delete" confirmLabel="Tap again to delete" onConfirm={remove} />
        )}
        {editing && (
          <button className="btn" onClick={duplicate}>
            Duplicate
          </button>
        )}
        <span className="spacer" />
        <button className={`btn btn-primary ${editing ? '' : 'btn-block'}`} onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Bought something for a friend (e.g. on your card)? Their part becomes money lent: your card
 * bill stays the same, your spending drops, and they show up in Lent & borrowed.
 */
function PaidForSomeone({
  txnId,
  total,
  onDone,
}: {
  txnId: string;
  total: number;
  onDone: () => void;
}) {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  if (!open)
    return (
      <button
        className="link-btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}
      >
        Paid for someone?
      </button>
    );
  const save = async () => {
    try {
      setError('');
      const part = amount ? toPaise(amount) : total;
      if (part <= 0 || part > total) throw new Error('Enter up to the full amount.');
      if (part === total) await resolvePersonPayment(txnId, who, 'lent');
      else await splitWithFriends(txnId, [{ person: who, amount: part }]);
      toast(`${formatINR(part)} lent to ${who.trim()} — see Lent & borrowed`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };
  return (
    <div className="panel stack" style={{ gap: 'var(--sp-2)', padding: 'var(--sp-3)' }}>
      <b style={{ fontSize: 'var(--fs-sm)' }}>Paid for someone</b>
      <div className="grid-2" style={{ gap: 'var(--sp-2)' }}>
        <Field label="Who" htmlFor="pfs-who">
          <input
            id="pfs-who"
            className="input"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          />
        </Field>
        <Field label="Their part" htmlFor="pfs-amt">
          <input
            id="pfs-amt"
            className="input num"
            inputMode="decimal"
            placeholder={`All ${formatINR(total)}`}
            value={amount}
            onChange={(e) => setAmount(cleanAmountInput(e.target.value, amount))}
          />
        </Field>
      </div>
      <ErrorNote message={error} />
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button className="btn btn-primary" disabled={!who.trim()} onClick={save}>
          Mark as lent
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Adjustments and lending entries: shown read-only here, edited where they belong. */
function SystemTxn({
  t,
  onClose,
  onOpenPeople,
  debtName,
}: {
  t: Transaction;
  onClose: () => void;
  onOpenPeople: () => void;
  debtName?: string;
}) {
  const { accountById } = useStore();
  const { toast } = useUI();
  const acc = accountById.get(t.accountId);
  return (
    <Sheet
      title={
        t.kind === 'adjustment'
          ? 'Balance adjustment'
          : `Money ${t.flow === 'in' ? 'received' : 'given'}${debtName ? ` · ${debtName}` : ''}`
      }
      onClose={onClose}
    >
      <div className="amount-input">
        <span>₹</span>
        <span
          className="num"
          style={{ fontSize: 'var(--fs-3xl)', color: 'var(--fg)', fontWeight: 600 }}
        >
          {formatINR(t.amount).slice(1)}
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {t.flow === 'in' ? 'Into' : 'Out of'} {acc?.name} on {formatDate(t.date, 'long')}. {t.note}
        <br />
        This changes the balance only. It isn’t counted as spending or income.
      </p>
      <div className="row">
        <ConfirmButton
          label="Delete"
          confirmLabel="Tap again to delete"
          onConfirm={async () => {
            await deleteTransaction(t.id);
            onClose();
            toast('Deleted', () => restoreTransaction(t.id));
          }}
        />
        <span className="spacer" />
        {t.kind === 'debt' && (
          <button className="btn btn-primary" onClick={onOpenPeople}>
            Open lent &amp; borrowed
          </button>
        )}
      </div>
    </Sheet>
  );
}
