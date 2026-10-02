import { useRef, useState } from 'react';
import { ConfirmButton, ErrorNote, Panel, Segmented } from '../design/components';
import { Icon } from '../design/Icon';
import { exportBackup, importBackup, resetAll, setMeta } from '../db/repo';
import { useStore } from '../store';
import { CaptureSettings } from './CaptureSettings';
import { useUI } from '../ui';

export type Theme = 'system' | 'light' | 'dark';

export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function Settings() {
  const { meta, isSample, accounts, transactions, categories, rules } = useStore();
  const { go, toast } = useUI();
  const [backupText, setBackupText] = useState('');
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const theme = (meta.theme as Theme) ?? 'system';

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
    ['insights', 'Insights', 'Trends, categories, how you paid', 'chart', true],
    ['people', 'Lent & borrowed', 'Money friends owe you, and you owe them', 'transfer', true],
    ['rules', 'Merchant rules', `${rules.length} learned from your choices`, 'sparkle'],
    [
      'categories',
      'Categories',
      `${categories.filter((c) => !c.archived).length} categories`,
      'list',
    ],
    ['style', 'Style guide', 'Colours, type and components', 'palette'],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
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

      <Panel title="Backup">
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Your data lives only in this browser on this device ({accounts.length} accounts,{' '}
            {transactions.length} transactions). Download a backup now and then — clearing browser
            data deletes it. Sync across devices comes in a later phase.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={download}>
              Download backup
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Restore from file…
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
        Hisaab · Phase 1 · data stays on this device
      </p>
    </div>
  );
}
