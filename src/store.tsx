import { Capacitor } from '@capacitor/core';
import { reviewLoanQuestions } from './db/loans';
import { refreshCheckpoints } from './db/checkpoints';
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { backfillTimes, recheckBillPayments, reparseInboxIfNeeded } from './db/inbox';
import { inboxNeeds, type InboxNeeds } from './db/needs';
import { requestPersistentStorage } from './db/persist';
import { applyRulesToPast, db, ensureDefaults } from './db/repo';
import { seedDemoIfNeeded } from './db/demoSeed';
import { isDemo } from './db/demo';
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
  /** What in the Inbox needs you, grouped as the Inbox shows it (D-01: one source for every count). */
  needs: InboxNeeds;
  /** = needs.count. Badge, Home banner and Inbox heading all show this number. */
  inboxNew: number;
  rules: MerchantRule[];
  isSample: boolean;
  /** Showing the separate sample database ("Show sample data" in Settings). */
  isDemo: boolean;
  onboarded: boolean;
}

const Ctx = createContext<Store | null>(null);

export { needsDupCheck, UNSURE_DUPLICATES } from './db/needs';

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
  // Sample database: wait until it's filled, so the welcome screen never flashes.
  const [seeding, setSeeding] = useState(isDemo);
  useEffect(() => {
    // Keep the data safe from the system clearing storage when space runs low.
    void requestPersistentStorage();
    db.open()
      .then(() => ensureDefaults())
      .then(() => seedDemoIfNeeded())
      .then(() => setSeeding(false))
      .then(() => reparseInboxIfNeeded())
      .then(() => backfillTimes())
      .then(() => recheckBillPayments())
      .then(() => applyRulesToPast())
      // Phone: re-checked after contacts load (native/capture.ts). Browser: no contacts → no asks.
      .then(() => (Capacitor.isNativePlatform() ? undefined : reviewLoanQuestions()))
      .then(() => refreshCheckpoints())
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
    // Oldest first: by day, then time of day, then when it was added (U-15).
    const liveTxns = transactions
      .filter((t) => !t.deletedAt)
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.time ?? '').localeCompare(b.time ?? '') ||
          a.createdAt.localeCompare(b.createdAt),
      );
    const liveRules = rules
      .filter((r) => !r.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    // D-01: one "needs you" count for the bell, the Home banner, the sidebar and the Inbox page.
    const needs = inboxNeeds({
      inbox,
      transactions: liveTxns,
      accounts: accs,
      rules: liveRules,
      accountHints: (meta.accountHints as Record<string, string>) ?? {},
      autoAdd: meta.autoAdd !== false,
      today,
    });
    return {
      today,
      accounts: accs,
      activeAccounts: accs.filter((a) => !a.archived),
      categories: cats,
      transactions: liveTxns,
      subscriptions: subscriptions.filter((s) => !s.deletedAt),
      debts: debts.filter((d) => !d.deletedAt),
      accountById: new Map(accs.map((a) => [a.id, a])),
      categoryById: new Map(cats.map((c) => [c.id, c])),
      meta,
      inbox,
      needs,
      inboxNew: needs.count,
      rules: liveRules,
      isSample: meta.sample === true,
      isDemo,
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
  if (!value || seeding) return <>{loading}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
