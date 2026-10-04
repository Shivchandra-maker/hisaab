import 'fake-indexeddb/auto';
import { balanceOf, debtBalance, summariseMonth } from '../domain/ledger';
import { resolvePersonPayment, reviewLoanQuestions, splitWithFriends } from './loans';
import { setContacts } from '../domain/people';
import { db, resetAll, setMeta } from './repo';
import type { CapturedMessage } from './inbox';
import { reparseInboxIfNeeded } from './inbox';
import { PARSER_VERSION } from '../domain/sms/parse';
import { finishSetup, pastedToCaptured, scanMessages } from './setup';

const PASTE = `Sent Rs.250.00
From HDFC Bank A/C *4521
To SWIGGY
On 28/09/26
Ref 426712345678

Rs.5000 withdrawn from A/c XX4521 at ATM on 14-09-26. Avl Bal Rs.45,000.50

Update! INR 1,15,000.00 deposited in HDFC Bank A/c XX4521 on 01-OCT-26 for NEFT Cr-EMPLOYER TECH PVT LTD. Avl bal INR 1,60,250.00.

Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01.

Statement for HDFC Bank Credit Card XX8834 is generated. Total Amt Due: Rs.12,345.00 Min Amt Due: Rs.620.00 Due Date: 05-10-2026.

Sent Rs.500.00
From HDFC Bank A/C *4521
To RAHUL SHARMA
On 29/09/26
Ref 426799990001

INR 2,310.00 spent using ICICI Bank Card XX1234 on 28-Sep-26 on BIGBASKET.`;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T10:00:00+05:30'));
  setContacts([{ name: 'Rahul Sharma', phones: ['+91 98765 43210'] }]);
  await resetAll();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup(keepIcici = true) {
  const messages = pastedToCaptured(PASTE, '2026-10-01');
  // On the phone each message keeps its arrival time; the statement came on the 15th.
  const stmt = messages.find((m) => m.body.startsWith('Statement'))!;
  stmt.ts = new Date('2026-09-15T09:00:00+05:30').getTime();
  const found = scanMessages(messages);
  const choices = found.map((f) => ({
    found: f,
    keep: keepIcici || f.last4 !== '1234',
    name: f.name,
  }));
  return { found, result: await finishSetup(choices, messages, { cash: true }) };
}

describe('setup from SMS', () => {
  it('finds accounts and adds every ready payment without review', async () => {
    const { found, result } = await setup();
    expect(found.map((f) => f.key)).toEqual(['acct:4521', 'card:8834', 'card:1234']);
    expect(result.accounts).toBe(4); // + Cash
    const txns = await db.transactions.toArray();
    // Swiggy, salary, Cult, Rahul, BigBasket (+ ATM as a transfer to Cash)
    expect(txns).toHaveLength(6);
    expect(await db.inbox.where('status').equals('new').count()).toBe(0);
    expect((await db.meta.get('onboarded'))?.value).toBe(true);
  });

  it('starts the bank balance from the latest balance message', async () => {
    await setup();
    const acc = (await db.accounts.toArray()).find((a) => a.last4 === '4521')!;
    const txns = await db.transactions.toArray();
    expect(balanceOf(acc, txns, '2026-10-01')).toBe(16025000);
    expect(acc.openingDate).toBe('2026-10-01');
  });

  it('starts the card from its statement amount and bill day', async () => {
    await setup();
    const card = (await db.accounts.toArray()).find((a) => a.last4 === '8834')!;
    expect(card.card).toMatchObject({ statementDay: 15, dueDaysAfterStatement: 20 });
    const txns = await db.transactions.toArray();
    expect(balanceOf(card, txns, '2026-09-15')).toBe(1234500);
  });

  it('keeps messages of accounts you said are not yours out of the way', async () => {
    await setup(false);
    const left = await db.inbox.where('status').equals('new').count();
    expect(left).toBe(0);
    const ignored = await db.inbox.toArray();
    expect(ignored.some((i) => i.note === 'Not your account')).toBe(true);
  });

  it('does not learn merchant rules from automatic adds', async () => {
    await setup();
    expect(await db.rules.count()).toBe(0);
  });
});

describe('payments to people', () => {
  it('asks about a payment to a person and turns it into a loan', async () => {
    await setup();
    const rahul = (await db.transactions.toArray()).find((t) => t.merchant === 'Rahul Sharma')!;
    expect(rahul.askLoan).toBe(true);
    expect(rahul.kind).toBe('expense');
    const debtId = await resolvePersonPayment(rahul.id, 'Rahul Sharma', 'lent');
    const after = await db.transactions.get(rahul.id);
    expect(after).toMatchObject({ kind: 'debt', flow: 'out', debtId });
    expect(after!.askLoan).toBeUndefined();
    const debt = (await db.debts.get(debtId!))!;
    expect(debtBalance(debt, await db.transactions.toArray()).outstanding).toBe(50000);
    // No longer spending, and the bank balance is unchanged.
    const sum = summariseMonth(await db.transactions.toArray(), '2026-09');
    expect(sum.spent).toBe(25000 + 149900 + 231000);
  });

  it('never asks about people who are not your contacts', async () => {
    setContacts([]);
    await setup();
    expect((await db.transactions.toArray()).filter((t) => t.askLoan)).toHaveLength(0);
  });

  it('clears old questions when the rules change', async () => {
    await setup();
    const rahul = (await db.transactions.toArray()).find((t) => t.merchant === 'Rahul Sharma')!;
    expect(rahul.askLoan).toBe(true);
    setContacts([]);
    expect(await reviewLoanQuestions()).toEqual({ asked: 0, cleared: 1 });
    expect((await db.transactions.get(rahul.id))!.askLoan).toBeUndefined();
  });

  it('stops asking about a person once you say it was spending', async () => {
    await setup();
    const rahul = (await db.transactions.toArray()).find((t) => t.merchant === 'Rahul Sharma')!;
    await resolvePersonPayment(rahul.id, 'Rahul Sharma', 'spent');
    const answers = (await db.meta.get('personAnswers'))?.value as Record<string, string>;
    expect(answers['rahul sharma']).toBe('spent');
  });

  it('splits a bill into my share and money lent', async () => {
    await setup();
    await setMeta('x', 1);
    const big = (await db.transactions.toArray()).find(
      (t) => t.merchant === 'Bigbasket' || t.amount === 231000,
    )!;
    await splitWithFriends(big.id, [{ person: 'Asha', amount: 100000 }]);
    const txns = await db.transactions.toArray();
    expect((await db.transactions.get(big.id))!.amount).toBe(131000);
    const loan = txns.find((t) => t.kind === 'debt' && t.amount === 100000)!;
    expect(loan).toMatchObject({ flow: 'out', accountId: big.accountId });
  });
});

/** Phone messages with their real arrival times (IST). */
function phone(list: [string, string, string][]): CapturedMessage[] {
  return list.map(([when, sender, body], i) => ({
    id: `inbox-${i}`,
    source: 'sms',
    sender,
    body,
    ts: new Date(`${when}+05:30`).getTime(),
  }));
}

const SALARY =
  'Update! INR 1,15,000.00 deposited in HDFC Bank A/c XX4521 on 01-OCT-26 for NEFT Cr-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY-CITIN426700020772.Avl bal INR 2,00,000.00.';
const TO_SELF =
  'Sent Rs.40000.00 From HDFC Bank A/C *4521 To Self Kotak Bank XX3344 On 01/10/26 Ref 426700028100 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808';
const KOTAK_IN =
  'Received Rs. 40000.00 on 01-10-26 in your Kotak Bank A/C x3344 by an A/C linked to mobile x111. IMPS Ref no 426700099339.';
const KOTAK_SPEND =
  'Sent Rs.292.00 from Kotak Bank AC X3344 to swiggy.stores@icici on 02-10-26.UPI Ref 426721777329. Not you, https://kotak.com/KBANKT/Fraud';
const SCAM =
  'Your SBI account is suspended. Rs.4999 will be debited. Click http://sbi-reward.in to stop';
const DUE =
  'Payment of Rs 4,604.00 on HDFC Bank Credit Card xx8834 is due on 06-10-26. Min due: Rs 500. Ignore if paid';
const CARD_SPEND =
  'Spent Rs.979.00 On HDFC Bank Card 8834 At BPCL FUEL On 2026-10-02:15:03:13 Not You? To Block+Reissue Call 18002323232';

async function setupFrom(messages: CapturedMessage[]) {
  const found = scanMessages(messages);
  const choices = found.map((f) => ({ found: f, keep: !f.unsure, name: f.name }));
  await finishSetup(choices, messages, { cash: false });
  return { found, txns: await db.transactions.toArray(), accounts: await db.accounts.toArray() };
}

describe('testing round 3 S1 fixes', () => {
  it('H-02/H-03/H-04: transfers, scams and bill reminders never count as money', async () => {
    const { found, txns, accounts } = await setupFrom(
      phone([
        ['2026-10-01T09:00:00', 'VM-HDFCBK-S', SALARY],
        ['2026-10-01T10:00:00', 'VM-HDFCBK-S', TO_SELF],
        ['2026-10-01T10:00:20', 'JD-KOTAKB-S', KOTAK_IN],
        ['2026-10-02T13:00:00', 'JD-KOTAKB-S', KOTAK_SPEND],
        ['2026-10-02T15:03:20', 'AD-HDFCCC-S', CARD_SPEND],
        ['2026-10-02T18:00:00', 'BZ-SBIUPI-T', SCAM],
        ['2026-10-03T18:00:00', 'BZ-SBIUPI-T', SCAM],
        ['2026-10-03T09:00:00', 'VM-HDFCCC-S', DUE],
      ]),
    );
    // No "State Bank of India" from the scam.
    expect(found.map((f) => f.key).sort()).toEqual(['acct:3344', 'acct:4521', 'card:8834']);
    const hdfc = accounts.find((a) => a.last4 === '4521')!;
    const kotak = accounts.find((a) => a.last4 === '3344')!;
    const oct = summariseMonth(txns, '2026-10');
    expect(oct.income).toBe(11500000); // salary only, not the ₹40,000 move
    expect(oct.spent).toBe(29200 + 97900); // Swiggy + fuel; no ₹4,604 reminder, no ₹4,999 scam
    const moves = txns.filter((t) => t.kind === 'transfer' && !t.deletedAt);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ amount: 4000000, accountId: hdfc.id, toAccountId: kotak.id });
    expect(txns.some((t) => t.date > '2026-10-04')).toBe(false);
    expect(balanceOf(hdfc, txns, '2026-10-04')).toBe(20000000 - 4000000);
  });

  it('H-02: pairs a move between your accounts even when neither message says "self"', async () => {
    const { txns, accounts } = await setupFrom(
      phone([
        // The credit arrives first this time, and the debit names a person-like payee.
        ['2026-10-01T10:00:00', 'JD-KOTAKB-S', KOTAK_IN],
        [
          '2026-10-01T10:00:30',
          'VM-HDFCBK-S',
          'Sent Rs.40000.00 From HDFC Bank A/C *4521 To ARJUN K On 01/10/26 Ref 426700028101',
        ],
        ['2026-10-02T13:00:00', 'JD-KOTAKB-S', KOTAK_SPEND],
      ]),
    );
    const oct = summariseMonth(txns, '2026-10');
    expect(oct.income).toBe(0);
    expect(oct.spent).toBe(29200);
    const move = txns.find((t) => t.kind === 'transfer')!;
    expect(move.accountId).toBe(accounts.find((a) => a.last4 === '4521')!.id);
    expect(move.toAccountId).toBe(accounts.find((a) => a.last4 === '3344')!.id);
  });

  it('H-02: small same-amount payments on two accounts are not paired', async () => {
    const { txns } = await setupFrom(
      phone([
        ['2026-10-01T10:00:00', 'JD-KOTAKB-S', KOTAK_SPEND],
        [
          '2026-10-02T11:00:00',
          'VM-HDFCBK-S',
          'Received Rs.292.00 in your HDFC Bank A/c XX4521 from asha.k@okaxis on 02-10-26. UPI Ref 426700011111',
        ],
      ]),
    );
    expect(txns.filter((t) => t.kind === 'transfer')).toHaveLength(0);
  });

  it('H-04: a bill reminder already added by an older version is taken back out', async () => {
    await setupFrom(phone([['2026-10-02T13:00:00', 'JD-KOTAKB-S', KOTAK_SPEND]]));
    const kotak = (await db.accounts.toArray())[0]!;
    const now = new Date().toISOString();
    await db.transactions.add({
      id: 't-old',
      kind: 'expense',
      amount: 460400,
      date: '2026-10-06',
      accountId: kotak.id,
      categoryId: 'other',
      tags: [],
      source: 'sms',
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    });
    await db.inbox.add({
      id: 'i-old',
      source: 'sms',
      rawText: DUE,
      hash: 'old',
      receivedAt: '2026-10-03',
      parsed: { kind: 'debit', amount: 460400, instrument: 'credit_card', confidence: 0.9 },
      status: 'added',
      txnId: 't-old',
      createdAt: now,
      updatedAt: now,
    });
    await setMeta('parserVersion', PARSER_VERSION - 1);
    await reparseInboxIfNeeded();
    expect((await db.transactions.get('t-old'))!.deletedAt).toBeTruthy();
    expect((await db.inbox.get('i-old'))!.status).toBe('ignored');
  });
});
