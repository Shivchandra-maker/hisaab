import { useMemo, useState } from 'react';
import { EmptyState } from '../design/components';
import { Icon } from '../design/Icon';
import { formatINR } from '../domain/money';
import { FALLBACK_CATEGORY } from '../domain/sms/match';
import { shopsToSort } from '../domain/sms/shops';
import { sortShops } from '../db/setup';
import { useStore } from '../store';
import { useUI } from '../ui';

/** How many shops to show at once: enough to cover most spending, few enough to finish. */
const TOP = 8;

/**
 * "Where does your money go?" — categorise shops, not payments. Our guesses are pre-filled;
 * one tap accepts them all. Each choice becomes a rule for next time and re-files past payments.
 */
export function WhereMoney() {
  const { transactions, rules, categories } = useStore();
  const { go, toast } = useUI();
  const { shops, unsortedTotal } = useMemo(
    () => shopsToSort(transactions, rules),
    [transactions, rules],
  );
  const top = shops.slice(0, TOP);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const cats = categories.filter((c) => c.kind === 'expense' && !c.archived);
  const covered = top.reduce((s, x) => s + x.total, 0);
  const pct = unsortedTotal ? Math.round((covered / unsortedTotal) * 100) : 0;

  const done = async () => {
    setBusy(true);
    try {
      const picks = top
        .map((s) => ({ name: s.name, txnIds: s.txnIds, categoryId: picked[s.key] ?? s.guess }))
        .filter((p): p is { name: string; txnIds: string[]; categoryId: string } => !!p.categoryId);
      const n = await sortShops(picks);
      toast(`Sorted ${picks.length} shop${picks.length === 1 ? '' : 's'} · ${n} payments`);
      if (shops.length <= TOP) go('home');
      else setPicked({});
    } finally {
      setBusy(false);
    }
  };

  if (!shops.length)
    return (
      <div className="page">
        <section className="panel">
          <EmptyState
            title="All sorted"
            body="Every shop you pay has a category. New ones show up here when you’ve paid them a few times."
          />
        </section>
        <button className="btn btn-primary" onClick={() => go('home')}>
          Go to Home
        </button>
      </div>
    );

  return (
    <div className="page narrow">
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <h1 className="onb-title onb-title-sm">Where does your money go?</h1>
        <p className="onb-lead">
          We guessed for the places you pay most. Fix any that look wrong — it sticks for next time.
        </p>
      </div>

      {/* D-03: a plain fact, not a progress bar — nothing here is "done" until you tap the button. */}
      <div className="sort-facts">
        <span>
          <b>{top.length}</b> shop{top.length === 1 ? '' : 's'} · {formatINR(covered)}
        </span>
        {top.length < shops.length && <span>{pct}% of your unsorted spending</span>}
      </div>

      <div className="found-list">
        {top.map((s) => {
          const value = picked[s.key] ?? s.guess ?? '';
          const guessed = !picked[s.key] && !!s.guess;
          const state = value ? (guessed ? 'guess' : 'set') : 'empty';
          return (
            <div key={s.key} className={`found-row shop-row ${value ? '' : 'found-check'}`}>
              <div className="found-main">
                <span className="found-name">{s.name}</span>
                <div className="found-detail">
                  {s.payments} payment{s.payments === 1 ? '' : 's'} · {formatINR(s.total)}
                </div>
              </div>
              <div className={`cat-pick-wrap is-${state}`}>
                {/* Colour is never the only signal (WCAG 1.4.1): each state is also written. */}
                <span className="cat-pick-tag" aria-hidden="true">
                  {state === 'guess' ? 'Our guess' : state === 'set' ? 'Your pick' : 'Needs a pick'}
                </span>
                <div className="cat-pick-box">
                  <select
                    aria-label={`Category for ${s.name}${state === 'guess' ? ' (our guess)' : ''}`}
                    className="cat-pick"
                    value={value}
                    onChange={(e) => setPicked({ ...picked, [s.key]: e.target.value })}
                  >
                    <option value="">Pick…</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Icon name={state === 'set' ? 'check' : 'chevdown'} size={14} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
        Tap a category to change it — it’s remembered for next time.
        {shops.length > top.length &&
          ` ${shops.length - top.length} smaller shops can wait; they stay in ${cats.find((c) => c.id === FALLBACK_CATEGORY)?.name ?? 'Miscellaneous'} until you sort them.`}
      </p>

      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <button className="btn btn-primary btn-block onb-cta" disabled={busy} onClick={done}>
          Looks right — done
        </button>
        <button className="link-btn" style={{ alignSelf: 'center' }} onClick={() => go('home')}>
          Do this later
        </button>
      </div>
    </div>
  );
}
