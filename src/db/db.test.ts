import 'fake-indexeddb/auto';
import { HisaabDB } from './db';
import { account, txn } from '../domain/testkit';

describe('local database', () => {
  it('stores and queries transactions by account and date range', async () => {
    const db = new HisaabDB('test-db');
    await db.accounts.add(account({ id: 'card', kind: 'credit_card' }));
    await db.transactions.bulkAdd([
      txn({ kind: 'expense', date: '2026-08-20', amount: 100, accountId: 'card' }),
      txn({ kind: 'expense', date: '2026-09-10', amount: 200, accountId: 'card' }),
      txn({ kind: 'expense', date: '2026-09-20', amount: 300, accountId: 'other' }),
    ]);
    const inPeriod = await db.transactions
      .where('[accountId+date]')
      .between(['card', '2026-08-16'], ['card', '2026-09-15'], true, true)
      .toArray();
    expect(inPeriod.map((t) => t.amount)).toEqual([100, 200]);
    db.close();
    await db.delete();
  });
});
