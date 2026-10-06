import { useState } from 'react';
import {
  BackLink,
  CategoryAvatar,
  ConfirmButton,
  ErrorNote,
  Field,
  Segmented,
  Sheet,
} from '../design/components';
import { Icon, iconNames } from '../design/Icon';
import type { Category, CategoryKind } from '../domain/types';
import { archiveCategory, saveCategory } from '../db/repo';
import { useStore } from '../store';
import { useUI } from '../ui';

const colors = Array.from({ length: 10 }, (_, i) => `cat-${i + 1}`);

export function Categories() {
  const { categories, transactions } = useStore();
  const { go, openCategory } = useUI();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const used = new Map<string, number>();
  for (const t of transactions) {
    for (const id of t.splits?.map((s) => s.categoryId) ?? [t.categoryId])
      if (id) used.set(id, (used.get(id) ?? 0) + 1);
  }
  const list = categories.filter((c) => c.kind === kind && (showArchived || !c.archived));
  const mains = list.filter((c) => !c.parentId);

  return (
    <div className="page">
      <BackLink label="More" onClick={() => go('settings')} />
      <div className="page-head">
        <h1>Categories</h1>
        <button className="btn btn-primary" onClick={() => openCategory({ kind })}>
          Add category
        </button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Segmented
          label="Type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Spending' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <button
          className="chip"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
        >
          Show archived
        </button>
      </div>
      <section className="panel">
        <div className="list">
          {mains.map((c) => (
            <div key={c.id}>
              <CategoryLine c={c} count={used.get(c.id) ?? 0} onClick={() => openCategory(c)} />
              {list
                .filter((s) => s.parentId === c.id)
                .map((s) => (
                  <div key={s.id} style={{ paddingLeft: 44 }}>
                    <CategoryLine
                      c={s}
                      count={used.get(s.id) ?? 0}
                      onClick={() => openCategory(s)}
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>
      <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
        Archiving hides a category from pickers but keeps it on past transactions.
      </p>
    </div>
  );
}

function CategoryLine({ c, count, onClick }: { c: Category; count: number; onClick: () => void }) {
  return (
    <button className="item" onClick={onClick}>
      <CategoryAvatar category={c} small={!!c.parentId} />
      <div className="item-main">
        <div className="item-title">{c.name}</div>
        <div className="item-sub">
          {count} transaction{count === 1 ? '' : 's'}
          {c.archived ? ' · archived' : ''}
        </div>
      </div>
      <Icon name="right" size={16} className="faint" />
    </button>
  );
}

export function CategorySheet({
  initial,
  onClose,
}: {
  initial?: Partial<Category>;
  onClose: () => void;
}) {
  const { categories } = useStore();
  const { toast } = useUI();
  const editing = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(initial?.kind ?? 'expense');
  const [parentId, setParentId] = useState(initial?.parentId ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'dots');
  const [color, setColor] = useState(initial?.color ?? 'cat-3');
  const [error, setError] = useState('');
  const hasChildren = !!initial?.id && categories.some((c) => c.parentId === initial.id);
  const parents = categories.filter(
    (c) => c.kind === kind && !c.parentId && !c.archived && c.id !== initial?.id,
  );

  const save = async () => {
    try {
      await saveCategory({
        ...(initial as Category),
        name,
        kind,
        icon,
        color,
        parentId: parentId || undefined,
        archived: initial?.archived ?? false,
        sortOrder: initial?.sortOrder ?? (undefined as unknown as number),
      });
      toast(editing ? 'Category updated' : 'Category added');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  return (
    <Sheet title={editing ? 'Edit category' : 'Add category'} onClose={onClose}>
      <div className="row">
        <CategoryAvatar category={{ icon, color } as Category} />
        <input
          id="cat-name"
          aria-label="Name"
          className="input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      {!editing && (
        <Segmented
          label="Type"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setParentId('');
          }}
          options={[
            { value: 'expense', label: 'Spending' },
            { value: 'income', label: 'Income' },
          ]}
        />
      )}
      {!hasChildren && (
        <Field
          label="Inside"
          htmlFor="cat-parent"
          hint="Optional. Makes this a sub-category, e.g. Food › Eating out."
        >
          <select
            id="cat-parent"
            className="input"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">Main category</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="field">
        <span className="label">Colour</span>
        <div className="chips">
          {colors.map((c) => (
            <button
              key={c}
              className="swatch-btn"
              aria-label={`Colour ${c}`}
              aria-pressed={c === color}
              style={{ background: `var(--${c})` }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">Icon</span>
        <div className="chips">
          {iconNames.map((n) => (
            <button
              key={n}
              className="icon-btn"
              aria-label={n}
              aria-pressed={n === icon}
              style={
                n === icon ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined
              }
              onClick={() => setIcon(n)}
            >
              <Icon name={n} size={17} />
            </button>
          ))}
        </div>
      </div>
      <ErrorNote message={error} />
      <div className="row">
        {editing && (
          <ConfirmButton
            label={initial?.archived ? 'Unarchive' : 'Archive'}
            confirmLabel="Tap again to confirm"
            onConfirm={async () => {
              await archiveCategory(initial!.id!, !initial?.archived);
              toast(initial?.archived ? 'Category restored' : 'Category archived');
              onClose();
            }}
          />
        )}
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
