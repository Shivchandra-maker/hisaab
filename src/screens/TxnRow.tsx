import { AccountAvatar, Amount, CategoryAvatar } from '../design/components';
import { Icon } from '../design/Icon';
import { formatDate, formatTime } from '../domain/dates';
import { INVESTMENTS } from '../domain/ledger';
import { formatINR } from '../domain/money';
import type { ID, Transaction } from '../domain/types';
import { useStore } from '../store';
import { useUI } from '../ui';

const modeLabel: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  cash: 'Cash',
  auto_debit: 'Auto-debit',
  cheque: 'Cheque',
  wallet: 'Wallet',
  other: '',
};

const neutralAvatar = (icon: string) => (
  <span className="avatar" style={{ background: 'var(--surface-2)', color: 'var(--fg-2)' }}>
    <Icon name={icon} size={18} />
  </span>
);

/**
 * One transaction line. Tapping opens the editor.
 * `perspective` = the account whose register this row is shown in (signs transfers for it).
 */
/** Payment modes that only repeat what the account already says ("Cash · Cash", "HDFC Regalia · Card"). */
const redundantMode = (kind: string | undefined, mode: string | undefined) =>
  (kind === 'cash' && mode === 'cash') ||
  (kind === 'credit_card' && mode === 'card') ||
  (kind === 'wallet' && (mode === 'wallet' || mode === 'upi'));

export function TxnRow({
  t,
  perspective,
  showDate,
}: {
  t: Transaction;
  perspective?: ID;
  /** Lead the second line with the date (lists not grouped by day). */
  showDate?: boolean;
}) {
  const { accountById, categoryById, debts, today, meta } = useStore();
  const { openTxn } = useUI();
  const acc = accountById.get(t.accountId);
  const to = t.toAccountId ? accountById.get(t.toAccountId) : undefined;
  const cat = t.categoryId ? categoryById.get(t.categoryId) : undefined;
  const split = (t.splits?.length ?? 0) > 1;

  let avatar = cat ? (
    <CategoryAvatar category={cat} />
  ) : acc ? (
    <AccountAvatar account={acc} />
  ) : null;
  let title = t.merchant || cat?.name || 'Transaction';
  let sub = [
    // D-12: with a date in front, the line is long — the icon already shows the category.
    split
      ? `Split · ${t.splits!.length} categories`
      : showDate || cat?.name === title
        ? null
        : cat?.name,
    acc?.name,
    t.paymentMode && !redundantMode(acc?.kind, t.paymentMode) ? modeLabel[t.paymentMode] : null,
  ]
    .filter(Boolean)
    .join(' · ');
  let amount = <Amount value={t.amount} kind={t.kind} />;

  if (t.kind === 'transfer') {
    const isCardPayment = to?.kind === 'credit_card';
    avatar = neutralAvatar('transfer');
    title = t.note || (isCardPayment ? `${to?.name} bill` : 'Transfer');
    sub = `${acc?.name} → ${to?.name}${isCardPayment ? ' · card bill' : ''}`;
    if (perspective) {
      const incoming = t.toAccountId === perspective;
      amount = (
        <span className="num amt-transfer">{(incoming ? '+' : '−') + formatINR(t.amount)}</span>
      );
    }
  } else if (t.kind === 'adjustment') {
    avatar = neutralAvatar('check');
    title = t.note || 'Balance updated';
    sub = `${acc?.name} · balance correction`;
    amount = (
      <span className="num amt-transfer">
        {(t.flow === 'in' ? '+' : '−') + formatINR(t.amount)}
      </span>
    );
  } else if (t.kind === 'debt') {
    const d = debts.find((x) => x.id === t.debtId);
    avatar = neutralAvatar('transfer');
    title = t.note || (d ? d.person : 'Money lent / borrowed');
    sub = `${acc?.name} · ${d?.direction === 'borrowed' ? 'borrowed' : 'lent'}`;
    amount = (
      <span className="num amt-transfer">
        {(t.flow === 'in' ? '+' : '−') + formatINR(t.amount)}
      </span>
    );
  } else if (t.kind === 'refund') {
    sub = `Refund · ${sub}`;
  }

  // Recorded but not your spending (U-18): lent, transfers, card bills, adjustments — and
  // investments if you chose so. Faded so the spending stands out; nothing is hidden.
  // Investments are never spending, so they're always tagged; fading them is your choice.
  const invest =
    t.kind === 'expense' &&
    (t.categoryId === INVESTMENTS || !!t.splits?.every((p) => p.categoryId === INVESTMENTS));
  // A payment made entirely for others (₹0 of it yours) isn't your spending either.
  const allLent = t.kind === 'expense' && !!t.grossAmount && t.amount === 0;
  const notSpending =
    t.kind === 'transfer' ||
    t.kind === 'debt' ||
    t.kind === 'adjustment' ||
    allLent ||
    (invest && meta.fadeInvestments === true);
  const fade = notSpending && meta.fadeNonSpending !== false;
  const tag =
    t.kind === 'expense' && t.grossAmount
      ? allLent
        ? `${formatINR(t.grossAmount)} · all lent`
        : `of ${formatINR(t.grossAmount)} paid`
      : t.kind === 'debt'
        ? t.flow === 'in'
          ? 'not income'
          : 'not spending'
        : t.kind === 'transfer' || t.kind === 'adjustment'
          ? 'not spending'
          : invest
            ? 'invested'
            : null;

  return (
    <button className={`item ${fade ? 'is-faded' : ''}`} onClick={() => openTxn(t)}>
      {avatar}
      <div className="item-main">
        <div className="item-title">{title}</div>
        <div className="item-sub">
          {t.status === 'pending' ? 'Needs review · ' : ''}
          {showDate
            ? `${t.date === today ? 'Today' : formatDate(t.date)}${t.time ? `, ${formatTime(t.time)}` : ''} · `
            : t.time
              ? `${formatTime(t.time)} · `
              : ''}
          {sub}
        </div>
      </div>
      <div className="item-amt">
        {amount}
        {tag && <span className="item-tag">{tag}</span>}
      </div>
    </button>
  );
}
