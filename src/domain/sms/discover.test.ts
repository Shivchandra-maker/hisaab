import { discoverAccounts, type ScannedMessage } from './discover';
import { parseSms } from './parse';

const msg = (text: string, receivedAt = '2026-10-01', ts = 0): ScannedMessage => ({
  parsed: parseSms(text),
  receivedAt,
  ts,
});

const MESSAGES = [
  msg('Sent Rs.250.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 28/09/26\nRef 426712345678'),
  msg('Rs.5000 withdrawn from A/c XX4521 at ATM on 14-09-26. Avl Bal Rs.45,000.50'),
  msg(
    'Update! INR 1,15,000.00 deposited in HDFC Bank A/c XX4521 on 01-OCT-26 for NEFT Cr-EMPLOYER TECH PVT LTD. Avl bal INR 1,60,250.00.',
  ),
  msg('Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01.'),
  msg(
    'Statement for HDFC Bank Credit Card XX8834 is generated. Total Amt Due: Rs.12,345.00 Min Amt Due: Rs.620.00 Due Date: 05-10-2026.',
    '2026-09-15',
  ),
  msg(
    "You've paid Rs.75 via PhonePe wallet for VISHWAKARMA KIRANA GENARAL STORE . Not you? Call us on 022-68727374. Remaining balance: Rs.339.",
    '2026-09-30',
  ),
  msg('123456 is your OTP for txn of Rs.1,499 at AMAZON on HDFC Bank card 8834. Do not share.'),
];

describe('discoverAccounts', () => {
  const found = discoverAccounts(MESSAGES);
  const byKey = Object.fromEntries(found.map((f) => [f.key, f]));

  it('finds the bank account, the card and the wallet', () => {
    expect(found.map((f) => f.key)).toEqual(['acct:4521', 'card:8834', 'wallet:phonepe']);
  });

  it('names them and counts the messages (OTPs ignored)', () => {
    expect(byKey['acct:4521']).toMatchObject({
      name: 'HDFC Bank',
      kind: 'bank',
      institution: 'HDFC Bank',
      messages: 3,
    });
    expect(byKey['card:8834']).toMatchObject({
      name: 'HDFC Credit Card',
      kind: 'credit_card',
      messages: 2,
    });
    expect(byKey['wallet:phonepe']).toMatchObject({ name: 'PhonePe wallet', kind: 'wallet' });
  });

  it('takes the latest stated balance and its date', () => {
    expect(byKey['acct:4521']!.balance).toEqual({ amount: 16025000, date: '2026-10-01' });
    expect(byKey['wallet:phonepe']!.balance).toEqual({ amount: 33900, date: '2026-09-30' });
  });

  it('reads the card bill day and days to pay from the statement', () => {
    expect(byKey['card:8834']).toMatchObject({
      statementDay: 15,
      dueDaysAfterStatement: 20,
      statementDue: { amount: 1234500, date: '2026-09-15' },
    });
    expect(byKey['card:8834']!.check).toBeUndefined();
  });

  it('suggests merging a debit card into the account of the same bank', () => {
    const f = discoverAccounts([
      ...MESSAGES,
      msg('Rs.640.00 spent on HDFC Bank Debit Card XX1290 at DMART on 2026-09-20.'),
    ]);
    const debit = f.find((x) => x.key === 'debit:1290');
    expect(debit).toMatchObject({ isDebitCard: true, mergeInto: 'acct:4521' });
    expect(debit!.check).toMatch(/Same account as HDFC Bank ••4521/);
  });

  it('guesses the bill day from the due date when pasted messages have no date', () => {
    const f = discoverAccounts([
      {
        parsed: parseSms(
          'Statement for HDFC Bank Credit Card XX8834 is generated. Total Amt Due: Rs.12,345.00 Due Date: 05-10-2026.',
        ),
        receivedAt: '2026-10-03',
        dated: false,
      },
    ]);
    expect(f[0]).toMatchObject({ statementDay: 15, dueDaysAfterStatement: 20 });
    expect(f[0]!.check).toMatch(/guessed/);
  });

  it('asks to check a card without a statement yet', () => {
    const f = discoverAccounts([
      msg('Spent Rs.300 On ICICI Bank Card 2207 At ZOMATO On 2026-09-28.'),
    ]);
    expect(f[0]).toMatchObject({ key: 'card:2207', name: 'ICICI Credit Card' });
    expect(f[0]!.check).toMatch(/Bill day/);
  });
});
