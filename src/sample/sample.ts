import {
  addDays,
  addMonths,
  addMonthsYM,
  daysInMonth,
  monthOf,
  parseDate,
  ymd,
} from '../domain/dates';
import { periodClosingIn } from '../domain/cycle';

import { balanceOf } from '../domain/ledger';
import type {
  Account,
  Debt,
  PaymentMode,
  Subscription,
  Transaction,
  TxnKind,
} from '../domain/types';

/**
 * Example data for the design preview: about four months of a typical salaried person in India.
 * Deterministic (seeded), and always relative to `today` so the screens look current.
 * Clearly marked as sample data in the UI.
 */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ts = '2026-01-01T00:00:00.000Z';
const base = { archived: false, createdAt: ts, updatedAt: ts };

export function sampleData(today: ISODateLike) {
  const [ty, tm] = parseDate(today);
  const [sy, sm] = addMonthsYM(ty, tm, -4);
  const start = ymd(sy, sm, 1);

  const accounts: Account[] = [
    {
      ...base,
      id: 'hdfc',
      name: 'HDFC Savings',
      kind: 'bank',
      institution: 'HDFC Bank',
      last4: '4521',
      upiIds: ['you@okhdfc'],
      openingBalance: 1_45_000_00,
      openingDate: start,
      sortOrder: 0,
    },
    {
      ...base,
      id: 'sbi',
      name: 'SBI Salary',
      kind: 'bank',
      institution: 'State Bank of India',
      last4: '0917',
      openingBalance: 38_000_00,
      openingDate: start,
      sortOrder: 1,
    },
    {
      ...base,
      id: 'cash',
      name: 'Cash',
      kind: 'cash',
      openingBalance: 4_000_00,
      openingDate: start,
      sortOrder: 2,
    },
    {
      ...base,
      id: 'lite',
      name: 'UPI Lite',
      kind: 'wallet',
      openingBalance: 1_200_00,
      openingDate: start,
      sortOrder: 3,
    },
    {
      ...base,
      id: 'regalia',
      name: 'HDFC Regalia',
      kind: 'credit_card',
      institution: 'HDFC Bank',
      last4: '8834',
      openingBalance: 0,
      openingDate: start,
      sortOrder: 4,
      card: {
        statementDay: 15,
        dueDaysAfterStatement: 20,
        creditLimit: 3_00_000_00,
        network: 'visa',
        paymentAccountId: 'hdfc',
      },
    },
    {
      ...base,
      id: 'rupay',
      name: 'Axis RuPay',
      kind: 'credit_card',
      institution: 'Axis Bank',
      last4: '2210',
      openingBalance: 0,
      openingDate: start,
      sortOrder: 5,
      card: {
        statementDay: 3,
        dueDaysAfterStatement: 18,
        creditLimit: 1_20_000_00,
        network: 'rupay',
        paymentAccountId: 'sbi',
      },
    },
  ];

  const r = rng(7);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  const amt = (lo: number, hi: number, step = 10) =>
    Math.round((lo + r() * (hi - lo)) / step) * step * 100;
  const txns: Transaction[] = [];
  let id = 0;
  const add = (
    kind: TxnKind,
    date: string,
    amount: number,
    accountId: string,
    extra: Partial<Transaction> = {},
  ) => {
    txns.push({
      ...base,
      id: `s${++id}`,
      kind,
      date,
      amount,
      accountId,
      tags: [],
      source: 'manual',
      status: 'confirmed',
      ...extra,
    });
  };

  const food = [
    'Swiggy',
    'Zomato',
    'Chai Point',
    'Meghana Foods',
    'Third Wave Coffee',
    'Udupi canteen',
  ];
  const shops = ['Amazon', 'Myntra', 'Decathlon', 'Croma', 'IKEA'];
  const rides = ['Uber', 'Ola', 'Rapido', 'Namma Metro'];

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const [y, m, dd] = parseDate(d);
    const dow = new Date(y, m - 1, dd).getDay();
    if (dd === 1)
      add('income', d, 1_15_000_00, 'sbi', { categoryId: 'salary', merchant: 'Employer payroll' });
    if (dd === 2)
      add('transfer', d, 60_000_00, 'sbi', { toAccountId: 'hdfc', note: 'Move salary to savings' });
    if (dd === 5)
      add('expense', d, 28_000_00, 'hdfc', {
        categoryId: 'rent',
        merchant: 'Landlord',
        paymentMode: 'netbanking',
      });
    if (dd === 9)
      add('expense', d, amt(1400, 2600), 'regalia', {
        categoryId: 'bills',
        merchant: 'BESCOM',
        paymentMode: 'card',
      });
    if (dd === 14)
      add('transfer', d, 5_000_00, 'hdfc', {
        toAccountId: 'cash',
        paymentMode: 'other',
        note: 'ATM withdrawal',
      });
    if (dow === 1)
      add('transfer', d, 2_000_00, 'hdfc', { toAccountId: 'lite', note: 'UPI Lite top-up' });
    if (dow === 6)
      add('expense', d, amt(1800, 3800), 'regalia', {
        categoryId: 'groceries',
        merchant: pick(['BigBasket', 'DMart', 'Zepto']),
        paymentMode: 'card',
      });
    if (dow === 3 && r() < 0.7)
      add('expense', d, amt(250, 900), 'rupay', {
        categoryId: 'groceries',
        merchant: 'Zepto',
        paymentMode: 'upi',
      });

    if (r() < 0.6) {
      const via = r();
      const [acc, mode]: [string, PaymentMode] =
        via < 0.35
          ? ['lite', 'upi']
          : via < 0.55
            ? ['cash', 'cash']
            : via < 0.8
              ? ['rupay', 'upi']
              : ['regalia', 'card'];
      add('expense', d, amt(120, 750), acc, {
        categoryId: 'food',
        merchant: pick(food),
        paymentMode: mode,
      });
    }
    if (r() < 0.45)
      add('expense', d, amt(40, 420), r() < 0.6 ? 'lite' : 'cash', {
        categoryId: 'transport',
        merchant: pick(rides),
        paymentMode: 'upi',
      });
    if (r() < 0.07)
      add('expense', d, amt(900, 7500, 50), pick(['regalia', 'rupay']), {
        categoryId: 'shopping',
        merchant: pick(shops),
        paymentMode: 'card',
      });
    if ((dow === 5 || dow === 0) && r() < 0.3)
      add('expense', d, amt(450, 1800), 'regalia', {
        categoryId: 'entertainment',
        merchant: pick(['PVR INOX', 'BookMyShow', 'Toit']),
        paymentMode: 'card',
      });
    if (r() < 0.035)
      add('expense', d, amt(300, 2200), 'hdfc', {
        categoryId: 'health',
        merchant: pick(['Apollo Pharmacy', 'Practo']),
        paymentMode: 'upi',
      });
    if (r() < 0.015)
      add('refund', d, amt(300, 1500), 'regalia', {
        categoryId: 'shopping',
        merchant: 'Amazon',
        note: 'Return refund',
      });
  }

  // Monthly subscriptions in the past, and their next dates.
  const subDefs = [
    { id: 'netflix', name: 'Netflix', amount: 649_00, day: 8, accountId: 'regalia' },
    { id: 'spotify', name: 'Spotify', amount: 119_00, day: 20, accountId: 'rupay' },
    { id: 'jio', name: 'Jio recharge', amount: 349_00, day: 25, accountId: 'hdfc' },
    { id: 'gym', name: 'Cult.fit', amount: 1_499_00, day: 3, accountId: 'regalia' },
  ];
  const subscriptions: Subscription[] = [];
  for (const s of subDefs) {
    let next = '';
    for (let k = 0; k <= 5; k++) {
      const [y, m] = addMonthsYM(sy, sm, k);
      const d = ymd(y, m, Math.min(s.day, daysInMonth(y, m)));
      if (d < start) continue;
      if (d <= today)
        add('expense', d, s.amount, s.accountId, {
          categoryId: 'subscriptions',
          merchant: s.name,
          subscriptionId: s.id,
          source: 'subscription',
          paymentMode: 'auto_debit',
        });
      else if (!next) next = d;
    }
    subscriptions.push({
      ...base,
      id: s.id,
      name: s.name,
      amount: s.amount,
      frequency: 'monthly',
      nextDate: next,
      accountId: s.accountId,
      categoryId: 'subscriptions',
      autoPay: true,
      active: true,
    });
  }
  subscriptions.push({
    ...base,
    id: 'icloud',
    name: 'Google One',
    amount: 1_300_00,
    frequency: 'yearly',
    nextDate: addDays(today, 41),
    accountId: 'rupay',
    categoryId: 'subscriptions',
    autoPay: false,
    active: true,
  });

  // Pay each closed statement in full ~10 days after it is generated (if that date has passed).
  for (const card of accounts.filter((a) => a.card)) {
    let month = monthOf(start);
    while (month <= monthOf(today)) {
      const p = periodClosingIn(card.card!, month);
      const payDay = addDays(p.end, 10);
      if (p.end >= start && payDay <= today) {
        const due = balanceOf(card, txns, p.end);
        if (due > 0)
          add('transfer', payDay, due, card.card!.paymentAccountId!, {
            toAccountId: card.id,
            note: `${card.name} bill`,
            paymentMode: 'netbanking',
          });
      }
      month = addMonths(month, 1);
    }
  }

  // Money lent and borrowed.
  const debts: Debt[] = [
    { ...base, id: 'debt-rahul', person: 'Rahul', direction: 'lent' },
    { ...base, id: 'debt-priya', person: 'Priya', direction: 'borrowed' },
    { ...base, id: 'debt-amit', person: 'Amit', direction: 'lent', settledAt: addDays(today, -40) },
  ];
  add('debt', addDays(today, -25), 3_000_00, 'hdfc', {
    flow: 'out',
    debtId: 'debt-rahul',
    note: 'Lent to Rahul',
    paymentMode: 'upi',
  });
  add('debt', addDays(today, -6), 1_000_00, 'hdfc', {
    flow: 'in',
    debtId: 'debt-rahul',
    note: 'Rahul paid back',
    paymentMode: 'upi',
  });
  add('debt', addDays(today, -12), 1_800_00, 'cash', {
    flow: 'in',
    debtId: 'debt-priya',
    note: 'Borrowed from Priya (trip)',
  });
  add('debt', addDays(today, -70), 2_500_00, 'hdfc', {
    flow: 'out',
    debtId: 'debt-amit',
    note: 'Lent to Amit',
    paymentMode: 'upi',
  });
  add('debt', addDays(today, -40), 2_500_00, 'hdfc', {
    flow: 'in',
    debtId: 'debt-amit',
    note: 'Amit paid back',
    paymentMode: 'upi',
  });

  txns.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
  return { accounts, transactions: txns, subscriptions, debts };
}

type ISODateLike = string;

/** Example bank messages shown in the Inbox when exploring with sample data. */
export function sampleMessages(today: string): string {
  const d = (n: number) => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    const dd = String(t.getUTCDate()).padStart(2, '0');
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${String(t.getUTCFullYear()).slice(2)}`;
  };
  return [
    `Sent Rs.180.00\nFrom HDFC Bank A/C *4521\nTo BLUE TOKAI COFFEE\nOn ${d(0)}\nRef 427100011122\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808`,
    `Spent Rs.2,340 On HDFC Bank Card 8834 At DECATHLON On ${d(1)}.Not You? To Block+Reissue Call 18002586161`,
    `INR 1,250.00 spent using ICICI Bank Card XX5566 on ${d(1)} on MAKEMYTRIP. Avl Limit: INR 98,750.00.`,
    `123456 is your OTP for txn of Rs.2,340 at DECATHLON on HDFC Bank card 8834. Valid for 5 mins. Do not share.`,
    `Dear Customer, Rs.649.00 will be debited from your HDFC Bank Card 8834 on ${d(-6)} towards NETFLIX as per standing instruction.`,
  ].join('\n\n');
}
