import { useState } from 'react';
import { AccountAvatar, EmptyState } from '../design/components';
import { Icon } from '../design/Icon';
import { ordinal } from '../domain/dates';
import { balanceOf } from '../domain/ledger';
import { formatINR } from '../domain/money';
import type { AccountKind } from '../domain/types';
import { loadSample, setMeta } from '../db/repo';
import { sampleData, sampleMessages } from '../sample/sample';
import { ingestMessages } from '../db/inbox';
import { useStore } from '../store';
import { useUI } from '../ui';

/** First run: start with your own accounts, or explore with sample data. */
export function Welcome() {
  const { today } = useStore();
  const [step, setStep] = useState<'hello' | 'accounts'>('hello');
  if (step === 'accounts') return <SetupAccounts />;
  return (
    <div className="welcome">
      <div className="brand" style={{ fontSize: 'var(--fs-xl)' }}>
        <span className="brand-mark">₹</span>Hisaab
      </div>
      <h1 className="welcome-title">
        Know what you spent this month — and what each card will bill.
      </h1>
      <ul className="welcome-points muted">
        <li>
          <Icon name="calendar" size={18} />
          Spending counted on the day you spent it, across bank, cash, UPI and cards.
        </li>
        <li>
          <Icon name="card" size={18} />
          Card statements kept separately, with due dates — bill payments never counted twice.
        </li>
        <li>
          <Icon name="check" size={18} />
          Your data stays on this device. No bank login, no ads, no loans.
        </li>
      </ul>
      <div className="stack" style={{ width: '100%', maxWidth: 360 }}>
        <button className="btn btn-primary btn-block" onClick={() => setStep('accounts')}>
          Set up my accounts
        </button>
        <button
          className="btn btn-block"
          onClick={async () => {
            await loadSample(sampleData(today));
            await ingestMessages(sampleMessages(today), { source: 'paste', receivedAt: today });
          }}
        >
          Explore with sample data
        </button>
      </div>
    </div>
  );
}

const presets: { kind: AccountKind; label: string; hint: string }[] = [
  { kind: 'bank', label: 'Bank account', hint: 'Savings or salary account' },
  { kind: 'credit_card', label: 'Credit card', hint: 'With its statement day' },
  { kind: 'cash', label: 'Cash', hint: 'Money in your wallet' },
  { kind: 'wallet', label: 'UPI Lite / wallet', hint: 'Prepaid balances' },
];

function SetupAccounts() {
  const { accounts, transactions, today } = useStore();
  const { openAccount } = useUI();
  return (
    <div className="welcome" style={{ justifyContent: 'flex-start' }}>
      <div className="brand">
        <span className="brand-mark">₹</span>Hisaab
      </div>
      <div className="stack" style={{ width: '100%', maxWidth: 560 }}>
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>Add your accounts</h1>
        <p className="muted" style={{ margin: 0 }}>
          Start with the ones you use most. Enter today’s balance — you can add more accounts any
          time. UPI isn’t an account: it’s recorded on the bank or RuPay card it comes from.
        </p>
        <div className="preset-grid">
          {presets.map((p) => (
            <button key={p.kind} className="preset" onClick={() => openAccount({ kind: p.kind })}>
              <Icon name="plus" size={18} />
              <span>
                <b>{p.label}</b>
                <br />
                <span className="faint">{p.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <section className="panel">
          {accounts.length === 0 ? (
            <EmptyState title="No accounts yet" body="Add at least one to start tracking." />
          ) : (
            <div className="list">
              {accounts.map((a) => (
                <button key={a.id} className="item" onClick={() => openAccount(a)}>
                  <AccountAvatar account={a} />
                  <div className="item-main">
                    <div className="item-title">{a.name}</div>
                    <div className="item-sub">
                      {a.kind === 'credit_card'
                        ? `Statement on the ${ordinal(a.card?.statementDay ?? 1)} · owed`
                        : 'Balance'}
                    </div>
                  </div>
                  <span className="num">{formatINR(balanceOf(a, transactions, today))}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <button
          className="btn btn-primary btn-block"
          disabled={accounts.length === 0}
          onClick={() => setMeta('onboarded', true)}
        >
          {accounts.length === 0 ? 'Add an account to continue' : 'Start tracking'}
        </button>
      </div>
    </div>
  );
}
