import { useMemo, useState } from 'react';
import { ConfirmButton, ErrorNote, Field, MoneyInput, Sheet } from '../design/components';
import { formatDate } from '../domain/dates';
import { formatINR, safePaise, toRupees } from '../domain/money';
import { suggestPeople } from '../domain/people';
import type { Transaction } from '../domain/types';
import { notALoan, updateLoanEntry } from '../db/loans';
import { deleteTransaction, restoreTransaction } from '../db/repo';
import { useStore } from '../store';
import { useUI } from '../ui';

/**
 * Change one lent / borrowed / paid-back entry (U-24): amount, person, account, date, time, note.
 * A friend's part of a payment you made for them keeps that payment's account and date; changing
 * its amount moves the difference to or from your own share.
 */
export function LoanEntrySheet({ t, onClose }: { t: Transaction; onClose: () => void }) {
  const { debts, activeAccounts, accountById, transactions, today } = useStore();
  const { toast, go } = useUI();
  const debt = debts.find((d) => d.id === t.debtId);
  const parent = t.splitOf ? transactions.find((x) => x.id === t.splitOf) : undefined;
  const lent = debt?.direction !== 'borrowed';
  const repayment = (t.flow === 'in') === lent;
  const fromSms = t.source === 'sms' || t.source === 'notification';

  const [person, setPerson] = useState(debt?.person ?? '');
  const [amount, setAmount] = useState(String(toRupees(t.amount)));
  const [accountId, setAccountId] = useState(t.accountId);
  const [date, setDate] = useState(t.date);
  const [time, setTime] = useState(t.time ?? '');
  const [note, setNote] = useState(t.note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => [...new Set(debts.map((d) => d.person))], [debts]);
  const names = suggestPeople(person, known, 8);

  const who = debt?.person ?? 'them';
  const title = repayment
    ? lent
      ? `${who} paid you back`
      : `You paid ${who} back`
    : lent
      ? `Lent to ${who}`
      : `Borrowed from ${who}`;
  const accounts = activeAccounts.some((a) => a.id === t.accountId)
    ? activeAccounts
    : [...activeAccounts, ...(accountById.get(t.accountId) ? [accountById.get(t.accountId)!] : [])];

  const save = async () => {
    try {
      setError('');
      setBusy(true);
      if (date > today) throw new Error('That date is in the future.');
      await updateLoanEntry(t.id, {
        amount: safePaise(amount),
        accountId,
        date,
        time: time || undefined,
        note,
        person,
      });
      toast('Saved');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <Field label="Amount" htmlFor="loan-amount">
        <MoneyInput id="loan-amount" value={amount} onChange={setAmount} />
      </Field>
      <Field label="Person" htmlFor="loan-person">
        <input
          id="loan-person"
          className="input"
          list="loan-people"
          autoComplete="off"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        />
        <datalist id="loan-people">
          {names.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      {parent ? (
        <div className="note">
          Part of {formatINR(parent.grossAmount ?? parent.amount)}
          {parent.merchant ? ` at ${parent.merchant}` : ''} on {formatDate(parent.date)} from{' '}
          {accountById.get(parent.accountId)?.name}. Its account and date follow that payment; a
          different amount here comes out of {parent.amount ? 'your share' : 'what’s left'}.
        </div>
      ) : (
        <>
          <div className="field">
            <span className="label">{t.flow === 'in' ? 'Into' : 'Paid from'}</span>
            <div className="chips scroll">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  className="chip"
                  aria-pressed={a.id === accountId}
                  onClick={() => setAccountId(a.id)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid-2">
            <Field label="Date" htmlFor="loan-date">
              <input
                id="loan-date"
                type="date"
                className="input"
                max={today}
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </Field>
            <Field label="Time" htmlFor="loan-time">
              <input
                id="loan-time"
                type="time"
                className="input"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          </div>
        </>
      )}
      <Field label="Note" htmlFor="loan-note">
        <input
          id="loan-note"
          className="input"
          placeholder="Optional"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
        Changes your account balance only — never counted as spending or income.
      </p>
      <ErrorNote message={error} />

      <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        {parent ? (
          <ConfirmButton
            label="Remove from split"
            confirmLabel={`Tap again: ${formatINR(t.amount)} becomes yours`}
            onConfirm={async () => {
              await deleteTransaction(t.id);
              onClose();
              toast(`${formatINR(t.amount)} is your spending again`, () =>
                restoreTransaction(t.id),
              );
            }}
          />
        ) : fromSms ? (
          <ConfirmButton
            label="Not a loan"
            confirmLabel={`Tap again: count as ${t.flow === 'in' ? 'income' : 'spending'}`}
            onConfirm={async () => {
              const was = await notALoan(t.id);
              onClose();
              toast(`Counted as ${was} now`);
            }}
          />
        ) : (
          <ConfirmButton
            label="Delete"
            confirmLabel="Tap again to delete"
            onConfirm={async () => {
              await deleteTransaction(t.id);
              onClose();
              toast('Deleted', () => restoreTransaction(t.id));
            }}
          />
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            onClose();
            go('people');
          }}
        >
          Lent &amp; borrowed
        </button>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
