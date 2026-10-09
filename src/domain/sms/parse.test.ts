import { findDate, findTime, parseSms, splitMessages } from './parse';

/*
 * Message shapes modelled on real Indian bank alerts (numbers, names and IDs changed).
 * When a real message parses wrongly, add it here first, then fix the parser.
 */

describe('debits', () => {
  it('HDFC UPI, multi-line', () => {
    const p = parseSms(`Sent Rs.250.00
From HDFC Bank A/C *4521
To SWIGGY
On 28/09/26
Ref 426712345678
Not You?
Call 18002586161/SMS BLOCK UPI to 7308080808`);
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 25000,
      last4: '4521',
      instrument: 'account',
      merchant: 'Swiggy',
      date: '2026-09-28',
      ref: '426712345678',
      mode: 'upi',
      bank: 'HDFC Bank',
    });
  });

  it('HDFC credit card spend', () => {
    const p = parseSms(
      'Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28:10:15:01.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 8834 to 7308080808',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 149900,
      last4: '8834',
      instrument: 'credit_card',
      merchant: 'Cult Fit',
      date: '2026-09-28',
      mode: 'card',
    });
  });

  it('ICICI card with available limit (limit is not the amount)', () => {
    const p = parseSms(
      'INR 2,310.00 spent using ICICI Bank Card XX1234 on 28-Sep-26 on BIGBASKET. Avl Limit: INR 1,52,345.00. If not you, call 1800 2662/SMS BLOCK 1234 to 9215676766.',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 231000,
      last4: '1234',
      instrument: 'credit_card',
      merchant: 'Bigbasket',
      date: '2026-09-28',
      balance: 15234500,
      balanceIsLimit: true,
    });
  });

  it('SBI UPI without a currency symbol', () => {
    const p = parseSms(
      'Dear UPI user A/C X0917 debited by 120.0 on date 28Sep26 trf to RAPIDO Refno 426798765432. If not u? call 1800111109. -SBI',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 12000,
      last4: '0917',
      merchant: 'Rapido',
      date: '2026-09-28',
      ref: '426798765432',
      bank: 'State Bank of India',
    });
  });

  it('Axis UPI P2M line', () => {
    const p = parseSms(`INR 649.00 debited
A/c no. XX2210
28-09-26, 08:01:11
UPI/P2M/426711112222/NETFLIX
Not you? SMS BLOCKUPI Cust ID to 919951860002
Axis Bank`);
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 64900,
      last4: '2210',
      merchant: 'Netflix',
      ref: '426711112222',
      date: '2026-09-28',
    });
  });

  it('Kotak UPI to a person by VPA', () => {
    const p = parseSms(
      'Sent Rs.500.00 from Kotak Bank AC X3344 to rahul.k@okaxis on 28-09-26.UPI Ref 426733334444. Not you, https://kotak.com/KBANKT/Fraud',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 50000,
      last4: '3344',
      vpa: 'rahul.k@okaxis',
      merchant: 'Rahul K',
      ref: '426733334444',
      mode: 'upi',
    });
  });

  it('ATM withdrawal', () => {
    const p = parseSms(
      'Rs.5000 withdrawn from A/c XX4521 at ATM on 14-09-26. Avl Bal Rs.45,000.50',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 500000,
      isAtm: true,
      mode: 'atm',
      balance: 4500050,
    });
  });

  it('bank debit that pays a credit-card bill', () => {
    const p = parseSms(
      'Rs 22,028.00 debited from A/c XX4521 on 25-09-26 towards HDFC Credit Card bill payment. Avl bal Rs 1,02,000.00',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 2202800,
      last4: '4521',
      isCardBillPayment: true,
    });
  });

  it('auto-debit that actually happened is a debit, not a notice', () => {
    const p = parseSms(
      'Rs.1,499.00 has been debited from your HDFC Bank Card 8834 towards CULT FIT on 03-10-26 as per standing instruction.',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 149900,
      isRecurring: true,
      mode: 'auto_debit',
      merchant: 'Cult Fit',
    });
  });
});

describe('credits', () => {
  it('salary by NEFT, with balance', () => {
    const p = parseSms(
      'Update! INR 1,15,000.00 deposited in HDFC Bank A/c XX4521 on 01-OCT-26 for NEFT Cr-EMPLOYER TECH PVT LTD. Avl bal INR 1,60,250.00. Cheque deposits in A/C are subject to clearing',
    );
    expect(p).toMatchObject({
      kind: 'credit',
      amount: 11500000,
      last4: '4521',
      date: '2026-10-01',
      merchant: 'Employer Tech',
      balance: 16025000,
    });
  });

  it('refund to card', () => {
    const p = parseSms(
      'Refund of Rs.470.00 from AMAZON credited to your HDFC Bank Card 8834 on 30-09-26.',
    );
    expect(p).toMatchObject({
      kind: 'credit',
      amount: 47000,
      isRefund: true,
      last4: '8834',
      merchant: 'Amazon',
    });
  });

  it('UPI money received from a person', () => {
    const p = parseSms(
      'Rs.1000.00 credited to a/c XXXXXX4521 on 26-09-26 by a/c linked to VPA rahul.k@okaxis (UPI Ref No 426755556666).',
    );
    expect(p).toMatchObject({
      kind: 'credit',
      amount: 100000,
      last4: '4521',
      vpa: 'rahul.k@okaxis',
      ref: '426755556666',
    });
  });

  it('card issuer confirms a bill payment', () => {
    const p = parseSms(
      'Payment of Rs 22,028.00 has been received on your HDFC Bank Credit Card ending 8834 on 25-09-2026. Thank you.',
    );
    expect(p).toMatchObject({
      kind: 'card_payment',
      amount: 2202800,
      last4: '8834',
      date: '2026-09-25',
    });
  });
});

describe('not transactions', () => {
  it.each([
    [
      '123456 is your OTP for txn of Rs.1,499 at AMAZON on HDFC Bank card 8834. Valid for 5 mins. Do not share.',
      'One-time password',
    ],
    ['Txn of Rs.2,000 declined on card 8834 due to insufficient limit. -ICICI', 'Declined'],
    [
      'Congratulations! You are eligible for a pre-approved personal loan of Rs 5,00,000. Apply now: http://x.y',
      'Promotion',
    ],
  ])('%s', (sms, reason) => {
    const p = parseSms(sms);
    expect(p.kind).toBe('ignore');
    expect(p.reason).toContain(reason);
  });
});

describe('notices', () => {
  it('UPI AutoPay set up', () => {
    const p = parseSms(
      'Your UPI AutoPay mandate for NETFLIX of Rs 649.00 (monthly) has been successfully created on A/c XX4521. UMN: abcd1234@hdfcbank',
    );
    expect(p).toMatchObject({
      kind: 'autopay_notice',
      amount: 64900,
      frequency: 'monthly',
      last4: '4521',
      reason: 'New autopay set up',
    });
  });

  it('pre-debit reminder', () => {
    const p = parseSms(
      'Dear Customer, Rs.1,499.00 will be debited from your HDFC Bank Card 8834 on 03-10-26 towards CULT FIT as per standing instruction.',
    );
    expect(p).toMatchObject({
      kind: 'autopay_notice',
      amount: 149900,
      scheduledDate: '2026-10-03',
      last4: '8834',
      reason: 'Upcoming autopay debit',
    });
  });

  it('EMI conversion', () => {
    const p = parseSms(
      'Your transaction of Rs 24,000.00 at STAR HEALTH on HDFC Bank Credit Card 8834 has been converted to 12 EMIs of Rs 2,140.50.',
    );
    expect(p).toMatchObject({
      kind: 'emi_notice',
      amount: 2400000,
      emiMonths: 12,
      emiAmount: 214050,
      last4: '8834',
    });
  });
});

describe('helpers', () => {
  it('dates in many forms', () => {
    expect(findDate('on 01-OCT-26')).toBe('2026-10-01');
    expect(findDate('on 28Sep26 trf')).toBe('2026-09-28');
    expect(findDate('28/09/2026')).toBe('2026-09-28');
    expect(findDate('on 31-02-26')).toBeUndefined();
  });

  it('splits pasted messages on blank lines and one-per-line pastes', () => {
    expect(splitMessages('a Rs.1 x\n\nb Rs.2 y')).toHaveLength(2);
    const lines = [
      'Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28',
      'INR 2,310.00 spent using ICICI Bank Card XX1234 on 28-Sep-26 on BIGBASKET.',
    ].join('\n');
    expect(splitMessages(lines)).toHaveLength(2);
    expect(splitMessages('Sent Rs.250.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY')).toHaveLength(1);
  });
});

describe("real messages from the owner's phone (numbers changed)", () => {
  const PREVIEW =
    '\nPhonePe: UPI Payments, Investment, Insurance, Recharges, DTH & More\nPhonePe is a Digital Wallet & Online Payment App that allows you to make instant Money Transfers with UPI. Recharge Mobile, DTH, Pay Utility Bills, Buy/Invest in Gold, Mutual Funds, Insurance & muc...';

  it('HDFC UPI through a payment gateway (CRED Pay → Playo)', () => {
    const p = parseSms(
      'Sent Rs.520.80\nFrom HDFC Bank A/C *7132\nTo CREDPAYPLAYO\nOn 02/10/26\nRef 664113957838\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 52080,
      last4: '7132',
      merchant: 'Playo',
      date: '2026-10-02',
      ref: '664113957838',
      isCardBillPayment: false,
    });
  });

  it('PhonePe wallet payment with a shop name and a link preview', () => {
    const p = parseSms(
      `You've paid Rs.75 via PhonePe wallet for VISHWAKARMA KIRANA GENARAL STORE . Not you? Call us on 022-68727374. Remaining balance: Rs.339. To top-up click https://phone.pe/PHONPE/ws${PREVIEW}`,
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 7500,
      instrument: 'wallet',
      walletName: 'PhonePe',
      merchant: 'Vishwakarma Kirana Genaral Store',
      balance: 33900,
      isWalletTopUp: false,
    });
    expect(p.last4).toBeUndefined();
  });

  it('PhonePe wallet payment to a person', () => {
    const p = parseSms(
      `You've paid Rs.45 via PhonePe wallet for Sudhakar navuri. Not you? Call us on 022-68727374. Remaining balance: Rs.443. To top-up click https://phone.pe/PHONPE/ws${PREVIEW}`,
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 4500,
      merchant: 'Sudhakar Navuri',
      instrument: 'wallet',
    });
  });

  it('PhonePe wallet payment with no payee, spaces after Rs.', () => {
    const p = parseSms(
      `You've paid Rs. 40 via PhonePe wallet. Not you? Call us on 022-68727374. Remaining balance: Rs.  649. To top-up click https://phone.pe/PHONPE/ws${PREVIEW}`,
    );
    expect(p).toMatchObject({ kind: 'debit', amount: 4000, instrument: 'wallet', balance: 64900 });
    expect(p.merchant).toBeUndefined();
    expect(p.date).toBeUndefined();
  });
});

describe('card statements', () => {
  it('reads total due, minimum due and due date, and never makes a payment', () => {
    const p = parseSms(
      'Statement for HDFC Bank Credit Card XX8834 is generated. Total Amt Due: Rs.12,345.00 Min Amt Due: Rs.620.00 Due Date: 05-10-2026. Pay now: hdfc.bank.in/x',
    );
    expect(p).toMatchObject({
      kind: 'ignore',
      reason: 'Card statement',
      instrument: 'credit_card',
      last4: '8834',
      bank: 'HDFC Bank',
      statement: { totalDue: 1234500, minDue: 62000, dueDate: '2026-10-05' },
    });
  });
  it('handles other wordings', () => {
    const a = parseSms(
      'Your ICICI Bank Credit Card XX2207 statement has been sent to your email. Total amount due INR 4,560.50, minimum amount due INR 230. Payment due date 02-Nov-26.',
    );
    expect(a.statement).toEqual({ totalDue: 456050, minDue: 23000, dueDate: '2026-11-02' });
    expect(a.last4).toBe('2207');
    const b = parseSms(
      'Dear Customer, your SBI Card ending 1122 e-statement dated 20/09/2026 is ready. Total Amount Due Rs 8,000; Minimum Amount Due Rs 400; Payment Due Date 10/10/2026',
    );
    expect(b.statement).toEqual({ totalDue: 800000, minDue: 40000, dueDate: '2026-10-10' });
    expect(b.date).toBe('2026-09-20');
  });
});

describe('balance updates', () => {
  it('reads a balance enquiry reply without making a payment', () => {
    const p = parseSms(
      'Dear Customer, Avl Bal in your HDFC Bank A/c XX4521 is Rs.23,450.50 as on 03-10-26 10:15. Call 18002026161 for help.',
    );
    expect(p).toMatchObject({
      kind: 'ignore',
      reason: 'Balance update',
      last4: '4521',
      balance: 2345050,
      date: '2026-10-03',
    });
  });
});

describe('testing round 3 (S1 fixes)', () => {
  it('H-04: card bill-due reminder is never a payment', () => {
    for (const s of [
      'Payment of Rs 4,604.00 on HDFC Bank Credit Card xx8834 is due on 06-10-26. Min due: Rs 500. Ignore if paid',
      'Your Kotak Credit Card bill of Rs.12,450.00 is due on 15-10-2026. Minimum amount due Rs.623. Please pay on time.',
      'Reminder: Total Amount Due of INR 8,900.00 on your Axis Bank Credit Card XX7441 is payable by 21-10-26.',
      'EMI of Rs 3,250 for your loan a/c XX9911 is due on 05-11-26. Please keep sufficient balance.',
    ]) {
      const p = parseSms(s);
      expect(p.kind, s).toBe('ignore');
      expect(p.reason, s).toBe('Payment reminder — not paid yet');
    }
    const p = parseSms(
      'Payment of Rs 4,604.00 on HDFC Bank Credit Card xx8834 is due on 06-10-26. Min due: Rs 500. Ignore if paid',
    );
    expect(p).toMatchObject({ instrument: 'credit_card', last4: '8834' });
  });

  it('H-04: a bill actually paid is still a payment', () => {
    expect(
      parseSms(
        'Rs.13318.00 debited from A/c XX4521 on 01-Apr-26 to VPA cred.club@axisb (UPI Ref No 426715777045)',
      ).kind,
    ).toBe('debit');
    expect(
      parseSms(
        'DEAR CARDMEMBER, PAYMENT OF Rs. 9084.00 RECEIVED TOWARDS YOUR HDFC BANK CREDIT CARD ENDING 8834 ON 01-11-2025.',
      ).kind,
    ).toBe('card_payment');
  });

  it('H-06: statement "payable by" date is the due date, not the statement date', () => {
    const p = parseSms(
      'Your HDFC Bank Credit Card 8834 statement for Apr-26 has been generated. Total due Rs.16688.00, Minimum due Rs.834.40, payable by 05-May-26.',
    );
    expect(p.statement).toMatchObject({ totalDue: 1668800, dueDate: '2026-05-05' });
    expect(p.date).toBeUndefined();
  });

  it('H-03: scam and phishing messages are never payments', () => {
    for (const s of [
      'Your SBI account is suspended. Rs.4999 will be debited. Click http://sbi-reward.in to stop',
      'Dear Customer, your KYC is pending. Your account will be blocked today. Update at http://kyc-paytm-verify.co Rs.1 fee',
      'Dear SBI user, Rs.9,850 debited from your account. If not done by you click https://sbi-secure-login.top to block',
      'Your HDFC account will be blocked. Rs 25,000 credited as reward points, claim at bit.ly/hdfc-redeem',
    ]) {
      const p = parseSms(s);
      expect(p.kind, s).toBe('ignore');
    }
    expect(
      parseSms(
        'Your SBI account is suspended. Rs.4999 will be debited. Click http://sbi-reward.in to stop',
      ).reason,
    ).toBe('Looks like a scam message');
  });

  it('H-03: "will be debited" alone is a heads-up, not a payment', () => {
    const p = parseSms(
      'Your A/c XX4521 will be debited with Rs.1,200.00 on 10-10-26 towards LIC premium.',
    );
    expect(p.kind).not.toBe('debit');
  });

  it("H-03: real alerts with the bank's own link still count", () => {
    expect(
      parseSms(
        'Sent Rs.292.00 from Kotak Bank AC X3344 to q817263542@ybl on 09-06-26.UPI Ref 426721777329. Not you, https://kotak.com/KBANKT/Fraud',
      ),
    ).toMatchObject({ kind: 'debit', amount: 29200, last4: '3344' });
  });

  it('H-02: transfer to your own account names the other account', () => {
    const p = parseSms(
      'Sent Rs.40000.00 From HDFC Bank A/C *4521 To Self Kotak Bank XX3344 On 01/10/25 Ref 426700028100 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      amount: 4000000,
      last4: '4521',
      otherLast4: '3344',
      isSelfTransfer: true,
    });
    const q = parseSms(
      'Rs.25,000.00 transferred from A/c XX4521 to A/c XX3344 on 02-10-26. IMPS Ref 426799991234',
    );
    expect(q).toMatchObject({ kind: 'debit', last4: '4521', otherLast4: '3344' });
  });

  it('H-02: money received names no source → no other account', () => {
    const p = parseSms(
      'Received Rs. 40000.00 on 01-10-25 in your Kotak Bank A/C x3344 by an A/C linked to mobile x111. IMPS Ref no 426700099339.',
    );
    expect(p).toMatchObject({ kind: 'credit', amount: 4000000, last4: '3344' });
    expect(p.otherLast4).toBeUndefined();
  });
});

describe('payment requests (H-15, seen in the simulator)', () => {
  it('UPI collect / payment requests are never payments', () => {
    for (const s of [
      'Payment request of INR 782.00 from merchant@upi. Ignore if already paid.',
      'You have received a collect request of Rs. 500 from someone@slc on slice. Approve or decline in the app. - slice',
      'Rahul has requested money from you on Google Pay. On approving the request, INR 300.00 will be debited from your A/c',
    ])
      expect(parseSms(s).kind, s).toBe('ignore');
  });
});

describe('time of day (U-15)', () => {
  it('reads the time in common alert formats', () => {
    expect(
      findTime('Spent Rs.3298.00 On HDFC Bank Card 8834 At AMAZON On 2025-10-13:22:29:42'),
    ).toBe('22:29');
    expect(findTime('Spent INR 675 Axis Bank Card no. XX7441 03-01-26 11:55:55 IST AMAZON')).toBe(
      '11:55',
    );
    expect(
      findTime('spent on IDFC FIRST Bank Credit Card at AMAZON EU on 08-FEB-2025 at 01:28 PM'),
    ).toBe('13:28');
    expect(
      findTime('Rs.215.00 debited from your Kotak Bank AC X3344 on 01-10-26.'),
    ).toBeUndefined();
  });
});

describe('balance-enquiry replies (U-11)', () => {
  it('reads the balance even with words in between', () => {
    for (const [s, amt, l4] of [
      [
        'Available Bal in HDFC Bank A/c XX4521 as on yesterday:06-OCT-26 INR 2,71,534.00. Cheques are subject to clearing',
        27153400,
        '4521',
      ],
      ['Your A/c XX3344 balance is Rs.2,73,346.00 as on 06-10-26 10:42', 27334600, '3344'],
      [
        'Dear Customer, the Available Balance in your Account XX4521 is INR 1,23,456.78 as on 06-Oct-26',
        12345678,
        '4521',
      ],
    ] as const) {
      const p = parseSms(s);
      expect(p, s).toMatchObject({
        kind: 'ignore',
        reason: 'Balance update',
        balance: amt,
        last4: l4,
      });
    }
  });
});

/** H-15 / PARSER_VERSION 8: our own variants of the formats the corpus found missing. */
describe('H-15: more Indian bank formats', () => {
  const p = (m: string) => parseSms(m);
  it('short Dr/Cr forms', () => {
    expect(p('Dr INR 4,250.00 from A/c X9012 on 03-OCT-2026')).toMatchObject({
      kind: 'debit',
      amount: 425000,
    });
    expect(p('Cr INR 1,500.00 to A/c X9012 04-OCT-2026')).toMatchObject({
      kind: 'credit',
      amount: 150000,
    });
    expect(
      p('Rs.65.00 Dr. from A/c XX445566 on 02-10-2026. AvlBal:Rs902.10. Ref:61234567890'),
    ).toMatchObject({ kind: 'debit', amount: 6500, last4: '5566' });
    expect(
      p(
        'Acct XXX654 Dr. INR 310.00 on 05/10/26 to TEA POINT; UPI: 612345678901; Bal INR 7,100.00.',
      ),
    ).toMatchObject({ kind: 'debit', amount: 31000, ref: '612345678901' });
  });
  it('"UPI debit:", "DEBIT:Rs.", "UPI Credit:"', () => {
    expect(
      p('UPI debit:Rs.420.00 A/c X8811, 05-10-26 11:05:09 RRN: 612233445566 Bal:Rs.9,000.00'),
    ).toMatchObject({ kind: 'debit', amount: 42000 });
    expect(p('A/c X8811 DEBIT:Rs.212.50 BAKE HOUSE Bal:Rs.8,787.50')).toMatchObject({
      kind: 'debit',
      amount: 21250,
    });
    expect(
      p(
        'UPI Credit:INR Rs.2500.00 in A/c X8811. Info: UPI/ABCD/612345000111/ Some Payer on 06-10-26 09:00:00. Final balance is Rs.11287.50',
      ),
    ).toMatchObject({ kind: 'credit', amount: 250000, ref: '612345000111' });
  });
  it('NEFT/RTGS "credit of", "CREDIT with amount", SBI "has credit for", "has a debit by transfer"', () => {
    expect(
      p(
        'Dear Customer, there is an NEFT credit of INR 61,200.00 in your account 321xxxx9988 on 1/10/2026.Available Balance:INR 80,000.00',
      ),
    ).toMatchObject({ kind: 'credit', amount: 6120000 });
    expect(
      p(
        'Account No. XXXXXXXX9988 CREDIT with amount Rs. 4200.00 on 01-10-2026. Balance: Rs.12000.00.',
      ),
    ).toMatchObject({ kind: 'credit', amount: 420000 });
    expect(
      p(
        'Your A/C XXXXX778899 has credit for BY SALARY of Rs 52,000.00 on 30/09/26. Avl Bal Rs 60,100.00.-SBI',
      ),
    ).toMatchObject({ kind: 'credit', amount: 5200000 });
    expect(
      p(
        'Dear Customer, Your A/C XXXXX778899 has a debit by transfer of Rs 150.00 on 02/10/26. Avl Bal Rs 59,950.00.-SBI',
      ),
    ).toMatchObject({ kind: 'debit', amount: 15000 });
    expect(
      p(
        'Hi,Rs.2300credited in your A/c XX7788 on 02OCT2026 10:01:00 using cash deposit machine. Current Bal: Rs.5000.00',
      ),
    ).toMatchObject({ kind: 'credit', amount: 230000 });
  });
  it('"Rs..50" is fifty paise, not the balance', () => {
    expect(p('Rs..75 debited from A/c XX4410 by Transfer. Avl Bal Rs.1,204.33')).toMatchObject({
      kind: 'debit',
      amount: 75,
    });
  });
  it('Amazon Pay balance via Juspay is a wallet payment', () => {
    expect(
      p(
        'Payment of Rs 640.00 using Apay Balance successful at Grocer. Updated Balance is Rs 360.00 - SMS by Juspay',
      ),
    ).toMatchObject({
      kind: 'debit',
      amount: 64000,
      walletName: 'Amazon Pay',
      instrument: 'wallet',
    });
  });
  it('foreign currency spend waits for the ₹ amount', () => {
    const r = p(
      'USD 12.50 spent using ICICI Bank Card XX6612 on 04-Oct-26 on SOFTWARE CO. Avl Limit: INR 1,20,000.00.',
    );
    expect(r).toMatchObject({
      kind: 'debit',
      last4: '6612',
      foreign: { currency: 'USD', amount: 1250 },
    });
    expect(r.amount).toBeUndefined();
  });
  it('maths-letter text (SBI Card) reads normally', () => {
    expect(
      p('Rs.120.00 𝗌𝗉𝖾𝗇𝗍 𝗈𝗇 𝗒𝗈𝗎𝗋 𝖲𝖡𝖨 𝖢𝗋𝖾𝖽𝗂𝗍 𝖢𝖺𝗋𝖽 𝖾𝗇𝖽𝗂𝗇𝗀 4411 at CAFE on 03/10/26'),
    ).toMatchObject({ kind: 'debit', amount: 12000, last4: '4411' });
  });
  it('direction traps: "X has received … from your A/c", "credited to the beneficiary" are money out', () => {
    expect(
      p('Acme Fund has received Rs 2000.00 from your A/c 4455 via NEFT on 02-Oct-2026 10:00:00.'),
    ).toMatchObject({ kind: 'debit', amount: 200000 });
    expect(
      p(
        'NEFT Transaction with reference number N1234567 for Rs. 9000.00 has been credited to the beneficiary account on 02-Oct-26.',
      ),
    ).toMatchObject({ kind: 'debit', amount: 900000 });
  });
  it('interest paid on a deposit is money in', () => {
    expect(
      p('Net interest INR 120.40 paid on your Deposit No 400***112233 on 30/09/26.'),
    ).toMatchObject({ kind: 'credit', amount: 12040 });
  });
  it('blocked IPO money, vouchers and mandates received for processing are not payments', () => {
    expect(
      p(
        'Your ASBA application for XYZ is received and Application value of Rs 15000 is blocked in your bank account on 01/10/2026.',
      ).kind,
    ).toBe('ignore');
    expect(
      p('You have received a Shopping E-voucher Rs.250/- from Rewards programme. Code ABCD').kind,
    ).toBe('ignore');
    expect(
      p(
        'Auto Pay NACH Mandate : Rs. 50000.00 UMRN:ABCD123 To:Some Fund Freq ADHO received today for processing.',
      ).kind,
    ).toBe('autopay_notice');
  });
  it('autopay set-up with a first charge: the charge is the amount', () => {
    expect(
      p(
        'Dear Customer, auto pay facility has been successfully activated on your Card XX1122 for Rs. 50000.00, from Cloud Co. An initial amount of Rs. 1.00 has been debited from your account.',
      ),
    ).toMatchObject({ kind: 'debit', amount: 100 });
  });
  it('"used at", "Thank you for using … Card", "transaction number … for Rs", "refunded to your card"', () => {
    expect(
      p('Your HSBC creditcard xxxxx9911 used at SHOPCO for INR 210.00 on 01-10-26.'),
    ).toMatchObject({ kind: 'debit', amount: 21000 });
    expect(
      p('Thank you for using HSBC Debit Card XXXXX88xx at STORE . for INR 75.00 on 01-10-26.'),
    ).toMatchObject({ kind: 'debit', amount: 7500 });
    expect(
      p(
        'Dear Customer, transaction number 9876 for Rs.240.00 by SBI Debit Card 1234 done at shop on 01Oct26 at 10:00:00. Your updated available balance is Rs.900.00',
      ),
    ).toMatchObject({ kind: 'debit', amount: 24000 });
    expect(
      p('INR 40 from Lounge refunded to your Kotak Credit Card x7711 on 01-Oct-2026.'),
    ).toMatchObject({ kind: 'credit', amount: 4000, isRefund: true });
  });
  it('payment gateways: "Payment Successful! Rs …", "Payment INR … confirmed"', () => {
    expect(
      p('Payment Successful! Rs. 1500.00 from A/c ****7788 to SOMECO via NetBanking.'),
    ).toMatchObject({ kind: 'debit', amount: 150000 });
    expect(
      p('Payment INR 99.00 (ID:123456) confirmed for order #A1 on ShopApp. Powered by Gateway'),
    ).toMatchObject({ kind: 'debit', amount: 9900 });
  });
});
