import 'fake-indexeddb/auto';
import { balanceOf, debtBalance, summariseMonth } from '../domain/ledger';
import { resolvePersonPayment, splitWithFriends } from './loans';
import { db, resetAll, setMeta } from './repo';
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
  await resetAll();
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
