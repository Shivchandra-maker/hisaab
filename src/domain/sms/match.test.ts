import { account, txn } from '../testkit';
import type { MerchantRule } from '../types';
import { guessCategory, merchantKey } from './categorize';
import { accountHintKey, suggest } from './match';
import { parseSms } from './parse';

const hdfc = account({ id: 'hdfc', kind: 'bank', last4: '4521', institution: 'HDFC Bank' });
const cash = account({ id: 'cash', kind: 'cash' });
const lite = account({ id: 'lite', kind: 'wallet', name: 'UPI Lite' });
const card = account({
  id: 'regalia',
  kind: 'credit_card',
  last4: '8834',
  institution: 'HDFC Bank',
  card: {
    statementDay: 15,
    dueDaysAfterStatement: 20,
    creditLimit: 3_00_000_00,
    paymentAccountId: 'hdfc',
  },
});
const accounts = [hdfc, cash, lite, card];
const ctx = { accounts, rules: [] as MerchantRule[], transactions: [], receivedAt: '2026-10-02' };

describe('suggestions from SMS', () => {
  it('UPI spend → expense on the matching bank account, food', () => {
    const s = suggest(
      parseSms(
        'Sent Rs.250.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 28/09/26\nRef 426712345678',
      ),
      ctx,
    );
    expect(s).toMatchObject({
      kind: 'expense',
      accountId: 'hdfc',
      categoryId: 'food',
      accountMatch: 'last4',
      ready: true,
      externalRef: '426712345678',
    });
  });

  it('card spend → expense on the card', () => {
    const s = suggest(
      parseSms('Spent Rs.1,499 On HDFC Bank Card 8834 At CULT FIT On 2026-09-28'),
      ctx,
    );
    expect(s).toMatchObject({
      kind: 'expense',
      accountId: 'regalia',
      categoryId: 'health',
      paymentMode: 'card',
    });
  });

  it('ATM withdrawal → transfer to cash, not spending', () => {
    const s = suggest(parseSms('Rs.5000 withdrawn from A/c XX4521 at ATM on 14-09-26.'), ctx);
    expect(s).toMatchObject({
      kind: 'transfer',
      accountId: 'hdfc',
      toAccountId: 'cash',
      ready: true,
    });
  });

  it('card "payment received" → transfer from the paying bank to the card', () => {
    const s = suggest(
      parseSms(
        'Payment of Rs 22,028.00 has been received on your HDFC Bank Credit Card ending 8834 on 25-09-2026.',
      ),
      ctx,
    );
    expect(s).toMatchObject({
      kind: 'transfer',
      accountId: 'hdfc',
      toAccountId: 'regalia',
      ready: true,
    });
  });

  it('bank debit for the card bill pairs with the card-side message as a duplicate', () => {
    const existing = txn({
      id: 'p1',
      kind: 'transfer',
      date: '2026-09-25',
      amount: 2202800,
      accountId: 'hdfc',
      toAccountId: 'regalia',
    });
    const s = suggest(
      parseSms(
        'Rs 22,028.00 debited from A/c XX4521 on 25-09-26 towards HDFC Credit Card bill payment.',
      ),
      { ...ctx, transactions: [existing] },
    );
    expect(s.kind).toBe('transfer');
    expect(s.duplicateOf?.id).toBe('p1');
    expect(s.ready).toBe(false);
  });

  it('refund → refund on the card', () => {
    const s = suggest(
      parseSms('Refund of Rs.470.00 from AMAZON credited to your HDFC Bank Card 8834 on 30-09-26.'),
      ctx,
    );
    expect(s).toMatchObject({ kind: 'refund', accountId: 'regalia', categoryId: 'shopping' });
  });

  it('salary → income, salary category', () => {
    const s = suggest(
      parseSms(
        'INR 1,15,000.00 deposited in HDFC Bank A/c XX4521 on 01-OCT-26 for NEFT Cr-EMPLOYER TECH PVT LTD SALARY.',
      ),
      ctx,
    );
    expect(s).toMatchObject({ kind: 'income', accountId: 'hdfc', categoryId: 'salary' });
  });

  it('unknown card → not ready, offers to create the account', () => {
    const s = suggest(
      parseSms('INR 2,310.00 spent using ICICI Bank Card XX1234 on 28-Sep-26 on BIGBASKET.'),
      ctx,
    );
    expect(s).toMatchObject({ unknownLast4: '1234', ready: false, categoryId: 'groceries' });
    expect(s.accountId).toBeUndefined();
  });

  it('flags a duplicate by bank reference', () => {
    const existing = txn({
      kind: 'expense',
      date: '2026-09-28',
      amount: 25000,
      accountId: 'hdfc',
      externalRef: '426712345678',
    });
    const s = suggest(
      parseSms(
        'Sent Rs.250.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 28/09/26\nRef 426712345678',
      ),
      { ...ctx, transactions: [existing] },
    );
    expect(s.duplicateReason).toBe('Same bank reference');
  });

  it('your rules beat built-in guesses and rename the merchant', () => {
    const rule: MerchantRule = {
      id: 'r',
      key: 'swiggy',
      name: 'Swiggy (office lunch)',
      categoryId: 'work',
      hits: 3,
      createdAt: '',
      updatedAt: '',
    };
    const s = suggest(
      parseSms('Sent Rs.250.00\nFrom HDFC Bank A/C *4521\nTo SWIGGY\nOn 28/09/26'),
      { ...ctx, rules: [rule] },
    );
    expect(s).toMatchObject({
      categoryId: 'work',
      merchant: 'Swiggy (office lunch)',
      categorySource: 'rule',
    });
  });
});

describe('merchant keys and built-in categories', () => {
  it('normalises noise', () => {
    expect(merchantKey('SWIGGY*ORDER 12345678')).toBe('swiggyorder');
    expect(merchantKey('Bigbasket Pvt Ltd')).toBe('bigbasket');
    expect(merchantKey('swiggy@icici')).toBe('swiggy');
  });

  it('does not match short names inside unrelated words', () => {
    expect(guessCategory('Vijay Kumar', []).categoryId).toBeUndefined();
    expect(guessCategory('Ola', []).categoryId).toBe('transport');
    expect(guessCategory('Jio Recharge', []).categoryId).toBe('bills');
  });
});

describe('wallets, remembered accounts and Miscellaneous', () => {
  const phonepe = account({ id: 'phonepe', kind: 'wallet', name: 'PhonePe Wallet' });
  const wctx = { ...ctx, accounts: [hdfc, cash, phonepe, card] };

  it('bank auto top-up of the PhonePe wallet is a transfer, not spending', () => {
    const p = parseSms(
      'Rs.500.00 debited from A/c XX4521 on 01-10-26 towards PhonePe Wallet auto top-up mandate. UPI Ref 427812345678.',
    );
    const s = suggest(p, wctx);
    expect(s).toMatchObject({ kind: 'transfer', accountId: 'hdfc', toAccountId: 'phonepe' });
  });

  it('wallet-side "added to your PhonePe wallet" is the same transfer', () => {
    const p = parseSms(
      'Rs.500 added to your PhonePe Wallet via Auto Top-up from HDFC Bank A/c XX4521. Wallet balance Rs.612.',
    );
    expect(p.isWalletTopUp).toBe(true);
    const s = suggest(p, wctx);
    expect(s).toMatchObject({ kind: 'transfer', accountId: 'hdfc', toAccountId: 'phonepe' });
  });

  it('payment from the wallet keeps the payee and uses the wallet account', () => {
    const p = parseSms(
      'Paid Rs.40 to RAJU TEA STALL from your PhonePe Wallet. Txn ID T2410011234567. Wallet balance Rs.572.',
    );
    expect(p).toMatchObject({
      kind: 'debit',
      instrument: 'wallet',
      walletName: 'PhonePe',
      merchant: 'Raju Tea Stall',
    });
    const s = suggest(p, wctx);
    expect(s).toMatchObject({
      kind: 'expense',
      accountId: 'phonepe',
      accountMatch: 'wallet',
      categoryId: 'other',
      categorySource: 'fallback',
    });
  });

  it('remembers the account you chose for messages that do not name one', () => {
    const p = parseSms(
      'Rs.250 debited for UPI payment to SHARMA STORES. UPI Ref 427800001111. -Federal Bank',
    );
    const hdfc2 = account({ id: 'fed', kind: 'bank', institution: 'Other Bank' });
    const two = { ...ctx, accounts: [hdfc, hdfc2] };
    expect(suggest(p, two).accountId).toBeUndefined();
    const s = suggest(p, { ...two, accountHints: { [accountHintKey(p)]: 'fed' } });
    expect(s).toMatchObject({ accountId: 'fed', accountMatch: 'remembered' });
  });

  it('unknown merchants fall back to Miscellaneous', () => {
    const s = suggest(
      parseSms('Sent Rs.75.00\nFrom HDFC Bank A/C *4521\nTo ZXQ VENTURES\nOn 28/09/26'),
      ctx,
    );
    expect(s).toMatchObject({ categoryId: 'other', categorySource: 'fallback', ready: true });
  });
});
