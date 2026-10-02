import { useState } from 'react';
import {
  Amount,
  CategoryAvatar,
  MonthSwitcher,
  Panel,
  Progress,
  Segmented,
  StatusPill,
} from '../design/components';
import { Icon } from '../design/Icon';
import { useStore } from '../store';

const colorTokens: [string, string][] = [
  ['--bg', 'Page'],
  ['--surface', 'Surface'],
  ['--surface-2', 'Sunken'],
  ['--line', 'Lines'],
  ['--fg', 'Text'],
  ['--fg-2', 'Secondary text'],
  ['--fg-3', 'Hints'],
  ['--accent', 'Accent · calendar month · your money'],
  ['--accent-soft', 'Accent soft'],
  ['--cycle', 'Card statement period'],
  ['--cycle-soft', 'Cycle soft'],
  ['--pos', 'Income'],
  ['--warn', 'Due soon / over pace'],
  ['--neg', 'Overdue / over budget'],
];

export function StyleGuide() {
  const { categories } = useStore();
  const [seg, setSeg] = useState('a');
  const [month, setMonth] = useState('2026-10');
  return (
    <div className="page">
      <div className="page-head">
        <h1>Style guide</h1>
        <span className="faint">Phase 0 · design system v1</span>
      </div>

      <Panel title="Principles">
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>Numbers are the heroes. One big figure per screen; everything else supports it.</li>
          <li>
            Colour carries meaning only: green = calendar month and your money, indigo = card
            statement period, amber/red = needs attention.
          </li>
          <li>Spending stays neutral, never red. Red is for overdue bills and blown budgets.</li>
          <li>Adding an expense takes three taps: amount, category, save.</li>
          <li>Transfers are visibly different (grey, ⇄) and are never counted as spending.</li>
        </ul>
      </Panel>

      <Panel title="Colour">
        <div className="swatches">
          {colorTokens.map(([t, name]) => (
            <div className="swatch" key={t}>
              <div style={{ background: `var(${t})` }} />
              <p>
                <b>{t}</b>
                <br />
                {name}
              </p>
            </div>
          ))}
        </div>
        <div className="label" style={{ margin: '16px 0 8px' }}>
          Category palette
        </div>
        <div className="chips">
          {categories
            .filter((c) => c.kind === 'expense')
            .map((c) => (
              <span key={c.id} className="chip">
                <CategoryAvatar category={c} small />
                {c.name}
              </span>
            ))}
        </div>
      </Panel>

      <Panel title="Type">
        <div className="stack">
          <div className="hero-amount num">₹42,380</div>
          <h1>Display · Sora 600</h1>
          <h2>Section title · Sora 600</h2>
          <p style={{ margin: 0 }}>
            Body · Figtree 400, 15px. Amounts use tabular figures so columns line up:{' '}
            <span className="num">₹1,250 · ₹12,50,000</span>
          </p>
          <span className="label">Label · uppercase 12px</span>
        </div>
      </Panel>

      <Panel title="Components">
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary">
              <Icon name="plus" size={16} />
              Add expense
            </button>
            <button className="btn">Secondary</button>
            <button className="btn btn-ghost">Text button</button>
            <button className="icon-btn" aria-label="Search">
              <Icon name="search" size={18} />
            </button>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Segmented
              label="Demo"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'a', label: 'Expense' },
                { value: 'b', label: 'Income' },
                { value: 'c', label: 'Transfer' },
              ]}
            />
            <MonthSwitcher month={month} onChange={setMonth} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <StatusPill status="open" />
            <StatusPill status="paid" />
            <StatusPill status="due" />
            <StatusPill status="overdue" />
            <span className="pill pill-neutral">Neutral</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 24 }}>
            <span>
              Expense <Amount value={64900} kind="expense" />
            </span>
            <span>
              Income <Amount value={11500000} kind="income" />
            </span>
            <span>
              Transfer <Amount value={2000000} kind="transfer" />
            </span>
          </div>
          <Progress value={0.62} />
          <Progress value={0.35} color="var(--cycle)" thin />
          <div className="split-bar">
            <span className="now" style={{ width: '40%' }} />
            <span className="next" style={{ width: '60%' }} />
          </div>
          <div className="note note-cycle">Card note: appears on the statement of 15 Oct.</div>
          <div className="note note-ok">
            Bill reserve: ₹18,400 of your bank balance is owed to cards.
          </div>
        </div>
      </Panel>
    </div>
  );
}
