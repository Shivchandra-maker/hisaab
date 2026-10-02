import { daysBetween } from '../dates';
import { counted } from '../ledger';
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

/** Same money already recorded? Matches on reference first, then amount + account + date window. */
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
  }
  return undefined;
}

export function suggest(p: ParsedSms, ctx: Ctx): Suggestion {
  const { account, how } = findAccount(p, ctx.accounts, ctx.accountHints);
  const date = p.date ?? ctx.receivedAt;
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
    accountId = account?.card?.paymentAccountId ?? live.find((a) => a.kind === 'bank')?.id;
    merchant = undefined;
    mode = 'netbanking';
  } else if (p.kind === 'debit' && p.isCardBillPayment) {
    kind = 'transfer';
    const cards = live.filter((a) => a.kind === 'credit_card');
    toAccountId = (
      cards.find((c) => c.card?.paymentAccountId === accountId) ??
      (cards.length === 1 ? cards[0] : undefined)
    )?.id;
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
  const dup = findDuplicate(draft, ctx.transactions);
  const needsTo = kind === 'transfer' && !toAccountId;
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
    ready: !!accountId && !needsTo && !dup && amount > 0 && p.confidence >= 0.6,
  };
}

export { merchantKey };
