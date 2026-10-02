import { useState } from 'react';
import {
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  MoneyInput,
  Panel,
  Progress,
  Segmented,
  Sheet,
} from '../design/components';
import { Icon } from '../design/Icon';
import { formatDate } from '../domain/dates';
import { counted, debtBalance } from '../domain/ledger';
import { formatINR, toPaise } from '../domain/money';
import type { Debt } from '../domain/types';
import { db, recordDebtMovement, startDebt } from '../db/repo';
import { useStore } from '../store';
import { useUI } from '../ui';
import { TxnRow } from './TxnRow';

/** Money lent and borrowed. Never counted as spending or income. */
export function People() {
  const { debts, transactions, today } = useStore();
  const { go } = useUI();
  const [show, setShow] = useState<'open' | 'settled'>('open');
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ debt: Debt; type: 'more' | 'repayment' } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = debts.map((d) => ({ d, b: debtBalance(d, transactions) }));
  const owedToYou = rows
    .filter((r) => r.d.direction === 'lent')
    .reduce((n, r) => n + Math.max(0, r.b.outstanding), 0);
  const youOwe = rows
    .filter((r) => r.d.direction === 'borrowed')
    .reduce((n, r) => n + Math.max(0, r.b.outstanding), 0);
  const list = rows
    .filter((r) => (show === 'open' ? !r.d.settledAt : !!r.d.settledAt))
    .sort((a, b) => b.b.outstanding - a.b.outstanding);

  return (
    <div className="page">
      <div className="page-head">
        <div className="row">
          <button
            className="icon-btn phone-only-flex"
            onClick={() => go('settings')}
            aria-label="Back"
          >
            <Icon name="left" size={18} />
          </button>
          <h1>Lent &amp; borrowed</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          Add
        </button>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="label">Owed to you</div>
          <div
            className="num"
            style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--accent)' }}
          >
            {formatINR(owedToYou)}
          </div>
        </div>
        <div className="panel">
          <div className="label">You owe</div>
          <div className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 600 }}>
            {formatINR(youOwe)}
          </div>
        </div>
      </div>
      <Segmented
        label="Show"
        value={show}
        onChange={setShow}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'settled', label: 'Settled' },
        ]}
      />
      <section className="panel">
        {list.length === 0 && (
          <EmptyState
            title={show === 'open' ? 'Nothing outstanding' : 'Nothing settled yet'}
            body="Lending a friend money or splitting a trip? Record it here. It changes your account balance but not your spending."
          />
        )}
        <div className="list">
          {list.map(({ d, b }) => {
            const history = transactions.filter((t) => counted(t) && t.debtId === d.id).reverse();
            const open = openId === d.id;
            return (
              <div
                key={d.id}
                className="item"
                style={{ flexDirection: 'column', alignItems: 'stretch' }}
              >
                <button
                  className="row"
                  style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }}
                  onClick={() => setOpenId(open ? null : d.id)}
                  aria-expanded={open}
                >
                  <span
                    className="avatar"
                    style={{
                      background: d.direction === 'lent' ? 'var(--accent)' : 'var(--cat-6)',
                    }}
                  >
                    {d.person.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="item-main">
                    <div className="item-title">{d.person}</div>
                    <div className="item-sub">
                      {d.direction === 'lent' ? 'Owes you' : 'You owe'} ·{' '}
                      {d.settledAt
                        ? `settled ${formatDate(d.settledAt)}`
                        : `since ${formatDate(history[history.length - 1]?.date ?? d.createdAt.slice(0, 10))}`}
                    </div>
                  </div>
                  <div className="item-amt">
                    <div className="num">{formatINR(b.outstanding)}</div>
                    {b.repaid > 0 && <div className="item-sub">of {formatINR(b.principal)}</div>}
                  </div>
                </button>
                {b.principal > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Progress value={b.repaid / b.principal} thin />
                  </div>
                )}
                {open && (
                  <div className="stack" style={{ marginTop: 12 }}>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      {!d.settledAt && (
                        <button
                          className="btn btn-primary"
                          onClick={() => setMoving({ debt: d, type: 'repayment' })}
                        >
                          {d.direction === 'lent' ? 'Got money back' : 'Paid back'}
                        </button>
                      )}
                      <button className="btn" onClick={() => setMoving({ debt: d, type: 'more' })}>
                        {d.direction === 'lent' ? 'Lent more' : 'Borrowed more'}
                      </button>
                      <span className="spacer" />
                      {!d.settledAt && b.outstanding > 0 && (
                        <ConfirmButton
                          label="Mark settled"
                          confirmLabel="Tap to settle (writes off the rest)"
                          onConfirm={() =>
                            db.debts.update(d.id, {
                              settledAt: today,
                              updatedAt: new Date().toISOString(),
                            })
                          }
                        />
                      )}
                    </div>
                    <div className="list">
                      {history.map((t) => (
                        <TxnRow key={t.id} t={t} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {adding && <DebtSheet onClose={() => setAdding(false)} />}
      {moving && <DebtSheet movement={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

function DebtSheet({
  movement,
  onClose,
}: {
  movement?: { debt: Debt; type: 'more' | 'repayment' };
  onClose: () => void;
}) {
  const { activeAccounts, today, meta, debts } = useStore();
  const { toast } = useUI();
  const [direction, setDirection] = useState<Debt['direction']>(movement?.debt.direction ?? 'lent');
  const [person, setPerson] = useState(movement?.debt.person ?? '');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(
    (meta.lastAccountId as string) || activeAccounts[0]?.id || '',
  );
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const known = [...new Set(debts.map((d) => d.person))];

  const title = movement
    ? movement.type === 'repayment'
      ? movement.debt.direction === 'lent'
        ? `${movement.debt.person} paid you back`
        : `You paid ${movement.debt.person} back`
      : movement.debt.direction === 'lent'
        ? `Lend more to ${movement.debt.person}`
        : `Borrow more from ${movement.debt.person}`
    : 'Lent or borrowed';
  const incoming = movement
    ? (movement.type === 'repayment') === (movement.debt.direction === 'lent')
    : direction === 'borrowed';

  const save = async () => {
    try {
      const paise = toPaise(amount || '0');
      if (paise <= 0) throw new Error('Enter an amount above ₹0.');
      if (movement) {
        await recordDebtMovement({
          debtId: movement.debt.id,
          type: movement.type,
          amount: paise,
          accountId,
          date,
          note: note || undefined,
        });
      } else {
        // Re-use an open record with the same person and direction.
        const existing = debts.find(
          (d) =>
            !d.settledAt &&
            d.direction === direction &&
            d.person.toLowerCase() === person.trim().toLowerCase(),
        );
        if (existing)
          await recordDebtMovement({
            debtId: existing.id,
            type: 'more',
            amount: paise,
            accountId,
            date,
            note: note || undefined,
          });
        else
          await startDebt({
            person,
            direction,
            amount: paise,
            accountId,
            date,
            note: note || undefined,
          });
      }
      toast('Saved');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      {!movement && (
        <>
          <Segmented
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'lent', label: 'I lent' },
              { value: 'borrowed', label: 'I borrowed' },
            ]}
          />
          <Field label="Person" htmlFor="debt-person">
            <input
              id="debt-person"
              className="input"
              list="debt-people"
              placeholder="Name"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              autoFocus
            />
            <datalist id="debt-people">
              {known.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
        </>
      )}
      <Field label="Amount" htmlFor="debt-amount">
        <MoneyInput id="debt-amount" value={amount} onChange={setAmount} autoFocus={!!movement} />
      </Field>
      <div className="field">
        <span className="label">{incoming ? 'Into' : 'Paid from'}</span>
        <div className="chips scroll">
          {activeAccounts.map((a) => (
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
        <Field label="Date" htmlFor="debt-date">
          <input
            id="debt-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </Field>
        <Field label="Note" htmlFor="debt-note">
          <input
            id="debt-note"
            className="input"
            placeholder="Optional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      <div className="note note-ok">
        Changes the {incoming ? 'money in' : 'money out of'} your account, not your spending.
      </div>
      <ErrorNote message={error} />
      <button className="btn btn-primary btn-block" onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

export function PeopleSummary() {
  const { debts, transactions } = useStore();
  const { go } = useUI();
  let owed = 0;
  let owe = 0;
  for (const d of debts) {
    if (d.settledAt) continue;
    const o = debtBalance(d, transactions).outstanding;
    if (d.direction === 'lent') owed += o;
    else owe += o;
  }
  return (
    <Panel
      title="Lent & borrowed"
      action={
        <button className="btn btn-ghost" onClick={() => go('people')}>
          Open
        </button>
      }
    >
      <div className="row" style={{ gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <div>
          <div className="label">Owed to you</div>
          <div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-lg)' }}>
            {formatINR(owed)}
          </div>
        </div>
        <div>
          <div className="label">You owe</div>
          <div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-lg)' }}>
            {formatINR(owe)}
          </div>
        </div>
      </div>
    </Panel>
  );
}
