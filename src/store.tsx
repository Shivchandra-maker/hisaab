import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { reparseInboxIfNeeded } from './db/inbox';
import { db, ensureDefaults } from './db/repo';
import { todayIST } from './domain/dates';
import type {
  Account,
  Category,
  Debt,
  ID,
  InboxItem,
  MerchantRule,
  Subscription,
  Transaction,
} from './domain/types';

/**
 * App data, read live from the local database. Any write through src/db/repo.ts
 * re-renders the screens that use it.
 */
interface Store {
  today: string;
  /** All accounts that aren't deleted, including archived ones (needed for history). */
  accounts: Account[];
  /** Accounts to offer in pickers. */
  activeAccounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  subscriptions: Subscription[];
  debts: Debt[];
  accountById: Map<ID, Account>;
  categoryById: Map<ID, Category>;
  meta: Record<string, unknown>;
  /** Captured messages, newest first. */
  inbox: InboxItem[];
  /** Messages waiting for a decision. */
  inboxNew: number;
  rules: MerchantRule[];
  isSample: boolean;
  onboarded: boolean;
}

const Ctx = createContext<Store | null>(null);

const byOrder = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export function StoreProvider({ children, loading }: { children: ReactNode; loading: ReactNode }) {
  const [today, setToday] = useState(todayIST);
  // Roll over at midnight IST if the app stays open.
  useEffect(() => {
    const t = setInterval(() => setToday(todayIST()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [dbError, setDbError] = useState('');
  useEffect(() => {
    db.open()
      .then(() => ensureDefaults())
      .then(() => reparseInboxIfNeeded())
      .catch((e: unknown) => setDbError(e instanceof Error ? e.message : String(e)));
  }, []);

  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const categories = useLiveQuery(() => db.categories.toArray(), []);
  const transactions = useLiveQuery(() => db.transactions.orderBy('date').toArray(), []);
  const subscriptions = useLiveQuery(() => db.subscriptions.toArray(), []);
  const debts = useLiveQuery(() => db.debts.toArray(), []);
  const metaRows = useLiveQuery(() => db.meta.toArray(), []);
  const inbox = useLiveQuery(() => db.inbox.orderBy('createdAt').reverse().toArray(), []);
  const rules = useLiveQuery(() => db.rules.toArray(), []);

  const value = useMemo<Store | null>(() => {
    if (
      !accounts ||
      !categories ||
      !transactions ||
      !subscriptions ||
      !debts ||
      !metaRows ||
      !inbox ||
      !rules
    )
      return null;
    const accs = accounts.filter((a) => !a.deletedAt).sort(byOrder);
    const cats = categories.filter((c) => !c.deletedAt).sort(byOrder);
    const meta = Object.fromEntries(metaRows.map((m) => [m.key, m.value]));
    return {
      today,
      accounts: accs,
      activeAccounts: accs.filter((a) => !a.archived),
      categories: cats,
      transactions: transactions.filter((t) => !t.deletedAt),
      subscriptions: subscriptions.filter((s) => !s.deletedAt),
      debts: debts.filter((d) => !d.deletedAt),
      accountById: new Map(accs.map((a) => [a.id, a])),
      categoryById: new Map(cats.map((c) => [c.id, c])),
      meta,
      inbox,
      inboxNew: inbox.filter((i) => i.status === 'new').length,
      rules: rules.filter((r) => !r.deletedAt).sort((a, b) => a.name.localeCompare(b.name)),
      isSample: meta.sample === true,
      onboarded: meta.onboarded === true,
    };
  }, [today, accounts, categories, transactions, subscriptions, debts, metaRows, inbox, rules]);

  if (dbError)
    return (
      <div className="welcome">
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>Hisaab can’t store data in this browser</h1>
        <p className="muted" style={{ maxWidth: '50ch', textAlign: 'center' }}>
          Private browsing or blocked site data stops the app saving anything. Open it in a normal
          window, or allow site data, and reload. ({dbError})
        </p>
      </div>
    );
  if (!value) return <>{loading}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
