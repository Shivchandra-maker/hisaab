import type { Account, Transaction } from './types';

let n = 0;
const now = '2026-01-01T00:00:00.000Z';

export function account(p: Partial<Account> & Pick<Account, 'id' | 'kind'>): Account {
  return {
    name: p.id,
    openingBalance: 0,
    openingDate: '2026-01-01',
    archived: false,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

export function txn(
  p: Partial<Transaction> & Pick<Transaction, 'kind' | 'date' | 'amount' | 'accountId'>,
): Transaction {
  n++;
  return {
    id: `t${n}`,
    tags: [],
    source: 'manual',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}
