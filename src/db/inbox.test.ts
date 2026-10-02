import 'fake-indexeddb/auto';
import {
  addAllReady,
  addFromInbox,
  ingestCaptured,
  ingestMessages,
  reparseInboxIfNeeded,
  restoreInboxItem,
  suggestionFor,
} from './inbox';
import { db, resetAll, saveAccount, saveTransaction } from './repo';
import { summariseMonth } from '../domain/ledger';

const PASTE = `Sent Rs.250.00
From HDFC Bank A/C *4521
To SWIGGY
On 28/09/26
Ref 426712345678

Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01.

123456 is your OTP for txn of Rs.1,499 at AMAZON on HDFC Bank card 8834. Valid for 5 mins. Do not share.

Payment of Rs 22,028.00 has been received on your HDFC Bank Credit Card ending 8834 on 25-09-2026.

Dear Customer, Rs.1,499.00 will be debited from your HDFC Bank Card 8834 on 03-10-26 towards CULT FIT as per standing instruction.

INR 2,310.00 spent using ICICI Bank Card XX1234 on 28-Sep-26 on BIGBASKET.`;

beforeEach(async () => {
  await resetAll();
  const bank = await saveAccount({
    name: 'HDFC Savings',
    kind: 'bank',
    last4: '4521',
    institution: 'HDFC Bank',
    openingBalance: 50_000_00,
    openingDate: '2026-09-01',
    archived: false,
    sortOrder: 0,
  });
  await saveAccount({
    name: 'Regalia',
    kind: 'credit_card',
    last4: '8834',
    institution: 'HDFC Bank',
    openingBalance: 0,
    openingDate: '2026-09-01',
    archived: false,
    sortOrder: 1,
    card: {
      statementDay: 15,
      dueDaysAfterStatement: 20,
      creditLimit: 3_00_000_00,
      paymentAccountId: bank.id,
    },
  });
});

describe('inbox', () => {
  it('sorts a mixed paste into review, notice and ignored', async () => {
    const s = await ingestMessages(PASTE, { receivedAt: '2026-10-02' });
    expect(s).toEqual({
      read: 6,
      toReview: 4,
      duplicates: 0,
      ignored: 1,
      notices: 1,
      alreadySeen: 0,
    });
  });

  it('never captures the same message twice', async () => {
    await ingestMessages(PASTE, { receivedAt: '2026-10-02' });
    const again = await ingestMessages(PASTE, { receivedAt: '2026-10-02' });
    expect(again.alreadySeen).toBe(6);
    expect(await db.inbox.count()).toBe(6);
  });

  it('adds everything that is ready in one go, and leaves the unknown card for you', async () => {
    await ingestMessages(PASTE, { receivedAt: '2026-10-02' });
    const n = await addAllReady();
    expect(n).toBe(3);
    const left = await db.inbox.where('status').equals('new').toArray();
    expect(left).toHaveLength(1);
    expect(left[0]!.parsed.last4).toBe('1234');
    const txns = await db.transactions.toArray();
    // Swiggy + Cult.fit are spending; the card payment is a transfer and is not.
    expect(summariseMonth(txns, '2026-09').spent).toBe(25000 + 149900);
    expect(txns.find((t) => t.kind === 'transfer')?.amount).toBe(2202800);
    expect(txns.every((t) => t.source === 'sms' && t.rawText)).toBe(true);
  });

  it('spots a message for something already entered by hand', async () => {
    const card = (await db.accounts.where('kind').equals('credit_card').first())!;
    await saveTransaction({
      kind: 'expense',
      date: '2026-09-28',
      amount: 149900,
      accountId: card.id,
      categoryId: 'health',
      tags: [],
      source: 'manual',
      status: 'confirmed',
    });
    const s = await ingestMessages(
      'Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01.',
      { receivedAt: '2026-10-02' },
    );
    expect(s.duplicates).toBe(1);
    const item = (await db.inbox.toArray())[0]!;
    expect(item.status).toBe('duplicate');
    await restoreInboxItem(item.id);
    expect((await db.inbox.get(item.id))?.status).toBe('new');
  });

  it('learns your category for a merchant and uses it next time', async () => {
    await ingestMessages(
      'Sent Rs.250.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 28/09/26\nRef 426712345678',
      { receivedAt: '2026-10-02' },
    );
    const item = (await db.inbox.toArray())[0]!;
    const s = await suggestionFor(item);
    expect(s.categoryId).toBe('food');
    await addFromInbox(item.id, { ...s, accountId: s.accountId!, categoryId: 'gifts' });
    await ingestMessages(
      'Sent Rs.300.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 29/09/26\nRef 426799990000',
      { receivedAt: '2026-10-02' },
    );
    const next = (await db.inbox.where('status').equals('new').toArray())[0]!;
    expect((await suggestionFor(next)).categoryId).toBe('gifts');
  });

  it('remembers the account picked for a message that names none', async () => {
    const other = await saveAccount({
      name: 'Federal',
      kind: 'bank',
      openingBalance: 0,
      openingDate: '2026-09-01',
      archived: false,
      sortOrder: 2,
    });
    await ingestMessages(
      'Rs.250 debited for UPI payment to SHARMA STORES. UPI Ref 427800001111. -Federal Bank',
      { receivedAt: '2026-10-02' },
    );
    const first = (await db.inbox.where('status').equals('new').toArray())[0]!;
    const s1 = await suggestionFor(first);
    await addFromInbox(first.id, { ...s1, accountId: other.id });
    await ingestMessages(
      'Rs.90 debited for UPI payment to GUPTA DAIRY. UPI Ref 427800002222. -Federal Bank',
      { receivedAt: '2026-10-02' },
    );
    const next = (await db.inbox.where('status').equals('new').toArray())[0]!;
    expect((await suggestionFor(next)).accountId).toBe(other.id);
  });
});

describe('PhonePe wallet paste', () => {
  it('two ₹40 wallet payments on the same day are both kept', async () => {
    await resetAll();
    await saveAccount({
      name: 'PhonePe Wallet',
      kind: 'wallet',
      openingBalance: 1000_00,
      openingDate: '2026-09-01',
      archived: false,
      sortOrder: 0,
    });
    const preview =
      '\nPhonePe: UPI Payments, Investment, Insurance, Recharges, DTH & More\nPhonePe is a Digital Wallet & Online Payment App…';
    const paste = [
      `You've paid Rs.75 via PhonePe wallet for VISHWAKARMA KIRANA GENARAL STORE . Not you? Call us on 022-68727374. Remaining balance: Rs.339. To top-up click https://phone.pe/PHONPE/ws${preview}`,
      `You've paid Rs. 40 via PhonePe wallet. Not you? Call us on 022-68727374. Remaining balance: Rs.  649. To top-up click https://phone.pe/PHONPE/ws${preview}`,
      `You've paid Rs. 40 via PhonePe wallet. Not you? Call us on 022-68727374. Remaining balance: Rs.  414. To top-up click https://phone.pe/PHONPE/ws${preview}`,
    ].join('\n \n');
    const s = await ingestMessages(paste, { receivedAt: '2026-10-02' });
    expect(s).toMatchObject({ read: 3, toReview: 3, ignored: 0 });
    expect(await addAllReady()).toBe(3);
    const txns = await db.transactions.toArray();
    expect(txns.map((t) => t.amount).sort()).toEqual([4000, 4000, 7500]);
    expect(txns.find((t) => t.amount === 7500)?.categoryId).toBe('groceries');
  });
});

describe('parser upgrades', () => {
  it('re-reads messages already in the inbox', async () => {
    await resetAll();
    await saveAccount({
      name: 'PhonePe Wallet',
      kind: 'wallet',
      openingBalance: 0,
      openingDate: '2026-09-01',
      archived: false,
      sortOrder: 0,
    });
    await ingestMessages(
      "You've paid Rs.45 via PhonePe wallet for Sudhakar navuri. Not you? Call us on 022-68727374.",
      { receivedAt: '2026-10-02' },
    );
    const item = (await db.inbox.toArray())[0]!;
    await db.inbox.update(item.id, { parsed: { ...item.parsed, merchant: undefined } });
    await db.meta.put({ key: 'parserVersion', value: 1 });
    expect(await reparseInboxIfNeeded()).toBe(1);
    expect((await db.inbox.get(item.id))?.parsed.merchant).toBe('Sudhakar Navuri');
    expect(await reparseInboxIfNeeded()).toBe(0);
  });
});

describe('messages captured on the phone', () => {
  it('uses each message’s arrival time and pairs SMS with app notifications', async () => {
    await resetAll();
    await saveAccount({
      name: 'PhonePe Wallet',
      kind: 'wallet',
      openingBalance: 0,
      openingDate: '2026-09-01',
      archived: false,
      sortOrder: 0,
    });
    // 29 Sep, 23:50 IST
    const ts = Date.UTC(2026, 8, 29, 18, 20);
    const s = await ingestCaptured([
      {
        id: 'a',
        source: 'sms',
        sender: 'JD-PHONPE-S',
        ts,
        body: "You've paid Rs.45 via PhonePe wallet for Sudhakar navuri. Not you? Call us on 022-68727374.",
      },
      {
        id: 'b',
        source: 'notification',
        sender: 'com.phonepe.app',
        ts: ts + 30_000,
        body: 'Payment successful. Paid ₹45 to Sudhakar Navuri',
      },
      {
        id: 'c',
        source: 'notification',
        sender: 'com.phonepe.app',
        ts: ts + 3 * 3600_000,
        body: 'Payment successful. Paid ₹60 to Ramesh Juice Centre',
      },
    ]);
    expect(s).toMatchObject({ read: 3, toReview: 2, duplicates: 1 });
    const items = await db.inbox.toArray();
    expect(items.find((i) => i.sender === 'JD-PHONPE-S')?.receivedAt).toBe('2026-09-29');
    expect(items.find((i) => i.status === 'duplicate')?.source).toBe('notification');
    const juice = items.find((i) => i.parsed.amount === 6000)!;
    expect(juice.parsed).toMatchObject({ merchant: 'Ramesh Juice Centre', walletName: 'PhonePe' });
    expect(juice.receivedAt).toBe('2026-09-30');
  });
});
