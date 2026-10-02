import { AccountAvatar, Amount, CategoryAvatar } from '../design/components';
import { Icon } from '../design/Icon';
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
export function TxnRow({ t, perspective }: { t: Transaction; perspective?: ID }) {
  const { accountById, categoryById, debts } = useStore();
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
    split ? `Split · ${t.splits!.length} categories` : cat?.name !== title ? cat?.name : null,
    acc?.name,
    t.paymentMode ? modeLabel[t.paymentMode] : null,
  ]
    .filter(Boolean)
    .join(' · ');
  let amount = <Amount value={t.amount} kind={t.kind} />;

  if (t.kind === 'transfer') {
    const isCardPayment = to?.kind === 'credit_card';
    avatar = neutralAvatar('transfer');
    title = t.note || (isCardPayment ? `${to?.name} bill` : 'Transfer');
    sub = `${acc?.name} → ${to?.name}${isCardPayment ? ' · not spending' : ''}`;
    if (perspective) {
      const incoming = t.toAccountId === perspective;
      amount = (
        <span className="num amt-transfer">{(incoming ? '+' : '−') + formatINR(t.amount)}</span>
      );
    }
  } else if (t.kind === 'adjustment') {
    avatar = neutralAvatar('check');
    title = t.note || 'Balance updated';
    sub = `${acc?.name} · adjustment · not spending`;
    amount = (
      <span className="num amt-transfer">
        {(t.flow === 'in' ? '+' : '−') + formatINR(t.amount)}
      </span>
    );
  } else if (t.kind === 'debt') {
    const d = debts.find((x) => x.id === t.debtId);
    avatar = neutralAvatar('transfer');
    title = t.note || (d ? d.person : 'Money lent / borrowed');
    sub = `${acc?.name} · ${d?.direction === 'borrowed' ? 'borrowed' : 'lent'} · not spending`;
    amount = (
      <span className="num amt-transfer">
        {(t.flow === 'in' ? '+' : '−') + formatINR(t.amount)}
      </span>
    );
  } else if (t.kind === 'refund') {
    sub = `Refund · ${sub}`;
  }

  return (
    <button className="item" onClick={() => openTxn(t)}>
      {avatar}
      <div className="item-main">
        <div className="item-title">{title}</div>
        <div className="item-sub">
          {t.status === 'pending' ? 'Needs review · ' : ''}
          {sub}
        </div>
      </div>
      <div className="item-amt">{amount}</div>
    </button>
  );
}
