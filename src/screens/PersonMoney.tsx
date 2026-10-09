import { useMemo, useState } from 'react';
import { ErrorNote, Segmented } from '../design/components';
import { formatINR } from '../domain/money';
import { suggestPeople } from '../domain/people';
import type { Transaction } from '../domain/types';
import { openDebtsWith, resolvePersonPayment, type PersonChoice } from '../db/loans';
import { useStore } from '../store';
import { useUI } from '../ui';

/**
 * U-29: any payment can be money between you and a person — the same answers the Inbox asks
 * about contacts, for every payment. Money out: lent to them, or paying back what you borrowed.
 * Money in: borrowed from them, or them paying you back. Never spending or income then.
 */
export function PersonMoney({ txn, onDone }: { txn: Transaction; onDone: () => void }) {
  const { debts } = useStore();
  const { toast } = useUI();
  const out = txn.kind === 'expense';
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState(txn.merchant ?? '');
  const [choice, setChoice] = useState<PersonChoice>(out ? 'lent' : 'borrowed');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => [...new Set(debts.map((d) => d.person))], [debts]);
  const names = suggestPeople(person, known, 8);

  if (!open)
    return (
      <button
        className="link-btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}
      >
        {out ? 'Lent this, or paying someone back?' : 'Borrowed this, or someone paying you back?'}
      </button>
    );

  const save = async () => {
    try {
      setError('');
      const who = person.trim();
      if (!who) throw new Error('Enter the person’s name.');
      // Paying back needs something owed: otherwise it's a new loan the other way.
      if (choice === 'repay_them' && !(await openDebtsWith(who, 'borrowed')).length)
        throw new Error(
          `Lent & borrowed has nothing you owe ${who}. Choose “Lent to them”, or add what you borrowed first.`,
        );
      if (choice === 'repaid_me' && !(await openDebtsWith(who, 'lent')).length)
        throw new Error(
          `Lent & borrowed has nothing ${who} owes you. Choose “Borrowed from them”, or add what you lent first.`,
        );
      setBusy(true);
      await resolvePersonPayment(txn.id, who, choice);
      toast(
        choice === 'lent'
          ? `${formatINR(txn.amount)} lent to ${who} — not spending`
          : choice === 'borrowed'
            ? `${formatINR(txn.amount)} borrowed from ${who} — not income`
            : choice === 'repay_them'
              ? `Paid ${who} back ${formatINR(txn.amount)}`
              : `${who} paid you back ${formatINR(txn.amount)}`,
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel stack" style={{ gap: 'var(--sp-3)', padding: 'var(--sp-3)' }}>
      <b style={{ fontSize: 'var(--fs-sm)' }}>
        {out ? 'Money to a person' : 'Money from a person'}
      </b>
      <label className="field">
        <span className="label">Who</span>
        <input
          className="input"
          list="pm-people"
          autoComplete="off"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        />
        <datalist id="pm-people">
          {names.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <Segmented<PersonChoice>
        label="What was it"
        value={choice}
        onChange={setChoice}
        options={
          out
            ? [
                { value: 'lent', label: 'Lent to them' },
                { value: 'repay_them', label: 'Paying them back' },
              ]
            : [
                { value: 'borrowed', label: 'Borrowed from them' },
                { value: 'repaid_me', label: 'They paid me back' },
              ]
        }
      />
      <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
        It stays in your account’s history and moves to Lent &amp; borrowed — no longer counted as{' '}
        {out ? 'spending' : 'income'}.
      </p>
      <ErrorNote message={error} />
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button className="btn" disabled={busy} onClick={save}>
          Move to Lent &amp; borrowed
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
