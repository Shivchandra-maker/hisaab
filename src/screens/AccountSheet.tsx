import { useState } from 'react';
import {
  ConfirmButton,
  ErrorNote,
  Field,
  MoneyInput,
  Segmented,
  Sheet,
} from '../design/components';
import { formatDate } from '../domain/dates';
import { balanceOf } from '../domain/ledger';
import { formatINR, toPaise, toRupees } from '../domain/money';
import type { Account, AccountKind, CardNetwork } from '../domain/types';
import { adjustBalance, archiveAccount, saveAccount, ValidationError } from '../db/repo';
import { useStore } from '../store';
import { useUI } from '../ui';

const kindOptions: { value: AccountKind; label: string }[] = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'credit_card', label: 'Credit card' },
];

const namePlaceholder: Record<AccountKind, string> = {
  bank: 'e.g. HDFC Savings',
  cash: 'Cash',
  wallet: 'e.g. UPI Lite, Paytm wallet',
  credit_card: 'e.g. HDFC Regalia',
};

const asText = (p?: number) => (p ? String(toRupees(p)) : '');

export function AccountSheet({
  initial,
  onClose,
}: {
  initial?: Partial<Account>;
  onClose: () => void;
}) {
  const { today, activeAccounts } = useStore();
  const { toast } = useUI();
  const editing = !!initial?.id;
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? 'bank');
  const [name, setName] = useState(initial?.name ?? (initial?.kind === 'cash' ? 'Cash' : ''));
  const [institution, setInstitution] = useState(initial?.institution ?? '');
  const [last4, setLast4] = useState(initial?.last4 ?? '');
  const [upi, setUpi] = useState((initial?.upiIds ?? []).join(', '));
  const [opening, setOpening] = useState(asText(initial?.openingBalance));
  const [openingDate, setOpeningDate] = useState(initial?.openingDate ?? today);
  const [statementDay, setStatementDay] = useState(String(initial?.card?.statementDay ?? 15));
  const [dueDays, setDueDays] = useState(String(initial?.card?.dueDaysAfterStatement ?? 20));
  const [limit, setLimit] = useState(asText(initial?.card?.creditLimit));
  const [network, setNetwork] = useState<CardNetwork>(initial?.card?.network ?? 'visa');
  const [payFrom, setPayFrom] = useState(
    initial?.card?.paymentAccountId ?? activeAccounts.find((a) => a.kind === 'bank')?.id ?? '',
  );
  const [error, setError] = useState('');

  const isCard = kind === 'credit_card';
  const banks = activeAccounts.filter((a) => a.kind === 'bank' && a.id !== initial?.id);

  const save = async () => {
    try {
      setError('');
      const draft: Partial<Account> &
        Pick<
          Account,
          'name' | 'kind' | 'openingBalance' | 'openingDate' | 'archived' | 'sortOrder'
        > = {
        ...initial,
        name: name || (kind === 'cash' ? 'Cash' : ''),
        kind,
        institution: institution.trim() || undefined,
        last4: last4.trim() || undefined,
        upiIds:
          kind === 'bank' && upi.trim()
            ? upi
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        openingBalance: toPaise(opening || '0'),
        openingDate,
        archived: initial?.archived ?? false,
        sortOrder: initial?.sortOrder ?? (undefined as unknown as number),
      };
      if (isCard) {
        draft.card = {
          ...initial?.card,
          statementDay: Number(statementDay),
          dueDaysAfterStatement: Number(dueDays),
          creditLimit: toPaise(limit || '0'),
          network,
          paymentAccountId: payFrom || undefined,
        };
      }
      if (last4 && !/^\d{4}$/.test(last4.trim()))
        throw new ValidationError('Last 4 digits should be 4 numbers.');
      const saved = await saveAccount(draft as Account);
      toast(editing ? 'Account updated' : `${saved.name} added`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  return (
    <Sheet title={editing ? 'Edit account' : 'Add account'} onClose={onClose}>
      {!editing && (
        <Segmented label="Account type" value={kind} onChange={setKind} options={kindOptions} />
      )}
      <Field label="Name" htmlFor="acc-name">
        <input
          id="acc-name"
          className="input"
          placeholder={namePlaceholder[kind]}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      {(kind === 'bank' || isCard) && (
        <div className="grid-2">
          <Field label={isCard ? 'Issuer' : 'Bank'} htmlFor="acc-inst">
            <input
              id="acc-inst"
              className="input"
              placeholder={isCard ? 'e.g. HDFC Bank' : 'e.g. State Bank of India'}
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </Field>
          <Field label="Last 4 digits" htmlFor="acc-last4" hint="Helps match bank SMS later">
            <input
              id="acc-last4"
              className="input num"
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
      )}
      {kind === 'bank' && (
        <Field
          label="UPI IDs on this account"
          htmlFor="acc-upi"
          hint="Optional. Separate several with commas."
        >
          <input
            id="acc-upi"
            className="input"
            placeholder="name@okhdfc"
            value={upi}
            onChange={(e) => setUpi(e.target.value)}
          />
        </Field>
      )}

      {isCard && (
        <>
          <div className="grid-3">
            <Field label="Statement day" htmlFor="acc-stmt" hint="Day the bill is generated">
              <select
                id="acc-stmt"
                className="input"
                value={statementDay}
                onChange={(e) => setStatementDay(e.target.value)}
              >
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Days to pay" htmlFor="acc-due" hint="Statement → due date">
              <input
                id="acc-due"
                className="input num"
                inputMode="numeric"
                value={dueDays}
                onChange={(e) => setDueDays(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label="Network" htmlFor="acc-net">
              <select
                id="acc-net"
                className="input"
                value={network}
                onChange={(e) => setNetwork(e.target.value as CardNetwork)}
              >
                <option value="visa">Visa</option>
                <option value="mastercard">Mastercard</option>
                <option value="rupay">RuPay</option>
                <option value="amex">Amex</option>
                <option value="diners">Diners</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Credit limit" htmlFor="acc-limit">
              <MoneyInput id="acc-limit" value={limit} onChange={setLimit} />
            </Field>
            <Field label="Usually paid from" htmlFor="acc-pay">
              <select
                id="acc-pay"
                className="input"
                value={payFrom}
                onChange={(e) => setPayFrom(e.target.value)}
              >
                <option value="">Not set</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {network === 'rupay' && (
            <div className="note note-cycle">
              RuPay credit cards work on UPI. Pick this card as “Paid from” when you pay by UPI with
              it.
            </div>
          )}
        </>
      )}

      <div className="grid-2">
        <Field
          label={isCard ? 'Amount owed on start date' : 'Balance on start date'}
          htmlFor="acc-open"
          hint={
            editing
              ? 'To fix today’s balance, use Update balance instead.'
              : isCard
                ? 'Everything you owe on the card, billed or not.'
                : undefined
          }
        >
          <MoneyInput id="acc-open" value={opening} onChange={setOpening} />
        </Field>
        <Field
          label="Start date"
          htmlFor="acc-date"
          hint="Transactions before this date are ignored"
        >
          <input
            id="acc-date"
            type="date"
            className="input"
            max={today}
            value={openingDate}
            onChange={(e) => e.target.value && setOpeningDate(e.target.value)}
          />
        </Field>
      </div>

      <ErrorNote message={error} />
      <div className="row">
        {editing && (
          <ConfirmButton
            label={initial?.archived ? 'Unarchive' : 'Archive'}
            confirmLabel={initial?.archived ? 'Tap to unarchive' : 'Tap again to archive'}
            onConfirm={async () => {
              await archiveAccount(initial!.id!, !initial?.archived);
              toast(initial?.archived ? 'Account restored' : 'Account archived');
              onClose();
            }}
          />
        )}
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save}>
          {editing ? 'Save' : 'Add account'}
        </button>
      </div>
    </Sheet>
  );
}

/** Correct an account to its real balance with an adjustment (never counted as spending). */
export function AdjustSheet({ account, onClose }: { account: Account; onClose: () => void }) {
  const { transactions, today } = useStore();
  const { toast } = useUI();
  const current = balanceOf(account, transactions, today);
  const [value, setValue] = useState(String(toRupees(current)));
  const [error, setError] = useState('');
  const isCard = account.kind === 'credit_card';
  let diff = 0;
  try {
    diff = toPaise(value || '0') - current;
  } catch {
    /* shown on save */
  }

  const save = async () => {
    try {
      const r = await adjustBalance(account.id, toPaise(value || '0'), today);
      toast(r ? 'Balance updated' : 'Balance already matches');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.');
    }
  };
  return (
    <Sheet title="Update balance" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        Hisaab shows {formatINR(current)} {isCard ? 'owed on' : 'in'} {account.name} today (
        {formatDate(today)}). Enter the real figure from your {isCard ? 'card app' : 'bank app'}.
      </p>
      <Field label={isCard ? 'Actual amount owed' : 'Actual balance'} htmlFor="adj-value">
        <MoneyInput id="adj-value" value={value} onChange={setValue} autoFocus />
      </Field>
      {diff !== 0 && (
        <div className="note note-ok">
          Records a {formatINR(Math.abs(diff))} balance adjustment. It changes the balance only —
          not your spending or income.
        </div>
      )}
      <ErrorNote message={error} />
      <button className="btn btn-primary btn-block" onClick={save}>
        Update balance
      </button>
    </Sheet>
  );
}
