import { useEffect, useState } from 'react';
import { ErrorNote, Progress } from '../design/components';
import { resumeSetup } from '../db/setup';
import { Capture, isAndroidApp } from '../native/capture';
import { SCAN_DAYS } from './SetupFromSms';

/**
 * H-24: setup was stopped half-way (the app was closed while adding payments). Finish it — read
 * the same messages again (already-filed ones are skipped), add the payments, keep the accounts
 * you already chose. Never back to the welcome screen, never a second copy of an account.
 */
export function ResumeSetup() {
  const [progress, setProgress] = useState<{ label: string; done: number; total: number }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        setError('');
        const messages = isAndroidApp
          ? (
              await Capture.readInbox({
                sinceMs: Date.now() - SCAN_DAYS * 86_400_000,
                limit: 20_000,
              })
            ).messages
          : [];
        await resumeSetup(messages, (label, done, total) => {
          if (live) setProgress({ label, done, total });
        });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  return (
    <div className="onb">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="onb-title onb-title-sm">Finishing your setup</h1>
        <p className="onb-lead">
          {progress
            ? `${progress.label} · ${progress.done} of ${progress.total}`
            : 'Picking up where it stopped — your accounts are already saved.'}
        </p>
        <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
          If you close the app, it carries on from here next time.
        </p>
      </div>
      <Progress value={progress && progress.total ? progress.done / progress.total : 0.05} />
      <ErrorNote message={error} />
      {error && (
        <button className="btn btn-primary" onClick={() => setAttempt((a) => a + 1)}>
          Try again
        </button>
      )}
    </div>
  );
}
