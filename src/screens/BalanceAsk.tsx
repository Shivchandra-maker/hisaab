import { useState } from 'react';
import { Icon } from '../design/Icon';
import { balanceCheckFor, smsLink } from '../domain/bankContacts';
import { daysBetween, formatTime, timeIST } from '../domain/dates';
import type { Account } from '../domain/types';
import { saveAccount } from '../db/repo';
import { useUI } from '../ui';

/**
 * "Check with your bank" on a bank account (U-11): Send SMS opens Messages with the balance
 * request filled in; the bank's reply is read like any bank SMS and the balance matches itself
 * (BankCheck shows "Matches your bank"). Missed call works where the bank replies by SMS too.
 */
export function BalanceAsk({ account, today }: { account: Account; today: string }) {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const c = balanceCheckFor(account);
  const bank = account.institution ?? account.name;
  const [editing, setEditing] = useState(false);
  const [asked, setAsked] = useState<string>();
  const [sms, setSms] = useState(c.sms ?? '');
  const [text, setText] = useState(c.text ?? '');
  const [call, setCall] = useState(c.call ?? '');

  if (account.kind !== 'bank') return null;

  const save = async () => {
    await saveAccount({
      ...account,
      balanceCheck: {
        sms: sms.trim() || undefined,
        text: text.trim() || undefined,
        call: call.trim() || undefined,
      },
    });
    setEditing(false);
    toast('Saved for this account');
  };

  // D-16: a rare action gets one quiet line, not a panel. It speaks up only when the balance
  // hasn't been confirmed by the bank for a week.
  const age = account.check ? daysBetween(account.check.date, today) : undefined;
  const stale = age === undefined || age >= 7;
  // When it's fresh, "Matches your bank" above already says so — this row just offers the check.
  const status = !stale
    ? `Check with ${bank}`
    : age === undefined
      ? `${bank} hasn’t confirmed this balance yet`
      : `Last confirmed by ${bank} ${age} days ago`;

  return (
    <div className={`ask-row ${stale ? 'is-stale' : ''}`}>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <span className="ask-status">{status}</span>
        <span className="spacer" />
        {c.sms && (
          <a
            className={`btn btn-sm ${stale ? 'btn-soft' : ''}`}
            href={smsLink(c.sms, c.text)}
            onClick={() => setAsked(timeIST())}
          >
            <Icon name="message" size={15} /> Ask by SMS
          </a>
        )}
        {c.call && (
          <a className="btn btn-sm" href={`tel:${c.call}`} onClick={() => setAsked(timeIST())}>
            <Icon name="phone" size={15} /> Missed call
          </a>
        )}
        <button
          className="icon-btn"
          aria-expanded={open}
          aria-label="How checking with the bank works"
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'x' : 'dots'} size={16} />
        </button>
      </div>
      {asked && (
        <div className="note" style={{ marginTop: 'var(--sp-2)' }}>
          Asked at {formatTime(asked)}. When {bank}’s reply arrives, the balance above updates —
          pull down on Home if it doesn’t within a minute.
        </div>
      )}
      {open && (
        <div className="stack" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
            {bank} replies with the balance by SMS. Hisaab reads the reply and matches this account
            to it — no typing. Works from the mobile number registered with your bank; some banks
            need SMS banking turned on first. Normal SMS charges may apply.
          </p>
          {editing ? (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              <div className="grid-2" style={{ gap: 'var(--sp-2)' }}>
                <label className="field">
                  <span className="label">SMS to</span>
                  <input
                    className="input num"
                    inputMode="tel"
                    value={sms}
                    onChange={(e) => setSms(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="label">Message</span>
                  <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span className="label">Missed call number</span>
                <input
                  className="input num"
                  inputMode="tel"
                  value={call}
                  onChange={(e) => setCall(e.target.value)}
                />
              </label>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <button className="btn btn-primary" onClick={save}>
                  Save
                </button>
                <button
                  className="btn"
                  // Throw away what was typed: the next edit starts from what's saved.
                  onClick={() => {
                    setSms(c.sms ?? '');
                    setText(c.text ?? '');
                    setCall(c.call ?? '');
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
              <span className="faint" style={{ flex: 1, fontSize: 'var(--fs-sm)' }}>
                {c.sms
                  ? c.text
                    ? `SMS “${c.text}” to ${c.sms}.`
                    : `SMS to ${c.sms}.`
                  : `We don’t have ${bank}’s balance SMS number yet.`}
                {c.call ? ` Missed call: ${c.call}.` : ''}
              </span>
              <button
                className="link-btn"
                onClick={() => {
                  setSms(c.sms ?? '');
                  setText(c.text ?? '');
                  setCall(c.call ?? '');
                  setEditing(true);
                }}
              >
                {c.known ? 'Change numbers' : 'Add numbers'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
