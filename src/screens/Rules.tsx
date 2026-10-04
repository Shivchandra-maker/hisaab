import { useState } from 'react';
import { CategoryAvatar, EmptyState } from '../design/components';
import { Icon } from '../design/Icon';
import { deleteRule, saveRule } from '../db/repo';
import { useStore } from '../store';
import { useUI } from '../ui';

/** Merchant → category rules, learned from your choices. Edit or forget them here. */
export function Rules() {
  const { rules, categories, categoryById } = useStore();
  const { go, toast } = useUI();
  const [q, setQ] = useState('');
  const list = rules.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <div className="row">
          <button className="icon-btn" onClick={() => go('settings')} aria-label="Back">
            <Icon name="left" size={18} />
          </button>
          <h1>Merchant rules</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        When you add or correct a transaction, Hisaab remembers the category for that merchant and
        uses it next time — for typed entries and for bank messages.
      </p>
      {rules.length > 6 && (
        <input
          className="input"
          aria-label="Search rules"
          placeholder="Search merchants"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <section className="panel">
        {list.length === 0 && (
          <EmptyState title="No rules yet" body="They appear as you categorise payees." />
        )}
        <div className="list">
          {list.map((r) => {
            const c = r.categoryId ? categoryById.get(r.categoryId) : undefined;
            return (
              <div key={r.id} className="item rule-row">
                <CategoryAvatar category={c} small />
                <div className="item-main">
                  <div className="item-title">{r.name}</div>
                  <div className="item-sub">
                    Used {r.hits} time{r.hits === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  aria-label={`Forget ${r.name}`}
                  onClick={async () => {
                    await deleteRule(r.id);
                    toast('Rule removed');
                  }}
                >
                  <Icon name="x" size={16} />
                </button>
                <label className="sr-only" htmlFor={`rule-${r.id}`}>
                  Category for {r.name}
                </label>
                <select
                  id={`rule-${r.id}`}
                  className="input rule-cat"
                  value={r.categoryId ?? ''}
                  onChange={async (e) => {
                    await saveRule({ ...r, categoryId: e.target.value || undefined });
                    toast('Rule updated');
                  }}
                >
                  {categories
                    .filter((x) => !x.archived)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.kind === 'income' ? `Income · ${x.name}` : x.name}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
