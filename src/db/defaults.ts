import type { Category, CategoryKind } from '../domain/types';

/**
 * Default categories for India. Colours come from the design system's category palette
 * (--cat-1 … --cat-10), stored as token names so they adapt to light and dark themes.
 */
const expense: [id: string, name: string, icon: string, color: string][] = [
  ['food', 'Food & dining', 'utensils', 'cat-1'],
  ['groceries', 'Groceries', 'basket', 'cat-2'],
  ['transport', 'Transport', 'car', 'cat-3'],
  ['shopping', 'Shopping', 'bag', 'cat-4'],
  ['bills', 'Bills & utilities', 'bolt', 'cat-5'],
  ['rent', 'Rent & home', 'home', 'cat-6'],
  ['entertainment', 'Entertainment', 'film', 'cat-7'],
  ['health', 'Health', 'heart', 'cat-8'],
  ['travel', 'Travel', 'plane', 'cat-9'],
  ['subscriptions', 'Subscriptions', 'repeat', 'cat-10'],
  ['education', 'Education', 'book', 'cat-3'],
  ['gifts', 'Gifts & family', 'gift', 'cat-4'],
  ['fees', 'Fees & charges', 'receipt', 'cat-8'],
  // Not spending: SIPs and other investments are shown as "Invested" (see ledger INVESTMENTS).
  ['investments', 'Investments', 'chart', 'cat-9'],
  ['other', 'Miscellaneous', 'dots', 'cat-6'],
];

const income: [string, string, string, string][] = [
  ['salary', 'Salary', 'briefcase', 'cat-1'],
  ['interest', 'Interest', 'percent', 'cat-2'],
  ['cashback', 'Cashback & rewards', 'sparkle', 'cat-9'],
  ['other-income', 'Other income', 'dots', 'cat-6'],
];

const now = '2026-01-01T00:00:00.000Z';
const make =
  (kind: CategoryKind) =>
  ([id, name, icon, color]: string[], i: number): Category => ({
    id: id!,
    name: name!,
    icon: icon!,
    color: color!,
    kind,
    archived: false,
    sortOrder: i,
    createdAt: now,
    updatedAt: now,
  });

export const defaultCategories: Category[] = [
  ...expense.map(make('expense')),
  ...income.map(make('income')),
];
