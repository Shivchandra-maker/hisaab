import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './design/Icon';
import { monthOf } from './domain/dates';
import type { Account, Category } from './domain/types';
import { AccountDetail } from './screens/AccountDetail';
import { AccountSheet } from './screens/AccountSheet';
import { Accounts } from './screens/Accounts';
import { CardDetail } from './screens/CardDetail';
import { Categories, CategorySheet } from './screens/Categories';
import { Home } from './screens/Home';
import { Inbox } from './screens/Inbox';
import { Insights } from './screens/Insights';
import { Rules } from './screens/Rules';
import { People } from './screens/People';
import { applyTheme, Settings, type Theme } from './screens/Settings';
import { StyleGuide } from './screens/StyleGuide';
import { Transactions } from './screens/Transactions';
import { TxnSheet } from './screens/TxnSheet';
import { Welcome } from './screens/Welcome';
import { WhereMoney } from './screens/WhereMoney';
import { handleBackButton, isAndroidApp, startCapture } from './native/capture';
import { QuickSetup } from './screens/QuickSetup';
import { useStore } from './store';
import { UICtx, type TxnDraft, type UI } from './ui';

/** `tab` = label in the phone tab bar; items without one are reached from More on phones. */
const NAV: { id: string; label: string; tab?: string; icon: string }[] = [
  { id: 'home', label: 'Home', tab: 'Home', icon: 'home' },
  { id: 'transactions', label: 'Activity', tab: 'Activity', icon: 'list' },
  { id: 'inbox', label: 'Inbox', tab: 'Inbox', icon: 'inbox' },
  { id: 'accounts', label: 'Accounts', tab: 'Accounts', icon: 'wallet' },
  { id: 'people', label: 'Lent & borrowed', icon: 'transfer' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'settings', label: 'Settings', tab: 'More', icon: 'dots' },
];

/** Which nav item a route belongs to. */
const sectionOf = (r: string) =>
  r.startsWith('card-') || r.startsWith('acct-')
    ? 'accounts'
    : ['categories', 'style', 'rules'].includes(r)
      ? 'settings'
      : r === 'sort'
        ? 'home'
        : r;

const readRoute = () => window.location.hash.replace('#', '') || 'home';

type Editor =
  | { type: 'txn'; draft?: TxnDraft }
  | { type: 'account'; draft?: Partial<Account> }
  | { type: 'category'; draft?: Partial<Category> }
  | null;

export function App() {
  const { today, isSample, onboarded, meta, inboxNew } = useStore();
  const [route, setRoute] = useState(readRoute);
  const [month, setMonth] = useState(monthOf(today));
  const [editor, setEditor] = useState<Editor>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => applyTheme((meta.theme as Theme) ?? 'system'), [meta.theme]);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((r: string) => {
    window.location.hash = r;
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  const ui = useMemo<UI>(
    () => ({
      go,
      openTxn: (draft) => setEditor({ type: 'txn', draft }),
      openAccount: (draft) => setEditor({ type: 'account', draft }),
      openCategory: (draft) => setEditor({ type: 'category', draft }),
      toast: (message, undo) => {
        clearTimeout(toastTimer.current);
        setToast({ message, undo });
        toastTimer.current = setTimeout(() => setToast(null), undo ? 5000 : 2200);
      },
    }),
    [go],
  );

  // Android app: file captured SMS/notifications into the Inbox; back button behaviour.
  const editorOpen = useRef(false);
  editorOpen.current = editor !== null;
  useEffect(() => {
    if (!onboarded) return;
    return startCapture(
      (s) => ui.toast(`${s.toReview} new payment message${s.toReview === 1 ? '' : 's'} in Inbox`),
      (r) => go(r),
    );
  }, [onboarded, ui, go]);
  useEffect(
    () =>
      handleBackButton(() => {
        if (!editorOpen.current) return false;
        setEditor(null);
        return true;
      }),
    [],
  );

  // Keyboard shortcut on desktop: "n" for a new transaction.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        e.key === 'n' &&
        !editor &&
        onboarded &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        setEditor({ type: 'txn' });
      }
      if (e.key === 'Escape') setEditor(null);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [editor, onboarded]);

  const close = () => setEditor(null);
  // Android app, first launch after setup: offer to read past bank messages.
  const [setupHidden, setSetupHidden] = useState(false);
  const showSetup =
    isAndroidApp && onboarded && !isSample && meta.quickSetupDone !== true && !setupHidden;
  const editors = (
    <>
      {showSetup && !editor && <QuickSetup onClose={() => setSetupHidden(true)} />}
      {editor?.type === 'txn' && <TxnSheet initial={editor.draft} onClose={close} />}
      {editor?.type === 'account' && <AccountSheet initial={editor.draft} onClose={close} />}
      {editor?.type === 'category' && <CategorySheet initial={editor.draft} onClose={close} />}
      {toast && (
        <div className="toast" role="status">
          {toast.message}
          {toast.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                toast.undo!();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );

  if (!onboarded) {
    return (
      <UICtx.Provider value={ui}>
        <Welcome />
        {editors}
      </UICtx.Provider>
    );
  }

  const section = sectionOf(route);
  let screen;
  if (route.startsWith('card-')) screen = <CardDetail id={route.slice(5)} />;
  else if (route.startsWith('acct-')) screen = <AccountDetail id={route.slice(5)} />;
  else if (route === 'transactions') screen = <Transactions month={month} setMonth={setMonth} />;
  else if (route === 'accounts') screen = <Accounts />;
  else if (route === 'insights') screen = <Insights month={month} setMonth={setMonth} />;
  else if (route === 'settings') screen = <Settings />;
  else if (route === 'people') screen = <People />;
  else if (route === 'categories') screen = <Categories />;
  else if (route === 'inbox') screen = <Inbox />;
  else if (route === 'rules') screen = <Rules />;
  else if (route === 'style') screen = <StyleGuide />;
  else if (route === 'sort') screen = <WhereMoney />;
  else screen = <Home month={month} setMonth={setMonth} />;

  return (
    <UICtx.Provider value={ui}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">₹</span>Hisaab
          </div>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <button
                key={n.id}
                aria-current={section === n.id ? 'page' : undefined}
                onClick={() => go(n.id)}
              >
                <Icon name={n.icon} />
                {n.label}
                {n.id === 'inbox' && inboxNew > 0 && <span className="badge">{inboxNew}</span>}
              </button>
            ))}
          </nav>
          <button
            className="btn btn-primary btn-block add-btn"
            onClick={() => setEditor({ type: 'txn' })}
            title="Shortcut: N"
          >
            <Icon name="plus" size={18} />
            Add
          </button>
        </aside>

        <main className="main">
          {import.meta.env.MODE === 'preview' && (
            <div className="page" style={{ marginBottom: 'var(--sp-3)' }}>
              <div className="note note-cycle">
                Online preview. Data you enter here stays in this browser but may be cleared — run
                the app from your Hisaab folder for real use.
              </div>
            </div>
          )}
          {isSample && (
            <div className="page" style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="banner sample-banner">
                <span>
                  <b>Sample data</b> — nothing here is real.
                </span>
                <button className="banner-link" onClick={() => go('settings')}>
                  Use my own
                </button>
              </div>
            </div>
          )}
          {screen}
        </main>

        <nav className="tabbar" aria-label="Main">
          {NAV.filter((n) => n.tab).map((n) => (
            <button
              key={n.id}
              aria-current={
                section === n.id ||
                (n.id === 'settings' && (section === 'insights' || section === 'people'))
                  ? 'page'
                  : undefined
              }
              onClick={() => go(n.id)}
            >
              <span className="tab-icon">
                <Icon name={n.icon} size={22} />
                {n.id === 'inbox' && inboxNew > 0 && (
                  <span className="badge badge-dot">{inboxNew}</span>
                )}
              </span>
              {n.tab}
            </button>
          ))}
        </nav>
        {route !== 'sort' && (
          <button
            className="fab"
            onClick={() => setEditor({ type: 'txn' })}
            aria-label="Add transaction"
          >
            <Icon name="plus" size={26} />
          </button>
        )}
      </div>
      {editors}
    </UICtx.Provider>
  );
}
