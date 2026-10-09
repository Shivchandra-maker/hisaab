import 'fake-indexeddb/auto';
import { balanceOf } from '../domain/ledger';
import { refreshCheckpoints } from './checkpoints';
import { addAllReady, ingestCaptured } from './inbox';
import { db, resetAll, saveAccount } from './repo';

const at = (iso: string) => new Date(iso).getTime();

beforeEach(async () => {
  await resetAll();
  await saveAccount({
    name: 'HDFC Bank',
    kind: 'bank',
    last4: '4521',
    institution: 'HDFC Bank',
    openingBalance: 10_000_00,
    openingDate: '2026-09-01',
    archived: false,
    sortOrder: 0,
  });
  await saveAccount({
    name: 'HDFC Credit Card',
    kind: 'credit_card',
    last4: '8834',
    institution: 'HDFC Bank',
    openingBalance: 0,
    openingDate: '2026-09-01',
    archived: false,
    sortOrder: 1,
    card: { statementDay: 15, dueDaysAfterStatement: 20, creditLimit: 1_00_000_00 },
  });
});

describe('balance checkpoints', () => {
  it('re-anchors a bank account to the balance the bank stated, and shows the drift', async () => {
    await ingestCaptured([
      {
        id: '1',
        source: 'sms',
        ts: at('2026-09-20T10:00:00+05:30'),
        body: 'Rs.500.00 debited from A/c XX4521 on 20-09-26 to VPA swiggy@icici. Avl Bal Rs.9,000.00',
      },
      {
        id: '2',
        source: 'sms',
        ts: at('2026-09-25T10:00:00+05:30'),
        body: 'Rs.250.00 debited from A/c XX4521 on 25-09-26 to VPA zomato@hdfc. Avl Bal Rs.8,500.00',
      },
    ]);
    await addAllReady();
    await refreshCheckpoints();
    const acc = (await db.accounts.toArray()).find((a) => a.last4 === '4521')!;
    const txns = await db.transactions.toArray();
    // ₹9,000 − 250 would be ₹8,750; the bank says ₹8,500 (a ₹250 charge had no SMS).
    expect(balanceOf(acc, txns, '2026-09-30')).toBe(8_500_00);
    expect(acc.check).toMatchObject({ amount: 8_500_00, date: '2026-09-25', drift: -250_00 });
    // Payments after the checkpoint still count.
    await ingestCaptured([
      {
        id: '3',
        source: 'sms',
        ts: at('2026-09-26T10:00:00+05:30'),
        body: 'Rs.100.00 debited from A/c XX4521 on 26-09-26 to VPA chai@ybl.',
      },
    ]);
    await addAllReady();
    await refreshCheckpoints();
    const acc2 = (await db.accounts.get(acc.id))!;
    expect(balanceOf(acc2, await db.transactions.toArray(), '2026-09-30')).toBe(8_400_00);
  });

  it('turns a card’s available limit into the exact amount owed', async () => {
    await ingestCaptured([
      {
        id: '4',
        source: 'sms',
        ts: at('2026-09-28T10:00:00+05:30'),
        body: 'Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01. Avl Lmt Rs.95,000.00',
      },
    ]);
    await addAllReady();
    await refreshCheckpoints();
    const card = (await db.accounts.toArray()).find((a) => a.last4 === '8834')!;
    expect(balanceOf(card, await db.transactions.toArray(), '2026-09-30')).toBe(5_000_00);
    expect(card.lastAvailable).toEqual({ amount: 95_000_00, date: '2026-09-28' });
  });

  it('a limit lower than the available limit never makes the card "owe" a negative amount', async () => {
    // The user typed ₹1,00,000 as the limit; the bank says ₹1,43,000 is available.
    await ingestCaptured([
      {
        id: '5',
        source: 'sms',
        ts: at('2026-09-20T10:00:00+05:30'),
        body: 'Spent Rs.2,000 On HDFC Bank Card 8834 At AMAZON On 2026-09-20:10:15:01.',
      },
      {
        id: '6',
        source: 'sms',
        ts: at('2026-09-28T10:00:00+05:30'),
        body: 'Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01. Avl Lmt Rs.1,43,000.00',
      },
    ]);
    await addAllReady();
    await refreshCheckpoints();
    let card = (await db.accounts.toArray()).find((a) => a.last4 === '8834')!;
    const txns = await db.transactions.toArray();
    // Not −₹43,000 (−43%): the reading is set aside and the payments still count.
    expect(balanceOf(card, txns, '2026-09-30')).toBe(3_499_00);
    expect(card.lastAvailable?.amount).toBe(1_43_000_00);
    // The real limit is ₹2,00,000: the same message now says ₹57,000 owed.
    await db.accounts.update(card.id, { card: { ...card.card!, creditLimit: 2_00_000_00 } });
    await refreshCheckpoints();
    card = (await db.accounts.get(card.id))!;
    expect(balanceOf(card, txns, '2026-09-30')).toBe(57_000_00);
    // A statement before the anchor works back from it (₹57,000 − 1,499 − 2,000 on 19 Sep).
    expect(balanceOf(card, txns, '2026-09-19')).toBe(53_501_00);
  });

  it('correcting the limit after a bad reading re-anchors on the same message', async () => {
    await ingestCaptured([
      {
        id: '7',
        source: 'sms',
        ts: at('2026-09-28T10:00:00+05:30'),
        body: 'Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01. Avl Lmt Rs.95,000.00',
      },
    ]);
    await addAllReady();
    await refreshCheckpoints();
    let card = (await db.accounts.toArray()).find((a) => a.last4 === '8834')!;
    expect(balanceOf(card, await db.transactions.toArray())).toBe(5_000_00);
    await db.accounts.update(card.id, { card: { ...card.card!, creditLimit: 1_20_000_00 } });
    await refreshCheckpoints();
    card = (await db.accounts.get(card.id))!;
    expect(balanceOf(card, await db.transactions.toArray())).toBe(25_000_00);
  });
});
