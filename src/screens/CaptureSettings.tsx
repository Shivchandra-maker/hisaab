import { App } from '@capacitor/app';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNote, Panel } from '../design/components';
import { Icon } from '../design/Icon';
import { NOTIFICATION_APPS } from '../db/inbox';
import { setMeta } from '../db/repo';
import { Capture, isAndroidApp, type CaptureStatus } from '../native/capture';
import { QuickSetup } from './QuickSetup';
import { useStore } from '../store';

function Check({ on }: { on: boolean }) {
  return (
    <span className={`pill ${on ? 'pill-ok' : 'pill-neutral'}`}>
      {on ? (
        <>
          <Icon name="check" size={12} /> On
        </>
      ) : (
        'Off'
      )}
    </span>
  );
}

/** Settings › Automatic capture (Android app only). */
export function CaptureSettings() {
  const { meta } = useStore();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
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
    // Coming back from Android's notification-access screen.
    const h = App.addListener('resume', () => void refresh());
    return () => void h.then((x) => x.remove());
  }, [refresh]);

  const setup = setupOpen && (
    <QuickSetup
      onClose={() => {
        setSetupOpen(false);
        void refresh();
      }}
    />
  );

  if (!isAndroidApp) {
    return (
      <Panel title="Automatic capture">
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            In the Hisaab Android app, bank SMS and payment-app notifications are read automatically
            and land in your Inbox. Nothing leaves your phone. Here in the browser, paste messages
            into the Inbox instead.
          </p>
          <button className="btn btn-sm" onClick={() => setSetupOpen(true)}>
            Preview quick setup
          </button>
        </div>
        {setup}
      </Panel>
    );
  }

  const toggleApp = async (pkg: string) => {
    if (!status) return;
    const apps = status.apps.includes(pkg)
      ? status.apps.filter((a) => a !== pkg)
      : [...status.apps, pkg];
    setStatus(await Capture.setOptions({ apps }));
  };

  const s = status;
  return (
    <Panel title="Automatic capture">
      <div className="stack">
        <div className="list">
          <div className="item" style={{ flexWrap: 'wrap' }}>
            <div className="item-main">
              <div className="item-title">Bank SMS</div>
              <div className="item-sub">
                Reads new messages from banks and cards as they arrive. Personal messages are never
                read.
              </div>
            </div>
            {s?.sms ? (
              <Check on />
            ) : (
              <button
                className="btn btn-primary"
                onClick={async () => setStatus(await Capture.requestSms())}
              >
                Allow
              </button>
            )}
          </div>

          <div className="item" style={{ flexWrap: 'wrap' }}>
            <div className="item-main">
              <div className="item-title">Messages already on your phone</div>
              <div className="item-sub">
                Read past bank messages: last 7 days, 30 days, 1 year or all. Duplicates are
                skipped.
              </div>
            </div>
            <button className="btn" onClick={() => setSetupOpen(true)}>
              Quick setup
            </button>
          </div>

          <div className="item" style={{ flexWrap: 'wrap' }}>
            <div className="item-main">
              <div className="item-title">Payment app notifications</div>
              <div className="item-sub">
                For payments without a bank SMS, like PhonePe wallet. Android asks you to allow
                “Notification access” for Hisaab.
              </div>
            </div>
            {s?.notificationAccess ? (
              <Check on />
            ) : (
              <button className="btn btn-primary" onClick={() => Capture.openNotificationAccess()}>
                Open settings
              </button>
            )}
          </div>
          {s?.notificationAccess && (
            <div className="chips" style={{ padding: '4px 0 10px' }}>
              {Object.entries(NOTIFICATION_APPS).map(([pkg, name]) => (
                <button
                  key={pkg}
                  className="chip"
                  aria-pressed={s.apps.includes(pkg)}
                  onClick={() => toggleApp(pkg)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          <div className="item" style={{ flexWrap: 'wrap' }}>
            <div className="item-main">
              <div className="item-title">Tell me when a payment is captured</div>
              <div className="item-sub">
                A quiet notification: “New payment · ₹250 — tap to review”.
              </div>
            </div>
            <button
              className="chip"
              aria-pressed={!!s?.notify && !!s?.notifications}
              onClick={async () => {
                if (s?.notify && s.notifications) {
                  setStatus(await Capture.setOptions({ notify: false }));
                  return;
                }
                const st = s?.notifications ? s : await Capture.requestNotifications();
                setStatus(st.notifications ? await Capture.setOptions({ notify: true }) : st);
              }}
            >
              {s?.notify && s?.notifications ? 'On' : 'Off'}
            </button>
          </div>

          <div className="item" style={{ flexWrap: 'wrap' }}>
            <div className="item-main">
              <div className="item-title">Add ready messages automatically</div>
              <div className="item-sub">
                Skips the review step when the account is known and it isn’t a duplicate. You can
                still edit or delete them later.
              </div>
            </div>
            <button
              className="chip"
              aria-pressed={meta.autoAdd === true}
              onClick={() => setMeta('autoAdd', meta.autoAdd !== true)}
            >
              {meta.autoAdd === true ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        {s && s.pending > 0 && (
          <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
            {s.pending} captured messages waiting to be filed.
          </p>
        )}
        <ErrorNote message={error} />
      </div>
      {setup}
    </Panel>
  );
}
