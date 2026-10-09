import { HisaabDB, newId, stamp } from './db';
import { defaultCategories } from './defaults';
import { DB_NAME, DEMO_DB_NAME, isDemo } from './demo';
import { balanceOf, debtBalance } from '../domain/ledger';
import { timeIST, todayIST } from '../domain/dates';
import { isLiability } from '../domain/types';
import { merchantKey } from '../domain/sms/categorize';
import type {
  Account,
  Category,
  Debt,
  ID,
  InboxItem,
  ISODate,
  MerchantRule,
  Paise,
  Subscription,
  Transaction,
} from '../domain/types';

/**
 * All writes go through here: ids, timestamps, soft deletes and validation live in one place.
 * Screens read with live queries (see store.tsx) and write with these functions.
 */
export const db = new HisaabDB(isDemo ? DEMO_DB_NAME : DB_NAME);

type New<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID };

function create<T extends { id: ID; createdAt: string; updatedAt: string }>(draft: New<T>): T {
  const now = stamp();
  return { ...draft, id: draft.id ?? newId(), createdAt: now, updatedAt: now } as T;
}

/* ───────────────────────── Settings ───────────────────────── */

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });

/* ───────────────────────── Validation ───────────────────────── */

export class ValidationError extends Error {}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function validateTransaction(t: New<Transaction>): Promise<void> {
  // A payment made entirely for others keeps ₹0 as your share (the full amount is grossAmount).
  const min = t.kind === 'expense' && t.grossAmount ? 0 : 1;
  if (!Number.isInteger(t.amount) || t.amount < min)
    throw new ValidationError('Enter an amount above ₹0.');
  if (!ISO.test(t.date)) throw new ValidationError('Choose a valid date.');
  const acc = await db.accounts.get(t.accountId);
  if (!acc || acc.deletedAt) throw new ValidationError('Choose an account.');
  if (t.kind === 'transfer') {
    if (!t.toAccountId) throw new ValidationError('Choose the account the money goes to.');
    if (t.toAccountId === t.accountId) throw new ValidationError('Choose two different accounts.');
  }
  if ((t.kind === 'adjustment' || t.kind === 'debt') && !t.flow)
    throw new ValidationError('Missing direction.');
  if (t.splits?.length) {
    const sum = t.splits.reduce((n, s) => n + s.amount, 0);
    if (sum !== t.amount) throw new ValidationError('Split amounts must add up to the total.');
    if (t.splits.some((s) => s.amount <= 0 || !s.categoryId))
      throw new ValidationError('Each split needs a category and an amount.');
  }
}

/* ───────────────────────── Transactions ───────────────────────── */

export async function saveTransaction(
  t: New<Transaction> | Transaction,
  opts: { learn?: boolean } = {},
): Promise<Transaction> {
  await validateTransaction(t);
  const clean: New<Transaction> = { ...t };
  if (clean.kind !== 'transfer') delete clean.toAccountId;
  if (clean.kind === 'transfer' || clean.kind === 'adjustment' || clean.kind === 'debt') {
    delete clean.categoryId;
    delete clean.splits;
  }
  if (clean.splits && clean.splits.length < 2) delete clean.splits;

  // Every categorised payee teaches the next guess ("Swiggy → Food & dining").
  // Not for automatic adds (only your own choices teach) and not for Miscellaneous.
  if (
    opts.learn !== false &&
    clean.merchant &&
    clean.categoryId &&
    clean.categoryId !== 'other' &&
    !clean.splits &&
    ['expense', 'refund', 'income'].includes(clean.kind)
  )
    await learnRule(clean.merchant, clean.categoryId);

  const prev = t.id ? await db.transactions.get(t.id) : undefined;
  if (prev) {
    const updated = { ...(clean as Transaction), updatedAt: stamp() };
    const parts = await splitPartsOf(prev.id);
    if (parts.length) {
      if (updated.kind !== 'expense')
        throw new ValidationError('This payment is shared with others. Undo the split first.');
      // The group stays one payment: friends' parts follow its account, date and time.
      updated.grossAmount = updated.amount + parts.reduce((n, x) => n + x.amount, 0);
    } else if (prev.grossAmount) delete updated.grossAmount;
    await db.transaction('rw', db.transactions, async () => {
      await db.transactions.put(updated);
      for (const x of parts)
        await db.transactions.put({
          ...x,
          accountId: updated.accountId,
          date: updated.date,
          time: updated.time,
          paymentMode: updated.paymentMode,
          updatedAt: updated.updatedAt,
        });
    });
    return updated;
  }
  // New entries made today without a time say when (U-15): balance corrections, loans and
  // repayments, bill payments… Callers that set `time` themselves (even to blank) are left alone;
  // an earlier date gets no time rather than a made-up one.
  if (!('time' in t) && clean.date === todayIST()) clean.time = timeIST();
  const row = create<Transaction>(clean);
  await db.transactions.add(row);
  if (row.kind !== 'adjustment' && row.kind !== 'debt')
    await setMeta('lastAccountId', row.accountId);
  return row;
}

/* ───────────────────────── Merchant rules ───────────────────────── */

/**
 * Other payments at the same payee that a new category choice should also fix (U-27): same
 * payee (by merchant key), same kind of money (spending/refunds vs income), not split across
 * categories, and not already in that category.
 */
export function samePayee(
  txns: Transaction[],
  merchant: string | undefined,
  categoryId: ID | undefined,
  income: boolean,
  exceptId?: ID,
): Transaction[] {
  const key = merchant ? merchantKey(merchant) : '';
  if (key.length < 2 || !categoryId) return [];
  return txns.filter(
    (t) =>
      t.id !== exceptId &&
      !t.deletedAt &&
      !!t.merchant &&
      (income ? t.kind === 'income' : t.kind === 'expense' || t.kind === 'refund') &&
      !(t.splits && t.splits.length > 1) &&
      t.categoryId !== categoryId &&
      merchantKey(t.merchant) === key,
  );
}

/** Put these payments in `categoryId`; returns an undo that restores each one's old category. */
export async function recategorise(
  txns: Transaction[],
  categoryId: ID,
): Promise<() => Promise<void>> {
  const before = txns.map((t) => [t.id, t.categoryId] as const);
  const now = stamp();
  await db.transaction('rw', db.transactions, async () => {
    for (const t of txns) await db.transactions.update(t.id, { categoryId, updatedAt: now });
  });
  return async () => {
    await db.transaction('rw', db.transactions, async () => {
      for (const [id, c] of before)
        await db.transactions.update(id, { categoryId: c, updatedAt: stamp() });
    });
  };
}

/**
 * Once (U-27): before this version a category you picked only applied to new payments. Bring
 * earlier payments added from messages in line with each payee's rule (your latest choice).
 * Entries you typed yourself keep their category.
 */
export async function applyRulesToPast(): Promise<number> {
  if (await getMeta<boolean>('rulesAppliedPast', false)) return 0;
  const [rules, txns, cats] = await Promise.all([
    db.rules.toArray(),
    db.transactions.toArray(),
    db.categories.toArray(),
  ]);
  const income = new Set(cats.filter((c) => c.kind === 'income').map((c) => c.id));
  let n = 0;
  for (const r of rules) {
    if (r.deletedAt || !r.categoryId) continue;
    const past = samePayee(txns, r.name, r.categoryId, income.has(r.categoryId)).filter(
      (t) => t.source === 'sms' || t.source === 'notification' || t.source === 'import',
    );
    if (past.length) await recategorise(past, r.categoryId);
    n += past.length;
  }
  await setMeta('rulesAppliedPast', true);
  return n;
}

/** Create or update the rule for a merchant. The latest choice wins. */
export async function learnRule(merchant: string, categoryId: ID): Promise<void> {
  const key = merchantKey(merchant);
  if (key.length < 2) return;
  const existing = await db.rules.where('key').equals(key).first();
  if (existing) {
    await db.rules.put({
      ...existing,
      categoryId,
      name: existing.deletedAt ? merchant : existing.name,
      hits: existing.deletedAt ? 1 : existing.hits + 1,
      deletedAt: undefined,
      updatedAt: stamp(),
    });
  } else {
    await db.rules.add(create<MerchantRule>({ key, name: merchant, categoryId, hits: 1 }));
  }
}

export async function saveRule(r: MerchantRule): Promise<void> {
  await db.rules.put({ ...r, updatedAt: stamp() });
}

export async function deleteRule(id: ID): Promise<void> {
  await db.rules.delete(id);
}

/** Friends' parts of a payment you made for them (live debt rows with `splitOf` = id). */
export async function splitPartsOf(id: ID): Promise<Transaction[]> {
  return (await db.transactions.toArray()).filter((x) => x.splitOf === id && !x.deletedAt);
}

/**
 * Soft delete so the change can sync later; Undo restores it.
 * Deleting a payment shared with friends deletes their parts with it — the money never left.
 * Deleting one friend's part keeps the payment whole: that part becomes your spending again.
 */
export async function deleteTransaction(id: ID): Promise<void> {
  const t = await db.transactions.get(id);
  if (!t || t.deletedAt) return;
  const now = stamp();
  const touched = new Set<ID | undefined>([t.debtId]);
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions.update(id, { deletedAt: now, updatedAt: now });
    for (const x of await splitPartsOf(id)) {
      await db.transactions.update(x.id, { deletedAt: now, updatedAt: now });
      touched.add(x.debtId);
    }
    const parent = t.splitOf ? await db.transactions.get(t.splitOf) : undefined;
    if (parent && !parent.deletedAt) await regroup(parent, t.amount);
  });
  for (const d of touched) await refreshDebtSettlement(d);
  await dropEmptyDebts([...touched]);
}

/** A person with no entries left disappears from Lent & borrowed (Undo brings them back). */
export async function dropEmptyDebts(ids: (ID | undefined)[]) {
  const txns = await db.transactions.toArray();
  for (const id of new Set(ids)) {
    if (!id) continue;
    if (txns.some((x) => x.debtId === id && !x.deletedAt)) continue;
    const d = await db.debts.get(id);
    if (d && !d.deletedAt) await db.debts.put({ ...d, deletedAt: stamp(), updatedAt: stamp() });
  }
}

export async function restoreTransaction(id: ID): Promise<void> {
  const t = await db.transactions.get(id);
  if (!t || !t.deletedAt) return;
  const when = t.deletedAt;
  const touched = new Set<ID | undefined>([t.debtId]);
  const undelete = async (x: Transaction) => {
    const rest: Transaction = { ...x, updatedAt: stamp() };
    delete rest.deletedAt;
    await db.transactions.put(rest);
  };
  await db.transaction('rw', db.transactions, async () => {
    if (t.splitOf) {
      // Put the friend's part back: it comes out of your share again. Never on its own while
      // the payment itself is deleted — that would leave money lent out of nothing.
      const parent = await db.transactions.get(t.splitOf);
      if (!parent || parent.deletedAt) return;
      if (parent.amount < t.amount)
        throw new ValidationError('That part is more than what’s left of the payment.');
      await undelete(t);
      await regroup(parent, -t.amount);
      return;
    }
    await undelete(t);
    // Parts deleted together with the payment come back with it.
    for (const x of await db.transactions.toArray())
      if (x.splitOf === id && x.deletedAt === when) {
        await undelete(x);
        touched.add(x.debtId);
      }
  });
  for (const id of touched) {
    const d = id ? await db.debts.get(id) : undefined;
    if (d?.deletedAt) {
      const alive: Debt = { ...d, updatedAt: stamp() };
      delete alive.deletedAt;
      await db.debts.put(alive);
    }
    await refreshDebtSettlement(id);
  }
}

/** Your share of a shared payment grew (+) or shrank (−) by `delta`; total stays the same. */
async function regroup(parent: Transaction, delta: Paise) {
  const parts = await splitPartsOf(parent.id);
  const amount = parent.amount + delta;
  const updated: Transaction = { ...parent, amount, updatedAt: stamp() };
  if (parent.splits?.length) {
    // Category split: the change lands on the biggest part.
    const splits = parent.splits.map((p) => ({ ...p }));
    const big = splits.reduce((a, b) => (b.amount > a.amount ? b : a));
    big.amount += delta;
    if (big.amount <= 0) throw new ValidationError('Change the category split first.');
    updated.splits = splits;
  }
  if (parts.length) updated.grossAmount = amount + parts.reduce((n, x) => n + x.amount, 0);
  else delete updated.grossAmount;
  await db.transactions.put(updated);
}

/* ───────────────────────── Accounts ───────────────────────── */

export async function saveAccount(a: New<Account> | Account): Promise<Account> {
  if (!a.name.trim()) throw new ValidationError('Give the account a name.');
  if (!Number.isInteger(a.openingBalance)) throw new ValidationError('Enter a valid balance.');
  if (a.kind === 'credit_card') {
    const c = a.card;
    if (!c) throw new ValidationError('Add the card’s statement details.');
    if (!Number.isInteger(c.statementDay) || c.statementDay < 1 || c.statementDay > 31)
      throw new ValidationError('Statement day must be between 1 and 31.');
    if (
      !Number.isInteger(c.dueDaysAfterStatement) ||
      c.dueDaysAfterStatement < 0 ||
      c.dueDaysAfterStatement > 60
    )
      throw new ValidationError('Days to pay must be between 0 and 60.');
    if (!Number.isInteger(c.creditLimit) || c.creditLimit < 0)
      throw new ValidationError('Enter a valid credit limit.');
  }
  const clean = { ...a, name: a.name.trim() };
  if (clean.kind !== 'credit_card') delete clean.card;
  if (a.id && (await db.accounts.get(a.id))) {
    const updated = { ...(clean as Account), updatedAt: stamp() };
    await db.accounts.put(updated);
    return updated;
  }
  const sortOrder = clean.sortOrder ?? (await db.accounts.count());
  const row = create<Account>({ ...clean, sortOrder });
  await db.accounts.add(row);
  return row;
}

export const archiveAccount = (id: ID, archived = true) =>
  db.accounts.update(id, { archived, updatedAt: stamp() });

/**
 * "Update balance": record the difference between the app's balance and the real one as an
 * adjustment, so history stays intact and spending is not affected.
 * For credit cards, `actual` is the amount owed.
 */
export async function adjustBalance(accountId: ID, actual: Paise, date: ISODate, note?: string) {
  const acc = await db.accounts.get(accountId);
  if (!acc) throw new ValidationError('Account not found.');
  const txns = await db.transactions.toArray();
  const current = balanceOf(acc, txns, date);
  const diff = actual - current;
  if (diff === 0) return null;
  // For a card, owing more means money went out.
  const moneyIn = isLiability(acc.kind) ? diff < 0 : diff > 0;
  return saveTransaction({
    kind: 'adjustment',
    date,
    amount: Math.abs(diff),
    accountId,
    flow: moneyIn ? 'in' : 'out',
    note: note ?? 'Balance updated',
    tags: [],
    source: 'manual',
    status: 'confirmed',
  });
}

/* ───────────────────────── Categories ───────────────────────── */

export async function saveCategory(c: New<Category> | Category): Promise<Category> {
  if (!c.name.trim()) throw new ValidationError('Give the category a name.');
  if (c.parentId) {
    const parent = await db.categories.get(c.parentId);
    if (!parent || parent.parentId)
      throw new ValidationError('Sub-categories can only sit under a main category.');
    if (parent.kind !== c.kind)
      throw new ValidationError('A sub-category must be the same type as its parent.');
    if (c.id && c.parentId === c.id)
      throw new ValidationError('A category can’t be its own parent.');
  }
  const clean = { ...c, name: c.name.trim() };
  if (c.id && (await db.categories.get(c.id))) {
    const updated = { ...(clean as Category), updatedAt: stamp() };
    await db.categories.put(updated);
    return updated;
  }
  const row = create<Category>({
    ...clean,
    sortOrder: clean.sortOrder ?? (await db.categories.count()),
  });
  await db.categories.add(row);
  return row;
}

export const archiveCategory = (id: ID, archived = true) =>
  db.categories.update(id, { archived, updatedAt: stamp() });

/* ───────────────────────── Money lent & borrowed ───────────────────────── */

export async function startDebt(input: {
  person: string;
  direction: Debt['direction'];
  amount: Paise;
  accountId: ID;
  date: ISODate;
  note?: string;
}): Promise<Debt> {
  if (!input.person.trim()) throw new ValidationError('Enter the person’s name.');
  const debt = create<Debt>({
    person: input.person.trim(),
    direction: input.direction,
    note: input.note,
  });
  await validateTransaction({
    kind: 'debt',
    date: input.date,
    amount: input.amount,
    accountId: input.accountId,
    flow: 'out',
    tags: [],
    source: 'manual',
    status: 'confirmed',
  });
  await db.debts.add(debt);
  {
    await saveTransaction({
      kind: 'debt',
      date: input.date,
      amount: input.amount,
      accountId: input.accountId,
      flow: input.direction === 'lent' ? 'out' : 'in',
      debtId: debt.id,
      note:
        input.note ??
        (input.direction === 'lent' ? `Lent to ${debt.person}` : `Borrowed from ${debt.person}`),
      tags: [],
      source: 'manual',
      status: 'confirmed',
    });
  }
  return debt;
}

/** Add to an existing debt (lend more / borrow more) or record a repayment. */
export async function recordDebtMovement(input: {
  debtId: ID;
  type: 'more' | 'repayment';
  amount: Paise;
  accountId: ID;
  date: ISODate;
  note?: string;
}) {
  const debt = await db.debts.get(input.debtId);
  if (!debt) throw new ValidationError('Not found.');
  const loanFlow = debt.direction === 'lent' ? 'out' : 'in';
  const flow = input.type === 'more' ? loanFlow : loanFlow === 'out' ? 'in' : 'out';
  if (input.type === 'repayment') {
    const { outstanding } = debtBalance(debt, await db.transactions.toArray());
    if (input.amount > outstanding)
      throw new ValidationError(`That’s more than the ₹${outstanding / 100} outstanding.`);
  }
  const t = await saveTransaction({
    kind: 'debt',
    date: input.date,
    amount: input.amount,
    accountId: input.accountId,
    flow,
    debtId: debt.id,
    note:
      input.note ??
      (input.type === 'repayment'
        ? debt.direction === 'lent'
          ? `${debt.person} paid back`
          : `Paid back ${debt.person}`
        : debt.direction === 'lent'
          ? `Lent to ${debt.person}`
          : `Borrowed from ${debt.person}`),
    tags: [],
    source: 'manual',
    status: 'confirmed',
  });
  await refreshDebtSettlement(debt.id);
  return t;
}

export async function refreshDebtSettlement(debtId?: ID) {
  if (!debtId) return;
  const debt = await db.debts.get(debtId);
  if (!debt) return;
  const b = debtBalance(debt, await db.transactions.toArray());
  const settled = b.principal > 0 && b.outstanding <= 0;
  if (settled && !debt.settledAt)
    await db.debts.update(debtId, { settledAt: b.lastDate, updatedAt: stamp() });
  if (!settled && debt.settledAt)
    await db.debts.update(debtId, { settledAt: undefined, updatedAt: stamp() });
}

/* ───────────────────────── Setup, sample, backup ───────────────────────── */

export async function ensureDefaults() {
  // bulkPut, not bulkAdd: two first-run callers (a second tab, React StrictMode) can both see 0.
  if ((await db.categories.count()) === 0) await db.categories.bulkPut(defaultCategories);
  // Categories added in later versions.
  for (const id of ['investments']) {
    const c = defaultCategories.find((x) => x.id === id);
    if (c && !(await db.categories.get(id))) await db.categories.put({ ...c, sortOrder: 90 });
  }
  // v1 named the catch-all category "Other"; it's "Miscellaneous" now.
  const other = await db.categories.get('other');
  if (other && other.name === 'Other')
    await db.categories.update('other', { name: 'Miscellaneous', updatedAt: stamp() });
}

const tables = () => [
  db.accounts,
  db.transactions,
  db.categories,
  db.budgets,
  db.subscriptions,
  db.debts,
  db.emiPlans,
  db.meta,
  db.inbox,
  db.rules,
];

export async function resetAll() {
  await db.transaction('rw', tables(), async () => {
    for (const t of tables()) await t.clear();
  });
  await ensureDefaults();
}

export async function loadSample(data: {
  accounts: Account[];
  transactions: Transaction[];
  subscriptions: Subscription[];
  debts: Debt[];
}) {
  await resetAll();
  await db.transaction('rw', tables(), async () => {
    await db.accounts.bulkAdd(data.accounts);
    await db.transactions.bulkAdd(data.transactions);
    await db.subscriptions.bulkAdd(data.subscriptions);
    await db.debts.bulkAdd(data.debts);
    await db.meta.bulkPut([
      { key: 'onboarded', value: true },
      { key: 'sample', value: true },
    ]);
  });
}

export interface Backup {
  app: 'hisaab';
  version: 1;
  exportedAt: string;
  data: {
    accounts: Account[];
    transactions: Transaction[];
    categories: Category[];
    budgets: unknown[];
    subscriptions: Subscription[];
    debts: Debt[];
    emiPlans: unknown[];
    inbox?: InboxItem[];
    rules?: MerchantRule[];
    meta: { key: string; value: unknown }[];
  };
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'hisaab',
    version: 1,
    exportedAt: stamp(),
    data: {
      accounts: await db.accounts.toArray(),
      transactions: await db.transactions.toArray(),
      categories: await db.categories.toArray(),
      budgets: await db.budgets.toArray(),
      subscriptions: await db.subscriptions.toArray(),
      debts: await db.debts.toArray(),
      emiPlans: await db.emiPlans.toArray(),
      meta: (await db.meta.toArray()).filter((m) => m.key !== 'theme'),
      inbox: await db.inbox.toArray(),
      rules: await db.rules.toArray(),
    },
  };
}

/** Replaces everything on this device with the backup. */
export async function importBackup(
  json: string,
): Promise<{ accounts: number; transactions: number }> {
  let b: Backup;
  try {
    b = JSON.parse(json);
  } catch {
    throw new ValidationError('This file isn’t a Hisaab backup (it isn’t valid JSON).');
  }
  if (
    b?.app !== 'hisaab' ||
    b.version !== 1 ||
    !b.data ||
    !Array.isArray(b.data.transactions) ||
    !Array.isArray(b.data.accounts)
  )
    throw new ValidationError('This file isn’t a Hisaab backup.');
  await db.transaction('rw', tables(), async () => {
    for (const t of tables()) await t.clear();
    await db.accounts.bulkAdd(b.data.accounts);
    await db.transactions.bulkAdd(b.data.transactions);
    await db.categories.bulkAdd(b.data.categories ?? defaultCategories);
    await db.budgets.bulkAdd((b.data.budgets ?? []) as never[]);
    await db.emiPlans.bulkAdd((b.data.emiPlans ?? []) as never[]);
    await db.subscriptions.bulkAdd(b.data.subscriptions ?? []);
    await db.debts.bulkAdd(b.data.debts ?? []);
    await db.inbox.bulkAdd(b.data.inbox ?? []);
    await db.rules.bulkAdd(b.data.rules ?? []);
    // On a new phone the app reads its SMS again (newest first): drop the old phone's
    // "already read" markers and anything half-done there.
    const skip = new Set(['nativeFilterRead', 'nativeFilterRead2', 'catchUp', 'setupStage']);
    await db.meta.bulkPut([
      ...(b.data.meta ?? []).filter((m) => !skip.has(m.key)),
      { key: 'onboarded', value: true },
      { key: 'setupStage', value: 'done' },
    ]);
  });
  return { accounts: b.data.accounts.length, transactions: b.data.transactions.length };
}
