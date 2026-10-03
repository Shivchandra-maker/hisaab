import { findDate, parseSms, splitMessages } from './parse';

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
