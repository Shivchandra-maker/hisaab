import 'fake-indexeddb/auto';
import { inboxNeeds } from './needs';
import { ingestMessages } from './inbox';
import { db, loadSample } from './repo';
import { sampleData, sampleMessages } from '../sample/sample';
import { todayIST } from '../domain/dates';

/** D-01: one count for the bell, the Home banner and the Inbox heading. */
describe('inboxNeeds', () => {
  const read = async (autoAdd: boolean) =>
    inboxNeeds({
      inbox: await db.inbox.toArray(),
      transactions: await db.transactions.toArray(),
      accounts: await db.accounts.toArray(),
      rules: await db.rules.toArray(),
      accountHints: {},
      autoAdd,
    });

  beforeEach(async () => {
    const today = todayIST();
    await loadSample(sampleData(today));
    await ingestMessages(sampleMessages(today), {
      source: 'paste',
      receivedAt: today,
    });
  });

  it('counts one question per unknown account, not one per message', async () => {
    const n = await read(true);
    expect(n.groups.length).toBeGreaterThan(0);
    expect(n.count).toBe(n.people.length + n.groups.length + n.dups.length + n.other.length);
  });

  it('counts ready messages only when auto-add is off', async () => {
    const on = await read(true);
    const off = await read(false);
    expect(on.ready.length).toBeGreaterThan(0);
    expect(off.count).toBe(on.count + on.ready.length);
  });
});
