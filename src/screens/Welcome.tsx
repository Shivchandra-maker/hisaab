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
import { SetupFromSms } from './SetupFromSms';

/** First run: set up from bank SMS (or pasted messages), by hand, or with sample data. */
export function Welcome() {
  const { today } = useStore();
  const [step, setStep] = useState<'hello' | 'accounts' | 'sms'>('hello');
  if (step === 'accounts') return <SetupAccounts />;
  if (step === 'sms') return <SetupFromSms onBack={() => setStep('hello')} />;
  return (
    <div className="onb">
      <div className="brand" style={{ fontSize: 'var(--fs-lg)' }}>
        <span className="brand-mark">₹</span>Hisaab
      </div>

      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="onb-title">What did you really spend this month?</h1>
        <p className="onb-lead">
          Card bills don’t follow the calendar. Hisaab counts each payment on the day you made it,
          and never counts a card bill twice.
        </p>
      </div>

      <div className="onb-bars" aria-label="Your month and a card bill cover different days">
        <div className="onb-bar">
          <div className="onb-bar-label">
            <b>Your month</b>
            <span>1 – 30 Sep</span>
          </div>
          <div className="onb-track">
            <span style={{ left: '35%', right: 0, background: 'var(--accent)' }} />
          </div>
        </div>
        <div className="onb-bar">
          <div className="onb-bar-label">
            <b>Card bill</b>
            <span>16 Aug – 15 Sep</span>
          </div>
          <div className="onb-track">
            <span style={{ left: 0, width: '67%', background: 'var(--cycle)' }} />
          </div>
        </div>
      </div>

      <ul className="onb-points">
        <li>
          <Icon name="calendar" size={20} />
          <span>
            <b>Real monthly spend</b> <span className="muted">— by the day you paid</span>
          </span>
        </li>
        <li>
          <Icon name="card" size={20} />
          <span>
            <b>Each card bill</b> <span className="muted">— what’s due and when</span>
          </span>
        </li>
        <li>
          <Icon name="transfer" size={20} />
          <span>
            <b>Bill payments</b> <span className="muted">— moved, never counted twice</span>
          </span>
        </li>
      </ul>

      <div className="onb-spacer" />

      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="onb-trust">
          <div>
            <Icon name="lock" size={18} />
            Your data never leaves your phone
          </div>
          <div>
            <Icon name="ban" size={18} />
            No ads. No loan offers. Ever.
          </div>
        </div>
        <button className="btn btn-primary btn-block onb-cta" onClick={() => setStep('sms')}>
          <Icon name="message" size={20} />
          Set up from my bank SMS
        </button>
        <p className="onb-sub">We find your accounts and cards. You just check them.</p>
      </div>

      <div className="onb-links">
        <button className="link-btn" onClick={() => setStep('accounts')}>
          Set up manually
        </button>
        <button
          className="link-btn"
          onClick={async () => {
            await loadSample(sampleData(today));
            await ingestMessages(sampleMessages(today), { source: 'paste', receivedAt: today });
          }}
        >
          Try sample data
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
