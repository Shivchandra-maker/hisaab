/**
 * Hisaab data model v1.
 *
 * Rules that every part of the app relies on:
 * 1. Money is stored as integer paise (₹1 = 100). Never floats.
 * 2. Dates are calendar dates in IST, stored as 'YYYY-MM-DD' strings. `date` is always the day
 *    the money was actually spent/received. Card statement periods are derived from it, never stored on it.
 * 3. Moving money between your own accounts (card bill payment, ATM withdrawal, wallet top-up,
 *    self-transfer) is a `transfer` and is never counted as spending or income.
 * 4. UPI is a payment mode, not an account. UPI from a bank debits that bank account; UPI on a
 *    RuPay credit card debits the card. Only UPI Lite and wallets are accounts (kind `wallet`).
 * 5. Records are soft-deleted (`deletedAt`) so they can sync across devices later (Phase 6).
 */

export type ID = string;
/** Integer number of paise. */
export type Paise = number;
/** Calendar date in IST, 'YYYY-MM-DD'. */
export type ISODate = string;
/** Calendar month, 'YYYY-MM'. */
export type MonthKey = string;
/** ISO timestamp, used only for record bookkeeping (createdAt/updatedAt). */
export type Timestamp = string;

interface Syncable {
  id: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt?: Timestamp;
}

/* ───────────────────────── Accounts ───────────────────────── */

/** `wallet` covers UPI Lite, Paytm / Amazon Pay balances and other prepaid wallets. */
export type AccountKind = 'bank' | 'cash' | 'wallet' | 'credit_card';

/** Asset accounts hold money you have. Credit cards hold money you owe. */
export const isLiability = (kind: AccountKind): boolean => kind === 'credit_card';

export type CardNetwork = 'visa' | 'mastercard' | 'rupay' | 'amex' | 'diners' | 'other';

export interface CardDetails {
  /** Day of month the statement is generated (1–31). Clamped to the month's last day. */
  statementDay: number;
  /** Days from statement date to payment due date (Indian cards are usually 15–20). */
  dueDaysAfterStatement: number;
  creditLimit: Paise;
  network?: CardNetwork;
  /** Account the bill is normally paid from. */
  paymentAccountId?: ID;
  /**
   * Banks sometimes move a statement date (holidays, product changes).
   * Key = month the statement closes in ('YYYY-MM'), value = actual statement date.
   */
  statementOverrides?: Record<MonthKey, ISODate>;
}

export interface Account extends Syncable {
  name: string;
  kind: AccountKind;
  /** Bank or issuer name, e.g. "HDFC Bank". */
  institution?: string;
  /** Last 4 digits of account/card number. Used to match SMS/email alerts in Phase 7. */
  last4?: string;
  /** UPI IDs (VPAs) linked to this account. */
  upiIds?: string[];
  /**
   * Balance on `openingDate`.
   * Asset accounts: money in the account. Credit cards: amount owed (positive = you owe).
   */
  openingBalance: Paise;
  openingDate: ISODate;
  card?: CardDetails;
  color?: string;
  archived: boolean;
  sortOrder: number;
}

/* ───────────────────────── Categories ───────────────────────── */

export type CategoryKind = 'expense' | 'income';

export interface Category extends Syncable {
  name: string;
  kind: CategoryKind;
  /** One level of sub-categories, e.g. Food › Eating out. */
  parentId?: ID;
  icon: string;
  color: string;
  archived: boolean;
  sortOrder: number;
}

/* ───────────────────────── Transactions ───────────────────────── */

/**
 * - expense:  money leaves `accountId` for a purchase (counts as spending).
 * - income:   money arrives in `accountId` (salary, interest, gifts).
 * - refund:   money back for an earlier expense; reduces spending in its category.
 * - transfer: money moves `accountId` → `toAccountId`. Never spending or income.
 * - adjustment: corrects a balance to match the real one (`flow` in/out). Never spending or income.
 * - debt: money lent to / borrowed from a person, or repaid (`flow` in/out, `debtId`).
 *   Not spending: you expect it back (or owe it back).
 */
export type TxnKind = 'expense' | 'income' | 'refund' | 'transfer' | 'adjustment' | 'debt';

/** Direction for `adjustment` and `debt`: money into (`in`) or out of (`out`) `accountId`. */
export type Flow = 'in' | 'out';

export type PaymentMode =
  'upi' | 'card' | 'netbanking' | 'cash' | 'auto_debit' | 'cheque' | 'wallet' | 'other';

/** Where a transaction came from. Phase 7 adds the automatic sources. */
export type TxnSource = 'manual' | 'subscription' | 'import' | 'sms' | 'email' | 'notification';

/** Auto-captured transactions start as `pending` and wait in the Review inbox. */
export type TxnStatus = 'confirmed' | 'pending';

export interface Split {
  categoryId: ID;
  amount: Paise;
  note?: string;
}

export interface Transaction extends Syncable {
  kind: TxnKind;
  /** Day the money actually moved (IST). Drives all calendar-month reports. */
  date: ISODate;
  /** Always positive. Direction comes from `kind`. */
  amount: Paise;
  /** Source account for expense/transfer, destination for income/refund. */
  accountId: ID;
  /** Destination account, transfers only. */
  toAccountId?: ID;
  /** Adjustments and debts only. */
  flow?: Flow;
  /** Debts only: the person record this lending/borrowing/repayment belongs to. */
  debtId?: ID;
  /** Not used for transfers. Ignored when `splits` is present. */
  categoryId?: ID;
  /** Split one payment across categories. Amounts must add up to `amount`. */
  splits?: Split[];
  paymentMode?: PaymentMode;
  merchant?: string;
  note?: string;
  tags: string[];
  /** For refunds: the expense being refunded. */
  refundOf?: ID;
  /** EMI conversion: the purchase counts once; instalments are tracked against this plan. */
  emiPlanId?: ID;
  subscriptionId?: ID;
  source: TxnSource;
  status: TxnStatus;
  /** Bank reference / UPI UTR. Used to remove duplicates between SMS, email and imports. */
  externalRef?: string;
  /** Original SMS/email text for auto-captured transactions. */
  rawText?: string;
}

/* ───────────────────────── Budgets ───────────────────────── */

/** `categoryId` undefined = overall budget for all spending. */
export interface Budget extends Syncable {
  categoryId?: ID;
  amount: Paise;
  period: 'monthly';
  /** Carry unspent (or overspent) amount into next month. */
  rollover: boolean;
}

/* ───────────────────────── Subscriptions & recurring ───────────────────────── */

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Subscription extends Syncable {
  name: string;
  amount: Paise;
  frequency: Frequency;
  /** Next date a payment is expected. */
  nextDate: ISODate;
  accountId: ID;
  categoryId: ID;
  /** Paid automatically (card standing instruction / UPI AutoPay). */
  autoPay: boolean;
  active: boolean;
  note?: string;
}

/* ───────────────────────── Money lent & borrowed ───────────────────────── */

/**
 * One running balance with one person in one direction ("Rahul owes me", "I owe Priya").
 * The amounts live in `debt` transactions linked by `debtId`, so balances stay correct:
 * lent = money out, repayment received = money in (and the reverse for borrowed).
 */
export interface Debt extends Syncable {
  person: string;
  direction: 'lent' | 'borrowed';
  note?: string;
  /** Set when the outstanding amount reaches zero (or the user marks it settled). */
  settledAt?: ISODate;
}

/* ───────────────────────── EMI ───────────────────────── */

export interface EmiPlan extends Syncable {
  cardAccountId: ID;
  /** Original purchase transaction. Spending is counted once, on its date. */
  purchaseTxnId: ID;
  principal: Paise;
  months: number;
  monthlyAmount: Paise;
  /** Interest + processing fee are real costs and are recorded as expenses when charged. */
  startDate: ISODate;
}

/* ───────────────────────── Inbox (auto-captured messages) ───────────────────────── */

export type InboxSource = 'paste' | 'sms' | 'notification' | 'email';
export type InboxStatus = 'new' | 'added' | 'ignored' | 'duplicate' | 'notice';

/**
 * One captured message waiting for review. The parsed result is stored so the inbox can show it
 * without re-parsing; `txnId` links to the transaction created when it was added.
 */
export interface InboxItem extends Syncable {
  source: InboxSource;
  rawText: string;
  /** Hash of the normalised text, so the same message is never captured twice. */
  hash: string;
  /** When the message arrived (or was pasted). Used when the text has no date. */
  receivedAt: ISODate;
  /** Exact arrival time (ms) for captured SMS / notifications; used to pair the same payment
   *  arriving both as a bank SMS and as an app notification. */
  receivedTs?: number;
  /** SMS sender ID ("VM-HDFCBK") or the app package for notifications. */
  sender?: string;
  status: InboxStatus;
  /** Parser output (see domain/sms/parse.ts), kept as plain JSON. */
  parsed: import('./sms/parse').ParsedSms;
  /** Why it was set aside: duplicate of which transaction, ignore reason… */
  note?: string;
  duplicateOf?: ID;
  txnId?: ID;
}

/**
 * Learned from your corrections: "SWIGGY → Food & dining". Matched on a normalised merchant key.
 */
export interface MerchantRule extends Syncable {
  /** Normalised merchant (lowercase, letters and digits only), e.g. "swiggy". */
  key: string;
  /** Display name to use for this merchant, e.g. "Swiggy". */
  name: string;
  categoryId?: ID;
  /** Times this rule has been applied or confirmed. */
  hits: number;
}
