import { useState } from 'react';
import { openAppSettings, requestContacts, type ContactsResult } from '../native/capture';
import { useUI } from '../ui';

/**
 * "Allow contacts" that always answers: the Android dialog, or — when Android won't show it any
 * more — a way to App info, or a note that this APK is too old to ask (U-12).
 */
export function ContactsAllow({ onGranted }: { onGranted?: () => void }) {
  const { toast } = useUI();
  const [result, setResult] = useState<ContactsResult>();
  const [busy, setBusy] = useState(false);

  if (result === 'blocked')
    return (
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
          Android isn’t showing the question any more. Open <b>App info → Permissions → Contacts</b>{' '}
          and choose <b>Allow</b>, then come back.
        </p>
        <div>
          <button className="btn btn-primary" onClick={() => void openAppSettings()}>
            Open App info
          </button>
        </div>
      </div>
    );
  if (result === 'update')
    return (
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
        This copy of the app was built without its contacts part. Install the latest Hisaab APK and
        try again.
      </p>
    );
  return (
    <div>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await requestContacts();
          setBusy(false);
          setResult(r);
          if (r === 'granted') {
            toast('Contacts allowed — only friends get “Spent or lent?”');
            onGranted?.();
          } else if (r === 'denied') toast('Without contacts, Hisaab won’t ask about loans');
        }}
      >
        Allow contacts
      </button>
    </div>
  );
}
