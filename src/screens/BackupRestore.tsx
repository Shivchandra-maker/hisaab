import { useRef, useState, type ReactNode } from 'react';
import { ErrorNote } from '../design/components';
import { isSealed, openBackup } from '../db/backupCrypto';
import { importBackup } from '../db/repo';
import { useUI } from '../ui';

/**
 * Restoring a backup (H-20/H-21), shared by Settings and the first screen on a new phone.
 * A passphrase-protected file asks for its passphrase first; a plain one restores straight away.
 */
export function useRestore(onDone: () => void): {
  restore: (text: string) => Promise<void>;
  /** "Enter the passphrase" box while a protected file waits; null otherwise. */
  unlock: ReactNode;
  error: string;
} {
  const { toast } = useUI();
  const [sealed, setSealed] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async (json: string) => {
    const r = await importBackup(json);
    toast(`Restored ${r.accounts} accounts and ${r.transactions} payments`);
    setSealed(null);
    setPass('');
    onDone();
  };

  const restore = async (text: string) => {
    try {
      setError('');
      if (isSealed(text)) setSealed(text);
      else await apply(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore.');
    }
  };

  const unlock = sealed ? (
    <form
      className="note stack"
      style={{ gap: 'var(--sp-2)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          setBusy(true);
          setError('');
          await apply(await openBackup(sealed, pass));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not restore.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="label" htmlFor="unlock-pass">
        This backup is protected. Passphrase
      </label>
      <input
        id="unlock-pass"
        className="input"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={pass}
        onChange={(e) => setPass(e.target.value)}
      />
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button className="btn btn-primary" disabled={!pass || busy}>
          {busy ? 'Unlocking…' : 'Restore — replaces everything here'}
        </button>
        <button type="button" className="btn" onClick={() => setSealed(null)}>
          Cancel
        </button>
      </div>
    </form>
  ) : null;

  return { restore, unlock, error };
}

/** "Restore from a backup" for the welcome screen: pick the file, unlock it if protected. */
export function RestoreFromFile({ onDone, label }: { onDone: () => void; label: string }) {
  const file = useRef<HTMLInputElement>(null);
  const { restore, unlock, error } = useRestore(onDone);
  return (
    <>
      <button className="link-btn" onClick={() => file.current?.click()}>
        {label}
      </button>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await restore(await f.text());
          e.target.value = '';
        }}
      />
      {unlock}
      <ErrorNote message={error} />
    </>
  );
}
