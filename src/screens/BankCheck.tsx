import { useState } from 'react';
import { ErrorNote } from '../design/components';
import { formatDate } from '../domain/dates';
import { cleanAmountInput, formatINR, toPaise } from '../domain/money';
import type { Account } from '../domain/types';
import { refreshCheckpoints } from '../db/checkpoints';
import { saveAccount } from '../db/repo';
import { useUI } from '../ui';

/** "Matches your bank" line under a balance, from the latest balance stated in an SMS. */
export function BankCheck({ account }: { account: Account }) {
  const c = account.check;
  const card = account.kind === 'credit_card';
  const { toast } = useUI();
  const [limit, setLimit] = useState('');
  const [error, setError] = useState('');

  // Cards: the SMS gives the available limit; with the credit limit we know exactly what's owed.
  // Every card without a limit asks for it — not only those whose SMS state the available limit
  // (U-13: one of four cards never showed the prompt).
  if (card && !account.card?.creditLimit)
    return (
      <div className="note note-cycle stack" style={{ gap: 'var(--sp-2)' }}>
        {account.lastAvailable ? (
          <span>
            Your bank said <b>{formatINR(account.lastAvailable.amount)}</b> available on{' '}
            {formatDate(account.lastAvailable.date)}. Add this card’s credit limit and Hisaab will
            match what the bank says you owe — every time a message arrives.
          </span>
        ) : (
          <span>
            Add this card’s credit limit to see how much of it you’ve used. If the bank’s messages
            mention the available limit, Hisaab will also match what you owe to them.
          </span>
        )}
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor={`lim-${account.id}`}>
            Credit limit
          </label>
          <input
            id={`lim-${account.id}`}
            className="input num"
            inputMode="decimal"
            placeholder="Credit limit, e.g. 2,00,000"
            style={{ maxWidth: 220 }}
            value={limit}
            onChange={(e) => setLimit(cleanAmountInput(e.target.value, limit))}
          />
          <button
            className="btn btn-primary"
            disabled={!limit}
            onClick={async () => {
              try {
                setError('');
                const v = toPaise(limit);
                if (account.lastAvailable && v < account.lastAvailable.amount)
                  throw new Error('The limit can’t be less than what’s available.');
                await saveAccount({ ...account, card: { ...account.card!, creditLimit: v } });
                await refreshCheckpoints();
                toast('Card now matches your bank');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not save.');
              }
            }}
          >
            Save
          </button>
        </div>
        <ErrorNote message={error} />
      </div>
    );

  if (!c) return null;
  const off = Math.abs(c.drift);
  return (
    <div className="bank-check">
      <span className="pill pill-ok">Matches your bank</span>
      <span>
        {card ? 'Owed' : 'Balance'} {formatINR(c.amount)} per your bank’s SMS on{' '}
        {formatDate(c.date)}.
        {off >= 100 &&
          ` Before that Hisaab was ${formatINR(off)} ${c.drift < 0 ? 'over' : 'under'} — usually ${card ? 'EMIs, fees or a charge' : 'charges, interest or a payment'} without its own message.`}
      </span>
    </div>
  );
}
