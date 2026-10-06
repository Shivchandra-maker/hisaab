import { useEffect, useRef, useState } from 'react';
import { ConfirmButton, ErrorNote, Panel, Segmented } from '../design/components';
import { Icon } from '../design/Icon';
import { exportBackup, importBackup, resetAll, setMeta } from '../db/repo';
import { requestPersistentStorage, storageIsPersistent } from '../db/persist';
import { useStore } from '../store';
import { CaptureSettings } from './CaptureSettings';
import { setSystemBars } from '../native/capture';
import { useUI } from '../ui';

export type Theme = 'system' | 'light' | 'dark';

export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  setSystemBars(!!dark);
}

export function Settings() {
  const { meta, isSample, accounts, transactions, categories, rules } = useStore();
  const { go, toast } = useUI();
  const [backupText, setBackupText] = useState('');
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const theme = (meta.theme as Theme) ?? 'system';
  const [kept, setKept] = useState<boolean | undefined>();
  useEffect(() => {
    void storageIsPersistent().then(setKept);
  }, []);

  const download = async () => {
    const json = JSON.stringify(await exportBackup(), null, 1);
    setBackupText(json);
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `hisaab-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      /* Some embedded views block downloads; the text box below still has the backup. */
    }
  };

  const restore = async (json: string) => {
    try {
      setError('');
      const r = await importBackup(json);
      toast(`Restored ${r.accounts} accounts and ${r.transactions} transactions`);
      setImportText('');
      go('home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore.');
    }
  };

  // The last flag marks screens that live in the sidebar on desktop: shown here only on phones,
  // where the tab bar has no room for them.
  const links: [string, string, string, string, boolean?][] = [
    ['people', 'Lent & borrowed', 'Money friends owe you, and you owe them', 'transfer', true],
    ['inbox', 'Inbox', 'Bank messages that need you', 'inbox', true],
    ['rules', 'Merchant rules', `${rules.length} learned from your choices`, 'sparkle'],
    [
      'categories',
      'Categories',
      `${categories.filter((c) => !c.archived).length} categories`,
      'list',
    ],
    // Developer page: only in dev builds (D-09).
    ...(import.meta.env.DEV
      ? [
          ['style', 'Style guide', 'Colours, type and components', 'palette'] as [
            string,
            string,
            string,
            string,
          ],
        ]
      : []),
  ];

  return (
    <div className="page">
      <div className="page-head">
        {/* The phone tab is "More"; the desktop sidebar says "Settings" (D-09). */}
        <h1>
          <span className="phone-only-inline">More</span>
          <span className="desktop-only-inline">Settings</span>
        </h1>
      </div>

      <section className="panel">
        <div className="list">
          {links.map(([route, title, sub, icon, phoneOnly]) => (
            <button
              key={route}
              className={`item ${phoneOnly ? 'phone-only' : ''}`}
              onClick={() => go(route)}
            >
              <span
                className="avatar"
                style={{ background: 'var(--surface-2)', color: 'var(--fg-2)' }}
              >
                <Icon name={icon} size={18} />
              </span>
              <div className="item-main">
                <div className="item-title">{title}</div>
                <div className="item-sub">{sub}</div>
              </div>
              <Icon name="right" size={16} className="faint" />
            </button>
          ))}
        </div>
      </section>

      <CaptureSettings />

      <Panel title="Appearance">
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={(t) => {
            applyTheme(t);
            void setMeta('theme', t);
          }}
          options={[
            { value: 'system', label: 'Match device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Panel>

      <Panel title="Display">
        <div className="stack">
          <label className="toggle-row">
            <span className="stack" style={{ gap: 2 }}>
              <b>Fade payments that aren’t spending</b>
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                They stay in lists so nothing is hidden, just quieter.
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={meta.fadeNonSpending !== false}
              onChange={(e) => void setMeta('fadeNonSpending', e.target.checked)}
            />
          </label>
          <div className="note" style={{ fontSize: 'var(--fs-sm)' }}>
            <b>Never counted as spending or income:</b> money lent, borrowed or paid back · your
            friends’ part when you paid for others · moves between your own accounts and ATM cash ·
            credit-card bill payments.
          </div>
          <label className="toggle-row">
            <span className="stack" style={{ gap: 2 }}>
              <b>Fade investments too</b>
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                SIPs are shown as “Invested”, not spending.
              </span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={meta.fadeInvestments === true}
              onChange={(e) => void setMeta('fadeInvestments', e.target.checked)}
            />
          </label>
        </div>
      </Panel>

      <Panel title="Backup">
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Your data lives only in this browser on this device ({accounts.length} accounts,{' '}
            {transactions.length} transactions). Download a backup now and then — clearing browser
            data deletes it. Sync across devices comes in a later phase.
          </p>
          {/* D-09: storage status and its fix in one box; the two backup actions side by side. */}
          {kept !== undefined && (
            <div className={`note storage-note ${kept ? 'note-ok' : 'note-warn'}`}>
              <span>
                <b>{kept ? 'Storage protected.' : 'Storage not protected.'}</b>{' '}
                {kept
                  ? 'The system won’t clear Hisaab’s data when space runs low.'
                  : 'If the phone runs low on space, the system may clear Hisaab’s data.'}
              </span>
              {!kept && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    const ok = await requestPersistentStorage();
                    setKept(ok);
                    toast(ok ? 'Storage protected' : 'Not allowed here — keep a backup');
                  }}
                >
                  Protect now
                </button>
              )}
            </div>
          )}
          <div className="row backup-actions">
            <button className={`btn ${kept === false ? '' : 'btn-primary'}`} onClick={download}>
              Download backup
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Restore…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await restore(await f.text());
                e.target.value = '';
              }}
            />
          </div>
          {backupText && (
            <div className="field">
              <label className="label" htmlFor="backup-text">
                Backup (if the download didn’t start, copy this and save it as a .json file)
              </label>
              <textarea
                id="backup-text"
                className="input num"
                rows={4}
                readOnly
                value={backupText}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() =>
                  navigator.clipboard?.writeText(backupText).then(
                    () => toast('Copied'),
                    () => toast('Select the text and copy it'),
                  )
                }
              >
                Copy
              </button>
            </div>
          )}
          <details>
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Paste a backup instead
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <label className="sr-only" htmlFor="import-text">
                Backup text
              </label>
              <textarea
                id="import-text"
                className="input"
                rows={4}
                placeholder='{"app":"hisaab",…}'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <ConfirmButton
                label="Restore pasted backup"
                confirmLabel="Tap again — replaces everything on this device"
                canArm={() => {
                  // Don't arm a destructive button for text that can't be a backup.
                  try {
                    if (JSON.parse(importText)?.app === 'hisaab') return true;
                  } catch {
                    /* fall through */
                  }
                  setError(
                    'This isn’t a Hisaab backup. Paste the whole text you copied or downloaded.',
                  );
                  return false;
                }}
                onConfirm={() => restore(importText)}
              />
            </div>
          </details>
          <ErrorNote message={error} />
        </div>
      </Panel>

      <Panel title={isSample ? 'Sample data' : 'Start over'}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            {isSample
              ? 'You’re exploring with sample data. Clear it to set up your own accounts.'
              : 'Deletes all accounts and transactions on this device. Download a backup first.'}
          </p>
          <div>
            <ConfirmButton
              label={isSample ? 'Clear sample data and start fresh' : 'Delete everything'}
              confirmLabel="Tap again to delete all data"
              onConfirm={async () => {
                await resetAll();
                toast('All data cleared');
                go('home');
              }}
            />
          </div>
        </div>
      </Panel>
      <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>
        Hisaab · data stays on this device
      </p>
    </div>
  );
}
