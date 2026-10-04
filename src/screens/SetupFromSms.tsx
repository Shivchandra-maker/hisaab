import { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Progress } from '../design/components';
import { Icon } from '../design/Icon';
import { formatDate, ordinal } from '../domain/dates';
import { formatINR } from '../domain/money';
import type { FoundAccount } from '../domain/sms/discover';
import type { CapturedMessage } from '../db/inbox';
import { finishSetup, pastedToCaptured, scanMessages, type SetupChoice } from '../db/setup';
import { Capture, isAndroidApp, requestContacts } from '../native/capture';
import { useStore } from '../store';
import { useUI } from '../ui';

/** How far back the first scan reads: long enough to see at least one card statement. */
const SCAN_DAYS = 180;

type Step = 'source' | 'reading' | 'review' | 'saving';

/**
 * First launch: read bank messages → "We found N accounts" → add them and every payment.
 * Android reads the SMS inbox; the browser works from pasted messages.
 */
export function SetupFromSms({ onBack }: { onBack: () => void }) {
  const { today } = useStore();
  const { go } = useUI();
  const [step, setStep] = useState<Step>(isAndroidApp ? 'reading' : 'source');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<CapturedMessage[]>([]);
  const [found, setFound] = useState<FoundAccount[]>([]);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number }>();

  const scan = (msgs: CapturedMessage[]) => {
    setMessages(msgs);
    setFound(scanMessages(msgs));
    setStep('review');
  };

  const readPhone = async () => {
    setError('');
    setStep('reading');
    try {
      let st = await Capture.status();
      if (!st.sms) st = await Capture.requestSms();
      if (!st.sms) {
        setError('Hisaab needs permission to read bank SMS. Personal messages are never read.');
        setStep('source');
        return;
      }
      // Contacts tell friends from shops, so "Spent or lent?" is only asked about people you know.
      await requestContacts().catch(() => false);
      const { messages: msgs } = await Capture.readInbox({
        sinceMs: Date.now() - SCAN_DAYS * 86_400_000,
        limit: 20_000,
      });
      scan(msgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('source');
    }
  };

  useEffect(() => {
    if (isAndroidApp) void readPhone();
    // Runs once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (step === 'reading')
    return (
      <div className="onb">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <h1 className="onb-title onb-title-sm">Reading your bank messages</h1>
          <p className="onb-lead">Last 6 months. Personal chats are skipped.</p>
        </div>
        <div className="bar onb-indeterminate" role="progressbar" aria-label="Reading">
          <span />
        </div>
        <Trust />
      </div>
    );

  if (step === 'source')
    return (
      <div className="onb">
        <button className="link-btn onb-back" onClick={onBack}>
          <Icon name="left" size={16} /> Back
        </button>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <h1 className="onb-title onb-title-sm">
            {isAndroidApp ? 'Allow bank SMS' : 'Paste your bank messages'}
          </h1>
          <p className="onb-lead">
            {isAndroidApp
              ? 'Hisaab reads payment messages from banks and cards to find your accounts.'
              : 'The browser can’t read SMS. Copy a few weeks of bank and card messages from your phone and paste them here — we’ll find your accounts from them.'}
          </p>
        </div>
        {!isAndroidApp && (
          <>
            <label className="sr-only" htmlFor="setup-paste">
              Messages
            </label>
            <textarea
              id="setup-paste"
              className="input paste-box"
              rows={9}
              placeholder={'Paste messages here.\nLeave a blank line between messages.'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        )}
        <ErrorNote message={error} />
        <div className="onb-spacer" />
        <Trust />
        <button
          className="btn btn-primary btn-block onb-cta"
          disabled={!isAndroidApp && !text.trim()}
          onClick={() => (isAndroidApp ? readPhone() : scan(pastedToCaptured(text, today)))}
        >
          {isAndroidApp ? 'Allow and read messages' : 'Find my accounts'}
        </button>
      </div>
    );

  if (step === 'saving')
    return (
      <div className="onb">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <h1 className="onb-title onb-title-sm">Adding your payments</h1>
          <p className="onb-lead">
            {progress
              ? `${progress.label} · ${progress.done} of ${progress.total}`
              : 'Creating your accounts…'}
          </p>
        </div>
        <Progress value={progress && progress.total ? progress.done / progress.total : 0.05} />
      </div>
    );

  return (
    <FoundAccounts
      found={found}
      onBack={() => setStep('source')}
      onDone={async (choices, cash) => {
        setStep('saving');
        try {
          go('sort');
          await finishSetup(choices, messages, {
            cash,
            onProgress: (label, done, total) => setProgress({ label, done, total }),
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setStep('review');
        }
      }}
      error={error}
    />
  );
}

function Trust() {
  return (
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
  );
}

function detail(f: FoundAccount): string {
  if (f.kind === 'credit_card') {
    if (f.statementDay)
      return `Bill on the ${ordinal(f.statementDay)}${f.dueDaysAfterStatement !== undefined ? ` · due ${f.dueDaysAfterStatement} days later` : ''}`;
    return `Last used ${formatDate(f.lastSeen)}`;
  }
  if (f.balance) return `Balance ${formatINR(f.balance.amount)} on ${formatDate(f.balance.date)}`;
  if (f.key === 'lite') return 'UPI Lite';
  return `Last used ${formatDate(f.lastSeen)}`;
}

function FoundAccounts({
  found,
  onBack,
  onDone,
  error,
}: {
  found: FoundAccount[];
  onBack: () => void;
  onDone: (choices: SetupChoice[], cash: boolean) => void;
  error: string;
}) {
  const [keep, setKeep] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(found.map((f) => [f.key, !f.unsure])),
  );
  const [merge, setMerge] = useState<Record<string, boolean | undefined>>({});
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(found.map((f) => [f.key, f.name])),
  );
  const [editing, setEditing] = useState<string>();
  const [cash, setCash] = useState(true);

  const count = useMemo(
    () =>
      found.filter((f) => keep[f.key] && !(f.mergeInto && merge[f.key] === true)).length +
      (cash ? 1 : 0),
    [found, keep, merge, cash],
  );

  if (!found.length)
    return (
      <div className="onb">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <h1 className="onb-title onb-title-sm">No bank messages found</h1>
          <p className="onb-lead">
            We couldn’t find payment messages from banks or cards. You can paste some again, or set
            up your accounts by hand.
          </p>
        </div>
        <div className="onb-spacer" />
        <button className="btn btn-primary btn-block onb-cta" onClick={onBack}>
          Try again
        </button>
      </div>
    );

  return (
    <div className="onb">
      <button className="link-btn onb-back" onClick={onBack}>
        <Icon name="left" size={16} /> Back
      </button>
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <h1 className="onb-title onb-title-sm">
          We found {found.length} account{found.length === 1 ? '' : 's'}
        </h1>
        <p className="onb-lead">Untick any that aren’t yours. Tap a name to fix it.</p>
      </div>

      <div className="found-list">
        {found.map((f) => {
          const merged = !!f.mergeInto && merge[f.key] === true;
          const asking = !!f.check && merge[f.key] === undefined && !!f.mergeInto;
          return (
            <div key={f.key} className={`found-row ${f.check && asking ? 'found-check' : ''}`}>
              <input
                type="checkbox"
                aria-label={`Keep ${names[f.key]}`}
                checked={!!keep[f.key]}
                onChange={(e) => setKeep({ ...keep, [f.key]: e.target.checked })}
              />
              <div className="found-main">
                {editing === f.key ? (
                  <input
                    className="input"
                    autoFocus
                    aria-label="Account name"
                    value={names[f.key]}
                    onChange={(e) => setNames({ ...names, [f.key]: e.target.value })}
                    onBlur={() => setEditing(undefined)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditing(undefined)}
                  />
                ) : (
                  <button className="found-name" onClick={() => setEditing(f.key)}>
                    {names[f.key]}
                    {f.last4 && <span className="found-last4"> ••{f.last4}</span>}
                  </button>
                )}
                <div className={`found-detail ${f.kind === 'credit_card' ? 'is-card' : ''}`}>
                  {merged ? `Merged into ${names[f.mergeInto!]}` : detail(f)}
                </div>
                {f.check && !f.mergeInto && (
                  <div className="found-ask">
                    <span className="pill pill-warn">Check</span>
                    {f.check}
                  </div>
                )}
                {asking && (
                  <>
                    <div className="found-ask">
                      <span className="pill pill-warn">Check</span>
                      {f.check}
                    </div>
                    <div className="row" style={{ gap: 'var(--sp-2)' }}>
                      <button
                        className="btn btn-sm btn-soft"
                        onClick={() => setMerge({ ...merge, [f.key]: true })}
                      >
                        Merge
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setMerge({ ...merge, [f.key]: false })}
                      >
                        Keep separate
                      </button>
                    </div>
                  </>
                )}
              </div>
              <span className="found-count">{f.messages} msgs</span>
            </div>
          );
        })}
        <label className="found-row">
          <input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} />
          <div className="found-main">
            <span className="found-name">Cash</span>
            <div className="found-detail">For ATM withdrawals and cash spends</div>
          </div>
        </label>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
        Missed one? Add it later in Accounts.
      </p>

      <ErrorNote message={error} />
      <div className="onb-spacer" />
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <button
          className="btn btn-primary btn-block onb-cta"
          disabled={count === 0}
          onClick={() =>
            onDone(
              found.map((f) => ({
                found: f,
                keep: !!keep[f.key],
                mergeInto: f.mergeInto && merge[f.key] === true ? f.mergeInto : undefined,
                name: names[f.key] ?? f.name,
              })),
              cash,
            )
          }
        >
          Add {count} account{count === 1 ? '' : 's'}
        </button>
        <p className="onb-sub">Then your payments are added for you. You only sort the shops.</p>
      </div>
    </div>
  );
}
