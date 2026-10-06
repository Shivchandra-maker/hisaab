import { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Segmented } from '../design/components';
import { Icon } from '../design/Icon';
import { cleanAmountInput, formatINR, toPaise, toRupees } from '../domain/money';
import { contactsLoaded, isContact, suggestPeople } from '../domain/people';
import type { Transaction } from '../domain/types';
import { equalParts, paidForOthers } from '../db/loans';
import { isAndroidApp } from '../native/capture';
import { useStore } from '../store';
import { useUI } from '../ui';

type Mode = 'equal' | 'custom';

/**
 * "Paid for someone?" on a payment you made — one friend or a whole group (U-21).
 * Names come from your contacts (and people already in Lent & borrowed) as you type; anyone else
 * can be typed in. Split equally (with or without you) or type each part.
 * Each person's part becomes money lent; only your part stays your spending.
 */
/**
 * What the sheet's Save button should also do (D-19: one primary button). `label` goes on the
 * button ("Save · lend ₹1,560 to 2 people"); `commit` runs after the payment itself is saved.
 */
export interface PendingSplit {
  label: string;
  commit: () => Promise<void>;
}

export function PaidForOthers({
  txn,
  total,
  onPending,
}: {
  txn: Transaction;
  /** The amount as currently typed in the sheet (it may differ from the saved one). */
  total: number;
  /** Tells the sheet what Save should also do; null when nothing is set up. */
  onPending: (p: PendingSplit | null) => void;
}) {
  const { debts } = useStore();
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [withMe, setWithMe] = useState(true);
  const [mode, setMode] = useState<Mode>('equal');
  const [custom, setCustom] = useState<Record<string, string>>({});

  const known = useMemo(() => [...new Set(debts.map((d) => d.person))], [debts]);
  const suggestions = suggestPeople(query, known).filter(
    (n) => !people.some((p) => p.toLowerCase() === n.toLowerCase()),
  );

  // Who pays what, in paise. "me" is your share; everyone else is lent.
  const parts = useMemo(() => {
    const names = withMe ? ['me', ...people] : people;
    if (mode === 'equal') {
      const eq = equalParts(total, names.length);
      return Object.fromEntries(names.map((n, i) => [n, eq[i] ?? 0])) as Record<string, number>;
    }
    const out: Record<string, number> = {};
    for (const p of people) out[p] = custom[p] ? toPaise(custom[p]!) : 0;
    if (withMe) out.me = Math.max(0, total - people.reduce((n, p) => n + (out[p] ?? 0), 0));
    return out;
  }, [people, withMe, mode, custom, total]);
  const assigned = Object.entries(parts).reduce((n, [k, v]) => n + (k === 'me' ? 0 : v), 0);
  const left = total - assigned - (withMe ? (parts.me ?? 0) : 0);

  // Check the split as it's typed; Save in the sheet commits it (D-19).
  const problem = !people.length
    ? ''
    : !withMe && left !== 0
      ? left > 0
        ? `${formatINR(left)} isn’t given to anyone yet.`
        : `That’s ${formatINR(-left)} more than you paid.`
      : withMe && assigned > total
        ? 'The parts add up to more than you paid.'
        : '';
  const shares = people.map((p) => ({ person: p, amount: parts[p] ?? 0 }));
  const sharesKey = JSON.stringify(shares);
  useEffect(() => {
    if (!open || !people.length) return onPending(null);
    const who = people.length === 1 ? people[0]! : `${people.length} people`;
    onPending({
      label: `Save · lend ${formatINR(assigned)} to ${who}`,
      commit: async () => {
        if (problem) throw new Error(problem);
        await paidForOthers(txn.id, shares);
        toast(`${formatINR(assigned)} lent to ${who} — see Lent & borrowed`);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sharesKey, assigned, problem, txn.id]);
  useEffect(() => () => onPending(null), [onPending]);

  if (txn.grossAmount)
    return (
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
        You paid {formatINR(txn.grossAmount)}; {formatINR(txn.amount)} was yours. The rest is in
        Lent &amp; borrowed.
      </p>
    );
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

  const add = (name: string) => {
    const n = name.trim();
    if (!n || people.some((p) => p.toLowerCase() === n.toLowerCase())) return;
    setPeople([...people, n]);
    setQuery('');
  };
  const remove = (name: string) => {
    setPeople(people.filter((p) => p !== name));
    const rest = { ...custom };
    delete rest[name];
    setCustom(rest);
  };

  return (
    <div className="panel stack pfo" style={{ gap: 'var(--sp-3)', padding: 'var(--sp-3)' }}>
      <div className="row">
        <b style={{ fontSize: 'var(--fs-sm)' }}>Paid for others</b>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {formatINR(total)} paid
        </span>
      </div>

      <div className="pfo-who">
        <label className="label" htmlFor="pfo-q">
          Who
        </label>
        <div className="pfo-chips">
          {people.map((p) => (
            <span key={p} className="pfo-chip">
              {p}
              <button aria-label={`Remove ${p}`} onClick={() => remove(p)}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          <input
            id="pfo-q"
            className="pfo-input"
            placeholder={people.length ? 'Add another' : 'Type a name'}
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add(suggestions[0] ?? query);
              } else if (e.key === 'Backspace' && !query && people.length)
                remove(people[people.length - 1]!);
            }}
          />
        </div>
        {query.trim() && (
          <div className="pfo-suggest" role="listbox" aria-label="Suggestions">
            {suggestions.map((n) => (
              <button key={n} role="option" aria-selected="false" onClick={() => add(n)}>
                <Icon name={isContact(n) ? 'user' : 'transfer'} size={14} />
                {n}
              </button>
            ))}
            {!suggestions.some((n) => n.toLowerCase() === query.trim().toLowerCase()) && (
              <button role="option" aria-selected="false" onClick={() => add(query)}>
                <Icon name="plus" size={14} />
                Add “{query.trim()}”<span className="faint"> · not in contacts</span>
              </button>
            )}
          </div>
        )}
        {isAndroidApp && !contactsLoaded() && (
          <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            Allow contacts (More → Automatic capture) to pick names as you type.
          </span>
        )}
      </div>

      {people.length > 0 && (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            <Segmented<Mode>
              label="Split"
              value={mode}
              onChange={(m) => {
                // Custom starts from the equal split, so you only change what differs.
                if (m === 'custom')
                  setCustom(
                    Object.fromEntries(
                      people.map((p) => [p, custom[p] || String(toRupees(parts[p] ?? 0))]),
                    ),
                  );
                setMode(m);
              }}
              options={[
                { value: 'equal', label: 'Equally' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            <label className="row" style={{ gap: 6, fontSize: 'var(--fs-sm)' }}>
              <input
                type="checkbox"
                checked={withMe}
                onChange={(e) => setWithMe(e.target.checked)}
              />
              Include me
            </label>
          </div>

          <div className="list pfo-parts">
            {withMe && (
              <div className="item">
                <div className="item-main">
                  <div className="item-title">Me</div>
                  <div className="item-sub">
                    {mode === 'custom' ? 'what’s left — your spending' : 'your spending'}
                  </div>
                </div>
                <span className="num">{formatINR(parts.me ?? 0)}</span>
              </div>
            )}
            {people.map((p) => (
              <div key={p} className="item">
                <div className="item-main">
                  <div className="item-title">{p}</div>
                  <div className="item-sub">lent to them</div>
                </div>
                {mode === 'equal' ? (
                  <span className="num">{formatINR(parts[p] ?? 0)}</span>
                ) : (
                  <input
                    className="input num pfo-amt"
                    inputMode="decimal"
                    aria-label={`${p}’s part`}
                    placeholder="0"
                    value={custom[p] ?? ''}
                    onChange={(e) =>
                      setCustom({
                        ...custom,
                        [p]: cleanAmountInput(e.target.value, custom[p] ?? ''),
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>

          {mode === 'custom' && !withMe && left !== 0 && (
            <div className={`note ${left < 0 ? 'note-warn' : ''}`}>
              {left > 0
                ? `${formatINR(left)} left to give out`
                : `${formatINR(-left)} more than you paid`}
              {left > 0 && people.length > 0 && (
                <button
                  className="link-btn"
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    const last = people[people.length - 1]!;
                    setCustom({
                      ...custom,
                      [last]: String(toRupees((parts[last] ?? 0) + left)),
                    });
                  }}
                >
                  Give it to {people[people.length - 1]}
                </button>
              )}
            </div>
          )}
          <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
            Your account and card bill keep the full {formatINR(total)}. Their parts wait in Lent
            &amp; borrowed; paying you back closes them — it’s not income.
          </p>
        </>
      )}

      {problem && <ErrorNote message={problem} />}
      <button
        className="link-btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          setOpen(false);
          setPeople([]);
          setCustom({});
        }}
      >
        Don’t split this payment
      </button>
    </div>
  );
}
