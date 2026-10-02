import Dexie, { type EntityTable } from 'dexie';
import type {
  Account,
  Budget,
  Category,
  Debt,
  EmiPlan,
  InboxItem,
  MerchantRule,
  Subscription,
  Transaction,
} from '../domain/types';

/** Small key/value settings: onboarded, sample, theme, last used account… */
export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Local database (IndexedDB via Dexie). Local-first: the app works fully offline.
 * Phase 6 adds a sync layer that pushes records changed since the last `updatedAt`.
 *
 * Index notes:
 * - [accountId+date] serves account registers and card statement queries.
 * - externalRef finds duplicates when the same transaction arrives by SMS and email (Phase 7).
 * - updatedAt drives sync.
 */
export class HisaabDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  subscriptions!: EntityTable<Subscription, 'id'>;
  debts!: EntityTable<Debt, 'id'>;
  emiPlans!: EntityTable<EmiPlan, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  inbox!: EntityTable<InboxItem, 'id'>;
  rules!: EntityTable<MerchantRule, 'id'>;

  constructor(name = 'hisaab') {
    super(name);
    this.version(1).stores({
      accounts: 'id, kind, archived, updatedAt',
      transactions:
        'id, date, kind, accountId, toAccountId, categoryId, status, externalRef, subscriptionId, updatedAt, [accountId+date]',
      categories: 'id, kind, parentId, updatedAt',
      budgets: 'id, categoryId, updatedAt',
      subscriptions: 'id, nextDate, active, updatedAt',
      debts: 'id, person, settledAt, updatedAt',
      emiPlans: 'id, cardAccountId, updatedAt',
    });
    // v2 (Phase 1): app settings & flags; index debt transactions.
    this.version(2).stores({
      meta: 'key',
      transactions:
        'id, date, kind, accountId, toAccountId, categoryId, status, externalRef, subscriptionId, debtId, updatedAt, [accountId+date]',
    });
    // v3 (Phase 2): captured messages waiting for review, and merchant → category rules.
    this.version(3).stores({
      inbox: 'id, status, &hash, receivedAt, createdAt, updatedAt',
      rules: 'id, &key, updatedAt',
    });
  }
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const stamp = () => new Date().toISOString();
