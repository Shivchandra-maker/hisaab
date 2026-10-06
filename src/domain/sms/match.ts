import { daysBetween } from '../dates';
import { cardSnapshot, counted } from '../ledger';
import type {
  Account,
  ID,
  ISODate,
  MerchantRule,
  PaymentMode,
  Transaction,
  TxnKind,
} from '../types';
import { guessCategory, guessIncomeCategory, merchantKey } from './categorize';
import type { ParsedSms } from './parse';

/**
 * Turns a parsed message into a suggested transaction: which account, which kind, which
 * category, and whether it looks like something already recorded.
 */

export interface Suggestion {
  kind: TxnKind;
  amount: number;
  date: ISODate;
  accountId?: ID;
  toAccountId?: ID;
  categoryId?: ID;
  merchant?: string;
  paymentMode?: PaymentMode;
  externalRef?: string;
  /** How the account was chosen, shown to the user. */
  accountMatch: 'last4' | 'bank-name' | 'only-one' | 'upi-lite' | 'wallet' | 'remembered' | 'none';
  /** `fallback` = nothing known about the merchant, so Miscellaneous. */
  categorySource: 'rule' | 'built-in' | 'wording' | 'fallback' | 'none';
  /** Existing transaction this probably duplicates. */
  duplicateOf?: Transaction;
  duplicateReason?: string;
  /** Last 4 digits we couldn't match, so the UI can offer "Create account". */
  unknownLast4?: string;
  /** Ready to add without edits: account known, not a duplicate. */
  ready: boolean;
  /** Paid to / received from a person (not a shop): may be a loan, so we ask once. */
  person?: string;
  /**
   * `duplicateOf` is the other side of a move between your own accounts (one bank's debit, the
   * other's credit): that transaction becomes this transfer instead of spending or income.
   */
  pairTransfer?: { accountId: ID; toAccountId: ID };
  /** The message is dated after it arrived: never added on its own. */
  datedAhead?: boolean;
}

interface Ctx {
  accounts: Account[];
  rules: MerchantRule[];
  transactions: Transaction[];
  receivedAt: ISODate;
  /** Accounts you picked before for messages that don't name one (see accountHintKey). */
  accountHints?: Record<string, ID>;
}

/** Category used when nothing is known about the merchant. */
export const FALLBACK_CATEGORY = 'other';

/**
 * Key under which your account choice is remembered for messages like this one:
 * the digits if the message has them, otherwise the wallet/bank and how you paid.
 */
export function accountHintKey(p: ParsedSms): string {
  if (p.last4) return `last4:${p.last4}`;
  return `via:${(p.walletName ?? p.bank ?? 'unknown').toLowerCase()}|${p.instrument}`;
}

function walletFor(p: ParsedSms, live: Account[]): Account | undefined {
  const wallets = live.filter((a) => a.kind === 'wallet');
  if (p.walletName) {
    const w = p.walletName.toLowerCase().replace(/\s+/g, '');
    const named = wallets.find((a) =>
      `${a.name} ${a.institution ?? ''}`.toLowerCase().replace(/\s+/g, '').includes(w),
    );
    if (named) return named;
  }
  const nonLite = wallets.filter((a) => !/lite/i.test(a.name));
  return nonLite.length === 1 ? nonLite[0] : wallets.length === 1 ? wallets[0] : undefined;
}

function findAccount(
  p: ParsedSms,
  accounts: Account[],
  hints: Record<string, ID> = {},
): { account?: Account; how: Suggestion['accountMatch'] } {
  const live = accounts.filter((a) => !a.deletedAt);
  const hinted = hints[accountHintKey(p)];
  const remembered = hinted ? live.find((a) => a.id === hinted) : undefined;
  if (p.instrument === 'wallet' && !p.isWalletTopUp) {
    const w = remembered ?? walletFor(p, live);
    if (w) return { account: w, how: remembered ? 'remembered' : 'wallet' };
  }
  if (p.instrument === 'upi_lite') {
    const lite =
      live.find((a) => a.kind === 'wallet' && /lite/i.test(a.name)) ??
      live.find((a) => a.kind === 'wallet');
    if (lite) return { account: lite, how: 'upi-lite' };
  }
  if (p.last4) {
    const byLast4 = live.filter((a) => a.last4 === p.last4);
    const preferCard = p.instrument === 'credit_card' || p.kind === 'card_payment';
    const best =
      byLast4.find((a) => (preferCard ? a.kind === 'credit_card' : a.kind !== 'credit_card')) ??
      byLast4[0];
    if (best) return { account: best, how: 'last4' };
    if (remembered) return { account: remembered, how: 'remembered' };
    return { how: 'none' };
  }
  if (remembered) return { account: remembered, how: 'remembered' };
  if (p.bank) {
    const kindWanted = p.instrument === 'credit_card' ? 'credit_card' : 'bank';
    const byBank = live.filter(
      (a) =>
        a.kind === kindWanted &&
        (a.institution ?? a.name).toLowerCase().includes(p.bank!.split(' ')[0]!.toLowerCase()),
    );
    if (byBank.length === 1) return { account: byBank[0], how: 'bank-name' };
  }
  const banks = live.filter((a) => a.kind === 'bank' && !a.archived);
  if (!p.last4 && p.instrument !== 'credit_card' && banks.length === 1)
    return { account: banks[0], how: 'only-one' };
  return { how: 'none' };
}

const BUSINESS =
  /\b(store|stores|mart|traders?|enterprises?|services?|pvt|ltd|limited|llp|hotel|restaurant|cafe|caf[eé]|medical|medicals|pharma|pharmacy|chemist|kirana|general|bakery|bakers|foods?|sweets|petrol|fuel|filling|station|motors|garage|hospital|clinic|labs?|diagnostics|school|college|academy|salon|parlour|parlor|studio|fitness|gym|centre|center|shop|bazaar|bazar|super|market|agency|agencies|travels?|tours|electricals?|electronics|mobiles?|hardware|textiles?|fashions?|jewell?ers?|dhaba|bhavan|bhawan|corner|point|house|co\.?|company|india|tech|technologies|solutions|retail|wines|liquor|tea|chai|juice|canteen|mess)\b/i;

/**
 * Looks like a payment to or from a person rather than a shop: a phone-number UPI ID, or a plain
 * two- or three-word name we know nothing about.
 */
export function personName(p: ParsedSms, known: boolean): string | undefined {
  if (known || p.isWalletTopUp || p.isCardBillPayment || p.isAtm || p.kind === 'card_payment')
    return undefined;
  // Money in from people comes by UPI; salaries and refunds arrive by NEFT/IMPS from companies.
  if (p.kind === 'credit' && (p.isRefund || p.isCashback || (p.mode !== 'upi' && !p.vpa)))
    return undefined;
  const local = p.vpa?.split('@')[0] ?? '';
  const phoneVpa = /^(\+?91)?[6-9]\d{9}$/.test(local);
  const name = p.merchant?.trim();
  const nameLike =
    !!name &&
    /^[a-z][a-z.]+(?: [a-z][a-z.]*){1,3}$/i.test(name) &&
    !BUSINESS.test(name) &&
    !/\d/.test(name);
  if (nameLike) return name;
  if (phoneVpa) return name || local;
  return undefined;
}

/** Same money already recorded? Matches on reference first, then amount + account + date window. */
/** The account a message is about (for balance updates and checks), or undefined. */
export function accountForMessage(
  p: ParsedSms,
  accounts: Account[],
  hints: Record<string, ID> = {},
): Account | undefined {
  return findAccount(p, accounts, hints).account;
}

export function findDuplicate(
  s: Pick<Suggestion, 'amount' | 'date' | 'accountId' | 'toAccountId' | 'externalRef' | 'kind'>,
  transactions: Transaction[],
): { txn: Transaction; reason: string } | undefined {
  for (const t of transactions) {
    if (!counted(t)) continue;
    if (s.externalRef && t.externalRef && t.externalRef === s.externalRef)
      return { txn: t, reason: 'Same bank reference' };
  }
  for (const t of transactions) {
    if (!counted(t) || t.amount !== s.amount) continue;
    if (Math.abs(daysBetween(t.date, s.date)) > (s.kind === 'transfer' ? 3 : 1)) continue;
    const accounts = [t.accountId, t.toAccountId].filter(Boolean);
    const mine = [s.accountId, s.toAccountId].filter(Boolean);
    // A card payment shows up twice: the bank's debit and the card's "payment received".
    if (s.kind === 'transfer' && t.kind === 'transfer' && mine.some((a) => accounts.includes(a)))
      return { txn: t, reason: 'Same card payment from the other side' };
    // Only compare against things you typed in: two different messages for the same amount on
    // the same day (two ₹40 teas) are two real payments. Repeats of the *same* message are
    // already caught by its text hash and bank reference.
    if (
      s.accountId &&
      t.accountId === s.accountId &&
      t.kind === s.kind &&
      t.source !== 'sms' &&
      t.source !== 'notification'
    )
      return { txn: t, reason: 'Same amount, account and date' };
    // A loan you typed in, then its bank SMS: same money, already recorded as lent/borrowed.
    if (
      t.kind === 'debt' &&
      s.accountId &&
      t.accountId === s.accountId &&
      t.source !== 'sms' &&
      t.source !== 'notification' &&
      ((s.kind === 'expense' && t.flow === 'out') ||
        ((s.kind === 'income' || s.kind === 'refund') && t.flow === 'in'))
    )
      return { txn: t, reason: 'Already recorded in Lent & borrowed' };
  }
  return undefined;
}

/** Accounts money moves between (not cards, not cash). */
const movable = (a?: Account) => !!a && (a.kind === 'bank' || a.kind === 'wallet');

/** Below this, a same-amount debit and credit on two accounts is too likely a coincidence. */
export const TRANSFER_PAIR_MIN = 100_000;

/**
 * The other side of a move between your own accounts, already recorded as spending or income:
 * same amount, a day apart at most, one account's debit and another's credit. Messages that say
 * "to self" or name your other account match at any amount; otherwise from ₹1,000 up.
 */
export function findTransferPair(
  s: Pick<Suggestion, 'kind' | 'amount' | 'date' | 'accountId' | 'toAccountId'>,
  p: ParsedSms,
  accounts: Account[],
  transactions: Transaction[],
): { txn: Transaction; accountId: ID; toAccountId: ID } | undefined {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sure = !!p.isSelfTransfer || !!p.otherLast4;
  if (!s.accountId || (!sure && s.amount < TRANSFER_PAIR_MIN)) return undefined;
  const near = (t: Transaction) =>
    counted(t) &&
    t.amount === s.amount &&
    Math.abs(daysBetween(t.date, s.date)) <= 1 &&
    (t.source === 'sms' || t.source === 'notification');
  const pick = (list: Transaction[]) =>
    list.sort(
      (a, b) => Math.abs(daysBetween(a.date, s.date)) - Math.abs(daysBetween(b.date, s.date)),
    )[0];
  if (s.kind === 'income' && movable(byId.get(s.accountId))) {
    if (p.isRefund || p.isCashback) return undefined;
    const t = pick(
      transactions.filter(
        (t) =>
          near(t) &&
          t.kind === 'expense' &&
          t.accountId !== s.accountId &&
          movable(byId.get(t.accountId)) &&
          t.paymentMode !== 'card' &&
          !t.splits,
      ),
    );
    return t ? { txn: t, accountId: t.accountId, toAccountId: s.accountId } : undefined;
  }
  const from = s.accountId;
  const to = s.kind === 'transfer' ? s.toAccountId : undefined;
  if ((s.kind === 'expense' || s.kind === 'transfer') && movable(byId.get(from))) {
    if (p.isAtm || p.isCardBillPayment || p.isWalletTopUp || p.mode === 'card') return undefined;
    const t = pick(
      transactions.filter(
        (t) =>
          near(t) &&
          t.kind === 'income' &&
          t.accountId !== from &&
          (!to || t.accountId === to) &&
          movable(byId.get(t.accountId)),
      ),
    );
    return t ? { txn: t, accountId: from, toAccountId: t.accountId } : undefined;
  }
  return undefined;
}

/**
 * Which card a "paid to CRED / card bill" debit paid (U-16). With several cards, the paying
 * account alone can't tell — two cards paid from the same bank used to land on the first one.
 * In order: the card's number in the text; the one card whose bill (statement, what's left of it,
 * or everything owed) is exactly this amount; the only card paid from this account; the only card.
 * Otherwise nobody guesses: the Inbox asks.
 */
export function billCard(
  p: ParsedSms,
  amount: number,
  date: ISODate,
  live: Account[],
  transactions: Transaction[],
  fromAccountId?: ID,
): Account | undefined {
  const cards = live.filter((a) => a.kind === 'credit_card' && a.card);
  if (cards.length <= 1) return cards[0];
  if (p.otherLast4) {
    const named = cards.find((c) => c.last4 === p.otherLast4);
    if (named) return named;
  }
  const matches = cards.filter((c) => {
    try {
      const snap = cardSnapshot(c, transactions, date);
      return [snap.lastStatement.totalDue, snap.dueNow, snap.owed].includes(amount);
    } catch {
      return false;
    }
  });
  if (matches.length === 1) return matches[0];
  const pool = matches.length ? matches : cards;
  const fromHere = pool.filter((c) => fromAccountId && c.card?.paymentAccountId === fromAccountId);
  return fromHere.length === 1 ? fromHere[0] : undefined;
}

export function suggest(p: ParsedSms, ctx: Ctx): Suggestion {
  const { account, how } = findAccount(p, ctx.accounts, ctx.accountHints);
  // A message can't describe a payment after the day it arrived (bill reminders, schedules).
  const datedAhead = !!p.date && p.date > ctx.receivedAt;
  const date = datedAhead ? ctx.receivedAt : (p.date ?? ctx.receivedAt);
  const live = ctx.accounts.filter((a) => !a.deletedAt && !a.archived);
  const amount = p.amount ?? 0;

  let kind: TxnKind = p.kind === 'credit' ? (p.isRefund ? 'refund' : 'income') : 'expense';
  let accountId = account?.id;
  let toAccountId: ID | undefined;
  let categoryId: ID | undefined;
  let categorySource: Suggestion['categorySource'] = 'none';
  let merchant = p.merchant;
  let mode: PaymentMode | undefined =
    p.mode === 'atm'
      ? 'other'
      : p.mode === 'card'
        ? 'card'
        : p.mode === 'upi'
          ? 'upi'
          : p.mode === 'netbanking'
            ? 'netbanking'
            : p.mode === 'auto_debit'
              ? 'auto_debit'
              : undefined;

  if (p.kind === 'card_payment') {
    // The card says it received a payment: a transfer from the card's usual paying account.
    kind = 'transfer';
    toAccountId = account?.id;
    // Best guess until the bank's own debit arrives and corrects it (see below).
    accountId =
      account?.card?.paymentAccountId ??
      [...live].sort((a, b) => a.sortOrder - b.sortOrder).find((a) => a.kind === 'bank')?.id;
    merchant = undefined;
    mode = 'netbanking';
  } else if (p.kind === 'debit' && p.isCardBillPayment) {
    kind = 'transfer';
    toAccountId = billCard(p, amount, date, live, ctx.transactions, accountId)?.id;
    merchant = undefined;
  } else if (p.kind === 'debit' && p.isAtm) {
    const cash = live.find((a) => a.kind === 'cash');
    if (cash) {
      kind = 'transfer';
      toAccountId = cash.id;
      merchant = undefined;
    } else {
      categoryId = 'other';
      categorySource = 'wording';
    }
  } else if (
    (p.kind === 'debit' || p.kind === 'credit') &&
    (p.otherLast4 || p.isSelfTransfer) &&
    movable(account)
  ) {
    // Between your own accounts: "To Self Kotak Bank XX3344", "from A/c XX4521".
    const others = live.filter((a) => movable(a) && a.id !== account!.id);
    const other = p.otherLast4
      ? others.find((a) => a.last4 === p.otherLast4)
      : p.isSelfTransfer && others.filter((a) => a.kind === 'bank').length === 1
        ? others.find((a) => a.kind === 'bank')
        : undefined;
    if (other || p.isSelfTransfer) {
      kind = 'transfer';
      merchant = undefined;
      if (p.kind === 'debit') toAccountId = other?.id;
      else {
        accountId = other?.id;
        toAccountId = account!.id;
      }
    }
  } else if (p.isWalletTopUp) {
    // Wallet top-up (incl. auto top-up mandates): money moves bank → wallet. Not spending.
    const wallet =
      p.instrument === 'upi_lite'
        ? (live.find((a) => a.kind === 'wallet' && /lite/i.test(a.name)) ?? walletFor(p, live))
        : walletFor(p, live);
    kind = 'transfer';
    merchant = undefined;
    toAccountId = wallet?.id;
    if (account?.kind === 'wallet') {
      // Message came from the wallet side; the paying bank is the remembered/only one.
      toAccountId = account.id;
      const banks = live.filter((a) => a.kind === 'bank');
      accountId = banks.length === 1 ? banks[0]!.id : undefined;
    }
    if (toAccountId === accountId) toAccountId = undefined;
  }

  if (kind === 'expense' || kind === 'refund') {
    if (!categoryId) {
      const g = guessCategory(merchant, ctx.rules);
      if (g.categoryId) {
        categoryId = g.categoryId;
        categorySource = g.source === 'rule' ? 'rule' : 'built-in';
      }
      if (g.name) merchant = g.name;
      if (!categoryId) {
        categoryId = FALLBACK_CATEGORY;
        categorySource = 'fallback';
      }
    }
  } else if (kind === 'income') {
    const g = guessCategory(merchant, ctx.rules);
    categoryId =
      g.source === 'rule' && g.categoryId
        ? g.categoryId
        : p.isCashback
          ? 'cashback'
          : guessIncomeCategory(merchant ?? '');
    categorySource = g.source === 'rule' ? 'rule' : 'wording';
    if (g.name) merchant = g.name;
  }

  const draft = { kind, amount, date, accountId, toAccountId, externalRef: p.ref };
  let dup = findDuplicate(draft, ctx.transactions);
  // Income on account B after the same move was recorded as a transfer A → B.
  if (!dup && kind === 'income' && accountId)
    for (const t of ctx.transactions)
      if (
        counted(t) &&
        t.kind === 'transfer' &&
        t.toAccountId === accountId &&
        t.amount === amount &&
        Math.abs(daysBetween(t.date, date)) <= 3
      ) {
        dup = { txn: t, reason: 'Same transfer from the other side' };
        break;
      }
  let pair = dup ? undefined : findTransferPair(draft, p, ctx.accounts, ctx.transactions);
  // The bank's "paid to CRED / card bill" debit, after the card's "payment received" was
  // recorded with a guessed bank: same payment; the bank in this message is the right one.
  if (!dup && kind === 'transfer' && p.isCardBillPayment && accountId)
    for (const t of ctx.transactions) {
      const card = t.toAccountId ? live.find((a) => a.id === t.toAccountId) : undefined;
      if (
        counted(t) &&
        t.kind === 'transfer' &&
        card?.kind === 'credit_card' &&
        (!toAccountId || toAccountId === card.id) &&
        t.amount === amount &&
        Math.abs(daysBetween(t.date, date)) <= 3
      ) {
        dup = { txn: t, reason: 'Same card payment from the other side' };
        if (t.accountId !== accountId) pair = { txn: t, accountId, toAccountId: card.id };
        break;
      }
    }
  if (pair && !dup)
    dup = { txn: pair.txn, reason: 'Other side of a transfer between your accounts' };
  const needsTo = kind === 'transfer' && (!toAccountId || !accountId);
  return {
    ...draft,
    categoryId,
    merchant,
    paymentMode: mode,
    accountMatch: how,
    categorySource,
    duplicateOf: dup?.txn,
    duplicateReason: dup?.reason,
    unknownLast4: !account && p.last4 ? p.last4 : undefined,
    pairTransfer: pair ? { accountId: pair.accountId, toAccountId: pair.toAccountId } : undefined,
    datedAhead: datedAhead || undefined,
    ready: !!accountId && !needsTo && !dup && !datedAhead && amount > 0 && p.confidence >= 0.6,
    person:
      kind === 'expense' || kind === 'income'
        ? personName(
            { ...p, merchant: merchant ?? p.merchant },
            categorySource === 'rule' || categorySource === 'built-in',
          )
        : undefined,
  };
}

export { merchantKey };
