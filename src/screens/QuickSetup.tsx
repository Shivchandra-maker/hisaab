import { App } from '@capacitor/app';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNote, Progress, Sheet } from '../design/components';
import { Icon } from '../design/Icon';
import { setMeta } from '../db/repo';
import type { IngestSummary } from '../db/inbox';
import {
  Capture,
  IMPORT_RANGES,
  importPastMessages,
  isAndroidApp,
  type CaptureStatus,
  type ImportRange,
} from '../native/capture';
import { useStore } from '../store';
import { useUI } from '../ui';

const RANGE_HINT: Record<ImportRange, string> = {
  '7d': 'Just this week — quickest to review.',
  '30d': 'A full month, so this month’s totals are right from day one.',
  '1y': 'A year of history for insights. Expect a long review list.',
  all: 'Everything still on your phone. Can take a minute.',
};

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setup-step">
      <span className={`setup-num ${done ? 'is-done' : ''}`} aria-hidden>
        {done ? <Icon name="check" size={14} /> : n}
      </span>
      <div className="setup-body">
        <div className="item-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

/**
 * First-run window in the Android app: allow SMS, pick how far back to read, go.
 * Also opened from Settings › Automatic capture. In a browser it's a read-only preview.
 */
export function QuickSetup({ onClose }: { onClose: () => void }) {
  const { meta } = useStore();
  const { go } = useUI();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [range, setRange] = useState<ImportRange>('30d');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<IngestSummary | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!isAndroidApp) return;
    try {
      setStatus(await Capture.status());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!isAndroidApp) return;
    const h = App.addListener('resume', () => void refresh());
    return () => void h.then((x) => x.remove());
  }, [refresh]);

  const finish = () => {
    void setMeta('quickSetupDone', true);
    onClose();
  };

  const reading = progress !== null && result === null;

  const start = async () => {
    setError('');
    try {
      let st = status;
      if (!st?.sms) {
        st = await Capture.requestSms();
        setStatus(st);
        if (!st.sms) {
          setError('Hisaab needs SMS permission to read bank messages.');
          return;
        }
      }
      setProgress({ done: 0, total: 0 });
      const s = await importPastMessages(range, (done, total) => setProgress({ done, total }));
      setResult(s);
      void setMeta('quickSetupDone', true);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (result) {
    return (
      <Sheet
        title="All set"
        onClose={finish}
        footer={
          <div className="sheet-actions">
            <button className="btn" onClick={finish}>
              Later
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                finish();
                go('inbox');
              }}
            >
              Review in Inbox
            </button>
          </div>
        }
      >
        <p style={{ margin: 0 }}>
          Read <strong>{result.read}</strong> bank messages.{' '}
          {result.toReview > 0
            ? `${result.toReview} payments are waiting in your Inbox.`
            : 'Nothing new to review.'}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
          {[
            result.duplicates && `${result.duplicates} look like duplicates`,
            result.notices && `${result.notices} autopay/EMI notices`,
            result.ignored && `${result.ignored} OTPs and offers skipped`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
          From now on, new messages arrive on their own. Payments older than an account’s opening
          balance date show in history and insights but don’t change its balance.
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet
      title="Quick setup"
      onClose={reading ? () => {} : finish}
      footer={
        <div className="sheet-actions">
          <button className="btn" onClick={finish} disabled={reading}>
            Skip for now
          </button>
          <button className="btn btn-primary" onClick={start} disabled={!isAndroidApp || reading}>
            {reading
              ? progress!.total
                ? `Reading ${progress!.done} of ${progress!.total}…`
                : 'Reading…'
              : status?.sms
                ? 'Start reading'
                : 'Allow SMS & start'}
          </button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Hisaab reads payment messages from banks and cards and files them in your Inbox. Personal
        messages are never read, and nothing leaves your phone.
      </p>

      <div className="setup-steps">
        <Step n={1} done={!!status?.sms} title="Allow bank SMS">
          <div className="item-sub">
            {status?.sms ? 'Allowed.' : 'Android will ask once when you start.'}
          </div>
        </Step>

        <Step n={2} title="Read messages from the last">
          <div className="chips" role="radiogroup" aria-label="How far back">
            {IMPORT_RANGES.map((r) => (
              <button
                key={r.value}
                className="chip"
                role="radio"
                aria-checked={range === r.value}
                aria-pressed={range === r.value}
                disabled={reading}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="item-sub">{RANGE_HINT[range]}</div>
        </Step>

        <Step n={3} done={!!status?.notificationAccess} title="Payment app notifications">
          <div className="item-sub">
            Optional. For payments with no bank SMS, like PhonePe wallet.
          </div>
          {isAndroidApp && !status?.notificationAccess && (
            <button
              className="btn btn-sm"
              disabled={reading}
              onClick={() => Capture.openNotificationAccess()}
            >
              Open settings
            </button>
          )}
        </Step>

        <Step n={4} done={meta.autoAdd !== false} title="Add ready messages automatically">
          <div className="item-sub">
            Skips review when the account is known and it isn’t a duplicate.
          </div>
          <button
            className="chip"
            aria-pressed={meta.autoAdd !== false}
            disabled={reading}
            onClick={() => setMeta('autoAdd', meta.autoAdd === false)}
          >
            {meta.autoAdd !== false ? 'On' : 'Off'}
          </button>
        </Step>
      </div>

      {reading && progress!.total > 0 && <Progress value={progress!.done / progress!.total} />}
      {!isAndroidApp && (
        <p className="note" style={{ margin: 0 }}>
          This runs in the Hisaab Android app. Here in the browser, paste messages into the Inbox.
        </p>
      )}
      <ErrorNote message={error} />
    </Sheet>
  );
}
