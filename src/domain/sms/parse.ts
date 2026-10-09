import { daysInMonth, ymd } from '../dates';
import type { ISODate, Paise } from '../types';

/**
 * Bank / card / UPI SMS parser for India.
 *
 * Banks word their alerts differently, but every transaction alert carries the same facts:
 * an amount, a direction (debited / credited), an account or card ending, usually a merchant
 * or UPI ID, often a reference number, a balance and a date. This parser looks for those
 * facts with layered patterns instead of one template per bank, so new formats mostly work.
 *
 * Pure function, no I/O. Unit-tested in parse.test.ts with real-world message shapes.
 */

export type SmsKind =
  | 'debit' // money out of an account or card
  | 'credit' // money in (salary, refund, cashback, transfer received)
  | 'card_payment' // card issuer confirming a bill payment received
  | 'autopay_notice' // mandate created / pre-debit reminder / cancelled — not a transaction yet
  | 'emi_notice' // purchase converted to EMI — not a new transaction
  | 'ignore'; // OTP, promotion, declined/failed transaction, balance enquiry…

export type Instrument =
  'credit_card' | 'debit_card' | 'account' | 'upi_lite' | 'wallet' | 'unknown';

export interface ParsedSms {
  kind: SmsKind;
  /** Why it was ignored, or extra context for notices. */
  reason?: string;
  amount?: Paise;
  instrument: Instrument;
  /** Last 4 digits of the account or card, if present. */
  last4?: string;
  /** Cleaned merchant / payee / payer name. */
  merchant?: string;
  /** UPI ID if the counterparty was a VPA. */
  vpa?: string;
  /** Bank reference / UPI UTR / RRN — used for de-duplication. */
  ref?: string;
  /** Available balance (accounts) or available limit (cards) after the transaction. */
  balance?: Paise;
  balanceIsLimit?: boolean;
  /** Transaction date found in the text (IST). */
  date?: ISODate;
  /** Time of day in the text ("HH:mm", IST), e.g. "13-09-25 21:35:56", "at 01:28 PM". */
  time?: string;
  /** Bank or issuer named in the text, e.g. "HDFC Bank". */
  bank?: string;
  mode?: 'upi' | 'card' | 'netbanking' | 'atm' | 'auto_debit' | 'other';
  /** Refund / reversal of an earlier purchase. */
  isRefund?: boolean;
  isCashback?: boolean;
  isAtm?: boolean;
  /** Your other account named in the text ("To Self Kotak Bank XX3344", "to A/c XX3344"). */
  otherLast4?: string;
  /** Says outright it went to your own account ("To Self", "own account"). */
  isSelfTransfer?: boolean;
  /** Debit from a bank account that pays a credit-card bill. */
  isCardBillPayment?: boolean;
  /** Money moved into UPI Lite / a wallet. */
  isWalletTopUp?: boolean;
  /** Wallet named in the text, e.g. "PhonePe", when the payment used a wallet. */
  walletName?: string;
  /** A recurring debit (mandate, standing instruction, NACH, AutoPay). */
  isRecurring?: boolean;
  /** Autopay notices: the scheduled date and frequency, if stated. */
  scheduledDate?: ISODate;
  frequency?: string;
  /** EMI notices. */
  emiMonths?: number;
  emiAmount?: Paise;
  /** Credit-card statement alerts: read for card details, never added as a payment. */
  statement?: { totalDue?: Paise; minDue?: Paise; dueDate?: ISODate };
  /** 0–1: how sure the parser is that this is a real, complete transaction. */
  confidence: number;
  /** Spent in another currency; the ₹ amount isn't in the message (`amount` is then unset). */
  foreign?: { currency: string; amount: number };
}

/** Bump when parsing changes, so messages already in the Inbox are read again with the new rules. */
export const PARSER_VERSION = 8;

/* ───────────────────────── helpers ───────────────────────── */

// "Rs..50" / "Rs..6" (paise with a stray dot) are amounts too, not a reason to skip to the balance.
const AMOUNT = String.raw`(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})`;
/**
 * Short and unusual ways banks say money moved (H-15): "Dr INR", "Rs.80.00 Dr.", "UPI debit:",
 * "DEBIT:Rs.", "UPI Credit:INR", "NEFT credit of", "CREDIT with amount", "has credit for",
 * "has a debit by transfer", "Rs.1100credited", "Payment of Rs … successful", HSBC "used at".
 */
const SHORT_MOVE =
  /\b(?:dr|cr)\.?\s*(?:inr|rs\.?|₹)|(?:inr|rs\.?|₹)\s*[\d,.]+\s*(?:dr|cr)\b|\b(?:upi\s+)?(?:debit|credit)\s*:|\bhas\s+(?:a\s+)?(?:credit|debit)\b|\b(?:credit|debit)\s+(?:with amount|of (?:inr|rs|₹)|by (?:transfer|cheque|cash))|\d(?:credited|debited)\b|\bpayment\s+(?:of\s+)?(?:inr|rs\.?|₹)\s*[\d,.]+[^.]{0,80}?\b(?:successful|confirmed|done)\b|\bpayment successful\b|\bused at\b|\bthank you for using\b[^.]{0,40}\bcard\b|\btransaction (?:number|no\.?)\b[^.]{0,30}\bfor (?:inr|rs\.?|₹)|\brefunded\b/i;
/** Spends in another currency on an Indian card: the rupee amount comes on the statement. */
const FOREIGN =
  /\b(USD|EUR|GBP|AED|SGD|AUD|CAD|JPY|CHF|THB|MYR|HKD|NZD|SAR|QAR)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)/;
const toPaise = (s: string): Paise => Math.round(Number(s.replace(/,/g, '')) * 100);

const BANKS: [RegExp, string][] = [
  [/\bhdfc\b/i, 'HDFC Bank'],
  [/\bicici\b/i, 'ICICI Bank'],
  [/\bsbi\b|state bank/i, 'State Bank of India'],
  [/\baxis\b/i, 'Axis Bank'],
  [/\bkotak\b/i, 'Kotak Mahindra Bank'],
  [/\bidfc\b/i, 'IDFC First Bank'],
  [/\byes bank\b|\byesbnk\b/i, 'Yes Bank'],
  [/\bindusind\b/i, 'IndusInd Bank'],
  [/\bau (?:small finance )?bank\b|\baubank\b/i, 'AU Small Finance Bank'],
  [/\bfederal\b/i, 'Federal Bank'],
  [/\bpnb\b|punjab national/i, 'Punjab National Bank'],
  [/\bbank of baroda\b|\bbob\b/i, 'Bank of Baroda'],
  [/\bcanara\b/i, 'Canara Bank'],
  [/\bunion bank\b/i, 'Union Bank of India'],
  [/\brbl\b/i, 'RBL Bank'],
  [/\bonecard\b/i, 'OneCard'],
  [/\bamex\b|american express/i, 'American Express'],
  [/\bstandard chartered\b|\bsc bank\b/i, 'Standard Chartered'],
  [/\bhsbc\b/i, 'HSBC'],
  [/\bciti\b/i, 'Citi'],
  [/\bpaytm\b/i, 'Paytm'],
  [/\bairtel payments?\b/i, 'Airtel Payments Bank'],
];

const WALLETS: [RegExp, string][] = [
  [/\bphone\s?pe\b/i, 'PhonePe'],
  [/\bpaytm\b/i, 'Paytm'],
  [/\bamazon\s?pay\b/i, 'Amazon Pay'],
  [/\bmobikwik\b/i, 'MobiKwik'],
  [/\bfreecharge\b/i, 'Freecharge'],
  [/\bairtel\s?money\b/i, 'Airtel Money'],
  [/\bjio\s?money\b/i, 'JioMoney'],
  [/\bola\s?money\b/i, 'Ola Money'],
];

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function validDate(y: number, m: number, d: number): ISODate | undefined {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m) || y < 2000 || y > 2100) return undefined;
  return ymd(y, m, d);
}

/** Find the transaction date. Indian alerts are day-first. */
export function findDate(text: string): ISODate | undefined {
  let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/); // 2026-09-28
  if (m) return validDate(+m[1]!, +m[2]!, +m[3]!);
  m = text.match(/\b(\d{1,2})[-/ ]?([a-z]{3,4})[-/ ,]*'?(\d{2,4})\b/i); // 28-Sep-26, 28Sep26, 01 OCT 2026
  if (m && MONTHS[m[2]!.toLowerCase()])
    return validDate(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!);
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/); // 28/09/26, 28-09-2026
  if (m) return validDate(+m[3]!, +m[2]!, +m[1]!);
  return undefined;
}

/** Time of day in the alert, as "HH:mm". */
export function findTime(text: string): string | undefined {
  // HDFC cards: "On 2025-10-13:22:29:42"
  let m = text.match(/\b20\d{2}-\d{2}-\d{2}[:\sT]+(\d{2}):(\d{2})(?::\d{2})?\b/);
  if (!m) m = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/i);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function findLast4(text: string): { last4?: string; instrument: Instrument } {
  if (/upi\s*lite/i.test(text)) return { instrument: 'upi_lite' };
  const card = text.match(
    /(credit|debit)?\s*card(?:\s*(?:no\.?|number|ending(?:\s*(?:with|in))?|xx+|x+|\*+|:))*\s*[x*]*\s*(\d{4})\b/i,
  );
  if (card) {
    const isDebit = /debit/i.test(card[1] ?? '') || /debit card/i.test(text);
    return { last4: card[2], instrument: isDebit ? 'debit_card' : 'credit_card' };
  }
  const acct = text.match(
    /\b(?:a\/?c|acct|account)(?:\s*(?:no\.?|number|ending|:))*\s*[x*.]*\s*(\d{3,6})\b/i,
  );
  if (acct) return { last4: acct[1]!.slice(-4), instrument: 'account' };
  const bare = text.match(/\b[x*]{2,}(\d{4})\b/i);
  if (bare) return { last4: bare[1], instrument: 'unknown' };
  if (/\bwallet\b/i.test(text)) return { instrument: 'wallet' };
  return { instrument: 'unknown' };
}

/** The transaction amount, skipping balances and limits. */
function findAmount(text: string): Paise | undefined {
  const re = new RegExp(AMOUNT, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 28), m.index).toLowerCase();
    if (
      /(bal(ance)?|limit|lmt|avl|available|outstanding|total due|min(imum)? (amt|amount)? ?due)[\s.:]*(is)?\s*$/.test(
        before,
      )
    )
      continue;
    const v = toPaise(m[1]!);
    if (v > 0) return v;
  }
  // SBI style: "debited by 120.0", "credited by 5000"
  const bare = text.match(
    /\b(?:debited|credited|spent|paid|sent|withdrawn|deposited)\s+(?:by|for|of|with)?\s*([\d,]+(?:\.\d{1,2})?)\b/i,
  );
  if (bare) return toPaise(bare[1]!);
  return undefined;
}

function findBalance(text: string): { balance?: Paise; isLimit?: boolean } {
  const m = text.match(
    new RegExp(
      String.raw`\b(avl\.?|available|avail\.?|a\/c|clr\.?|total)?\s*(bal(?:ance)?|lmt|limit|credit limit)\s*(?:is|:|-)?\s*(?:${AMOUNT}|([\d,]+(?:\.\d{1,2})?))`,
      'i',
    ),
  );
  if (!m) {
    // "Avl Bal in your A/c XX4521 is Rs.23,450.50"
    const far = text.match(
      new RegExp(
        String.raw`\b(?:avl\.?|available|avail\.?)\s*(bal(?:ance)?|lmt|limit)\b.{0,45}?\bis\s*(?:${AMOUNT}|([\d,]+(?:\.\d{1,2})?))`,
        'i',
      ),
    );
    const raw = far?.[2] ?? far?.[3];
    return raw ? { balance: toPaise(raw), isLimit: /lmt|limit/i.test(far![1]!) } : {};
  }
  const raw = m[3] ?? m[4];
  if (!raw) return {};
  return { balance: toPaise(raw), isLimit: /lmt|limit/i.test(m[2]!) };
}

function findRef(text: string): string | undefined {
  const axis = text.match(/UPI\/P2[AM]\/(\d{9,})/i);
  if (axis) return axis[1];
  // "UPI: 123456789012", "UPI/DR/412345678901/…", "Info: UPI/ICIC/412345678901/…", "IMPS:ABC123456" (A26)
  const short = text.match(
    /\b(?:upi\s*[:/]\s*(?:(?:dr|cr|[a-z]{4})\/)?|imps\s*[:/]\s*)([a-z0-9]{9,})\b/i,
  );
  if (short && /\d{6,}/.test(short[1]!)) return short[1]!.toUpperCase();
  const m = text.match(
    /\b(?:upi\s*ref(?:erence)?(?:\s*no\.?)?|ref(?:erence)?(?:\s*(?:no|num(?:ber)?|id))?\.?|refno|rrn|utr(?:\s*no\.?)?|txn\s*(?:id|no)|transaction\s*id|imps\s*ref(?:\s*no)?)[\s:.#-]*([a-z0-9]{6,})\b/i,
  );
  if (m && /\d{4,}/.test(m[1]!)) return m[1]!.toUpperCase();
  return undefined;
}

const STOP = String.raw`(?=\s+(?:on|at|via|ref|refno|upi|using|avl|bal|for|from|dated|txn|credited|debited|has|is|was|-\s)\b|[.,;\n]|\s*\(|\s+\d{1,2}[-/]|$)`;

function cleanName(raw: string): string | undefined {
  let s = raw
    .replace(/\s+/g, ' ')
    .replace(/^(m\/?s\.?|mr\.?|ms\.?|mrs\.?|merchant|the merchant)\s+/i, '')
    // Payment gateways glued in front of the real merchant: "CREDPAYPLAYO" → "PLAYO".
    .replace(
      /^(cred\s?pay|razorpay|rzp|payu|billdesk|ccavenue|cashfree|bharatpe|paytm|phonepe|gpay)[\s*_.-]*(?=[a-z0-9]{3,})/i,
      '',
    )
    .replace(/[*_]+/g, ' ')
    .replace(/\b(pvt|private)\s*(ltd|limited)?\.?$/i, '')
    .replace(/\b(ltd|limited|llp|inc)\.?$/i, '')
    .trim();
  if (!s || s.length < 2 || /^(your|you|a\/?c|ac|account|the|beneficiary|card|bank)$/i.test(s))
    return undefined;
  if (/^\d+$/.test(s)) return undefined;
  // Title-case shouty or all-lowercase names: "BIGBASKET" → "Bigbasket", "Sudhakar navuri" →
  // "Sudhakar Navuri". Words already in mixed case ("McDonald's") are kept as written.
  if (s === s.toUpperCase()) s = s.toLowerCase();
  s = s.replace(/\b[a-z][a-z']*/g, (w) => w[0]!.toUpperCase() + w.slice(1));
  return s.slice(0, 48);
}

function findCounterparty(
  text: string,
  kind: 'debit' | 'credit',
): { merchant?: string; vpa?: string } {
  const vpaMatch = text.match(/\b([a-z0-9._-]{2,}@[a-z][a-z0-9]{1,})\b/i);
  const vpa =
    vpaMatch && !/\.(com|in|co)\b/i.test(vpaMatch[1]!) ? vpaMatch[1]!.toLowerCase() : undefined;

  const tries: RegExp[] = [
    /UPI\/P2[AM]\/\d+\/([^\n/]+)/i, // Axis: UPI/P2M/4267…/NETFLIX
    // PhonePe wallet: "paid Rs.75 via PhonePe wallet for KIRANA STORE . Not you?"
    /\bwallet\s+(?:for|to)\s+([^\n]+?)\s*(?:\.\s|\.$|$)/i,
    /\n\s*to:?\s+([^\n]+)/i, // HDFC multi-line: "To SWIGGY"
    /\bInfo:?\s*([^.\n]+)/i,
    /\bfor\s+(?:neft|imps|rtgs|upi)\s*(?:cr|dr)?[-\s:]*([^.\n]+?)(?:\.|\n|avl|$)/i,
    /\btrf\s+to\s+([^\n]+?)(?:\s+refno|\s+ref|\.|$)/i,
    /\btowards\s+([^\n]+?)(?=\s+(?:as per|on|via|ref)\b|[.,\n]|$)/i,
  ];
  if (kind === 'debit') {
    tries.unshift(/\bto\s+(?:vpa\s+)?([a-z0-9._-]{2,}@[a-z][a-z0-9]+)/i);
    tries.push(new RegExp(String.raw`\bat\s+([a-z0-9][\w .&'@/-]{1,60}?)${STOP}`, 'i'));
    tries.push(
      new RegExp(
        String.raw`\bto\s+(?!your\b|a\/?c\b|ac\b|account\b|vpa\b)([a-z0-9][\w .&'@/-]{1,60}?)${STOP}`,
        'i',
      ),
    );
    tries.push(new RegExp(String.raw`\bon\s+(?!\d)([A-Z][A-Z0-9 .&'*-]{2,40}?)${STOP}`)); // ICICI: "on 28-Sep-26 on BIGBASKET"
  } else {
    tries.push(
      new RegExp(
        String.raw`\bfrom\s+(?!your\b|a\/?c\b|ac\b|account\b)([a-z0-9][\w .&'@/-]{1,60}?)${STOP}`,
        'i',
      ),
    );
    tries.push(
      new RegExp(String.raw`\bby\s+(?!a\/?c\b|ac\b)([a-z][\w .&'@/-]{1,60}?)${STOP}`, 'i'),
    );
  }
  for (const re of tries) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let raw = m[1].trim();
    if (/@/.test(raw)) {
      // Payee given only as a UPI ID: use the readable part ("swiggy@icici" → "Swiggy").
      const local = raw
        .split('@')[0]!
        .replace(/[._-]+/g, ' ')
        .replace(/\d{6,}/g, '')
        .trim();
      raw = local || raw;
    }
    if (/^(?:vpa|upi|ref|your|a\/?c|ac)\b/i.test(raw)) continue;
    const name = cleanName(raw);
    if (name) return { merchant: name, vpa };
  }
  if (vpa) {
    const local = vpa
      .split('@')[0]!
      .replace(/[._-]+/g, ' ')
      .replace(/\d{6,}/g, '')
      .trim();
    return { merchant: local ? cleanName(local) : undefined, vpa };
  }
  return { vpa };
}

/* ───────────────────────── scams ───────────────────────── */

/**
 * Banks' own sites. Since 2025 RBI moves Indian banks to `.bank.in`, so any of those is fine too.
 * A link elsewhere plus pressure words ("suspended", "KYC", "click") is the classic scam SMS.
 */
const TRUSTED_SITES =
  /(?:^|\.)(?:bank\.in|kotak\.com|hdfcbank\.com|hdfc\.com|icicibank\.com|sbi\.co\.in|onlinesbi\.sbi|sbi|sbicard\.com|axisbank\.com|axis\.bank|bobcard\.io|bankofbaroda\.in|idfcfirstbank\.com|yesbank\.in|indusind\.com|federalbank\.co\.in|pnbindia\.in|canarabank\.com|unionbankofindia\.co\.in|rblbank\.com|aubank\.in|sc\.com|hsbc\.co\.in|citi\.com|paytm\.com|paytmbank\.com|phonepe\.com|phone\.pe|amazon\.in|getonecard\.app|cred\.club|npci\.org\.in|sihub\.in|incometax\.gov\.in)$/i;
const PRESSURE =
  /\b(suspended|suspend|(?:will be|has been|is) (?:blocked|deactivated)|kyc|pan (?:card )?(?:update|link)|verify|reward points?|claim|redeem|expir(?:e|es|ed|ing)|lottery|you have won|update (?:now|your|immediately)|click|tap here)\b/i;

function looksLikeScam(flat: string): boolean {
  if (!PRESSURE.test(flat)) return false;
  const links = [
    ...flat.matchAll(/\b(?:https?:\/\/|www\.)?((?:[a-z0-9-]+\.)+(?:[a-z]{2,6}))(?:\/\S*)?/gi),
  ]
    .filter(
      (m) =>
        /https?:\/\/|www\.|\//i.test(m[0]) ||
        /\.(?:ly|co|top|xyz|in|com|info|online|site|link)$/i.test(m[1]!),
    )
    .map((m) => m[1]!.toLowerCase().replace(/^www\./, ''))
    // "A/c", amounts like "Rs.4999", "a.b" initials are not sites.
    .filter((d) => /[a-z]{2,}\.[a-z]{2,}/.test(d) && !/^(rs|inr|no|a\/c|ac)\./.test(d));
  return links.some((d) => !TRUSTED_SITES.test(d));
}

/** Masked account number in the part of the text that names where money went or came from. */
function otherAccount(
  flat: string,
  direction: 'debit' | 'credit',
  own?: string,
): string | undefined {
  const word = direction === 'debit' ? /\bto\b/i : /\bfrom\b/i;
  const at = flat.search(word);
  if (at < 0) return undefined;
  const part = flat.slice(at, at + 48);
  const m =
    part.match(/(?:a\/?c|acct|account|ac)\s*(?:no\.?)?\s*[x*]*\s*(\d{3,6})\b/i) ??
    part.match(/\b[x*]{1,}(\d{3,6})\b/i);
  const last4 = m?.[1]?.slice(-4);
  return last4 && last4 !== own ? last4 : undefined;
}

/* ───────────────────────── main ───────────────────────── */

/**
 * Messaging apps add a link preview under messages with a URL (page title + description).
 * Drop trailing lines with no digits and no currency: they're never part of the alert.
 */
export function stripLinkPreview(input: string): string {
  const lines = input.replace(/\r/g, '').trim().split('\n');
  while (lines.length > 1 && !/\d|₹|\brs\b|\binr\b/i.test(lines[lines.length - 1]!)) lines.pop();
  return lines.join('\n').trim();
}

export function parseSms(input: string): ParsedSms {
  // SBI Card writes "𝗌𝗉𝖾𝗇𝗍" in maths letters: NFKC turns them back into plain "spent" (A28).
  const text = stripLinkPreview(input.normalize('NFKC'));
  const flat = text.replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  const base = (): ParsedSms => ({ kind: 'ignore', instrument: 'unknown', confidence: 0 });
  const bank = BANKS.find(([re]) => re.test(flat))?.[1];

  // 1. Never transactions.
  if (
    /\b(payment request|collect request|money request|has requested|is requesting|requested (?:money|payment|rs|inr|₹))\b/i.test(
      flat,
    ) &&
    !/\b(debited|credited|spent|deducted|sent|received in|paid to)\b/i.test(flat)
  )
    return { ...base(), reason: 'Payment request — nothing paid yet', bank };
  if (
    /\b(otp|one[- ]time password|verification code|passcode)\b/i.test(flat) &&
    !/\b(debited|credited|spent)\b/i.test(flat)
  )
    return { ...base(), reason: 'One-time password', bank };
  if (/\b(otp)\b/i.test(flat) && /do not share|valid for|is your/i.test(flat))
    return { ...base(), reason: 'One-time password', bank };
  if (
    /\b(declined|failed|unsuccessful|could not be processed|not been processed|insufficient (funds|balance|limit))\b/i.test(
      flat,
    ) &&
    !/\b(reversed|refund)\b/i.test(flat)
  )
    return { ...base(), reason: 'Declined or failed — no money moved', bank };
  if (looksLikeScam(flat)) return { ...base(), reason: 'Looks like a scam message', bank };
  // IPO money blocked (ASBA) and gift vouchers: nothing left your account yet (A21).
  if (
    /\b(asba|(?:is|has been|amount)\s+blocked|e-?vouchers?|gift card code)\b/i.test(flat) &&
    !/\b(debited|deducted|spent|withdrawn)\b/i.test(flat)
  )
    return { ...base(), reason: 'Blocked or voucher — no money moved', bank };

  // 2a. Card statement generated: tells us the statement day, due date and amount due.
  if (
    /\bstatement\b/i.test(flat) &&
    /\b(total\s*(?:amt\.?|amount)?\s*due|total\s*outstanding|amount\s*due|min(?:imum)?\.?\s*(?:amt\.?|amount)?\s*due)\b/i.test(
      flat,
    ) &&
    !/\b(debited|credited|spent|received|thank you for (?:your )?payment)\b/i.test(flat)
  ) {
    const num = (re: RegExp) => {
      const m = flat.match(re);
      return m ? toPaise(m[1]!) : undefined;
    };
    const totalDue = num(
      /(?:total\s*(?:amt\.?|amount)?\s*due|total\s*outstanding|(?<!min(?:imum)?\.?\s*(?:amt\.?|amount)?\s*)amount\s*due)\s*(?:is|of|:|-)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    );
    const minDue = num(
      /min(?:imum)?\.?\s*(?:amt\.?|amount)?\s*due\s*(?:is|of|:|-)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    );
    const dueAt = flat.match(
      /(?:(?:payment\s*)?due\s*(?:date|by|on)|payable\s*(?:by|on|before))\b\s*(?:is|:|-)?\s*(.{0,24})/i,
    );
    const { last4 } = findLast4(flat);
    return {
      ...base(),
      reason: 'Card statement',
      instrument: 'credit_card',
      last4,
      bank,
      date: findDate(flat.replace(dueAt?.[0] ?? '\u0000', ' ')),
      statement: { totalDue, minDue, dueDate: dueAt ? findDate(dueAt[1]!) : undefined },
    };
  }

  // 2. EMI conversion notices.
  const emi =
    flat.match(/convert(?:ed)?\s+(?:in)?to\s+(\d{1,2})\s*(?:month(?:ly)?\s*)?emis?/i) ??
    flat.match(/(\d{1,2})\s*months?\s*emi/i);
  if (emi && /\bemis?\b/i.test(flat) && !/\bemi\b.*\b(due|debited|paid)\b.*\bloan\b/i.test(flat)) {
    const per = flat.match(new RegExp(String.raw`emis?\s*(?:of)?\s*${AMOUNT}`, 'i'));
    const { last4, instrument } = findLast4(flat);
    return {
      kind: 'emi_notice',
      instrument,
      last4,
      bank,
      amount: findAmount(flat),
      emiMonths: Number(emi[1]),
      emiAmount: per ? toPaise(per[1]!) : undefined,
      merchant: findCounterparty(flat, 'debit').merchant,
      date: findDate(flat),
      confidence: 0.6,
    };
  }

  // 3. Autopay / mandate / standing-instruction notices (no money moved yet).
  const recurringWords =
    /\b(mandate|auto[- ]?pay|autodebit|auto[- ]debit|standing instruction|e-?mandate|\bsi\b|nach|ecs|recurring|subscription)\b/i;
  const futureWords =
    /\b(for processing|will be|shall be|is scheduled|scheduled|due on|upcoming|to be debited|pre-?debit|reminder|has been (?:successfully )?(?:created|registered|set ?up|activated|revoked|cancelled|paused)|successfully (?:created|registered|set ?up)|revoked|cancelled|paused)\b/i;
  if (
    recurringWords.test(flat) &&
    futureWords.test(flat) &&
    !/\b(has been|have been|was|is)\s+(successfully\s+)?debited\b/i.test(flat)
  ) {
    const { last4, instrument } = findLast4(flat);
    const freq = flat.match(
      /\b(daily|weekly|monthly|quarterly|half[- ]yearly|yearly|annually|as and when presented)\b/i,
    )?.[1];
    const on = flat.match(/\bon\s+(\d{1,2}[-/ ]?(?:[a-z]{3,4}|\d{1,2})[-/ ,]*'?\d{2,4})/i);
    return {
      kind: 'autopay_notice',
      instrument,
      last4,
      bank,
      isRecurring: true,
      amount: findAmount(flat),
      merchant: findCounterparty(flat, 'debit').merchant,
      scheduledDate: on ? findDate(on[1]!) : undefined,
      frequency: freq?.toLowerCase(),
      reason: /revoked|cancelled|paused/i.test(flat)
        ? 'Autopay cancelled or paused'
        : /created|registered|set ?up|activated/i.test(flat)
          ? 'New autopay set up'
          : 'Upcoming autopay debit',
      date: findDate(flat),
      confidence: 0.6,
    };
  }

  // 3a. Bill and EMI reminders: money that's due, not money that moved.
  const paidWords =
    /\b(debited|credited|spent|received|thank you|has been paid|was paid|paid successfully|successfully paid|deducted|withdrawn|sent|transferred|purchase)\b/i;
  if (
    /\b(is due|are due|due on|due by|due date|payable by|payment due|min(?:imum)?\.?\s*(?:amt\.?|amount)?\s*due|total\s*(?:amt\.?|amount)?\s*due|overdue)\b/i.test(
      flat,
    ) &&
    !paidWords.test(flat)
  ) {
    const { last4, instrument } = findLast4(flat);
    return {
      ...base(),
      reason: 'Payment reminder — not paid yet',
      instrument: /\bcard\b/i.test(flat) && instrument !== 'account' ? 'credit_card' : instrument,
      last4,
      bank,
    };
  }
  // "Will be debited" without a mandate: a heads-up, the money hasn't moved.
  const future =
    /\b(?:will|shall|to|would) be\s+(?:auto[- ]?)?(?:debited|deducted|charged|credited)\b/gi;
  if (
    future.test(flat) &&
    !/\b(debited|credited|spent|deducted|sent|paid)\b/i.test(flat.replace(future, ' '))
  )
    return { ...base(), reason: 'Heads-up — money not taken yet', bank, amount: findAmount(flat) };

  // 3b. Balance-only messages (balance enquiry replies, daily balance alerts): no payment, but
  // the balance keeps the account accurate.
  if (
    /\b(bal(?:ance)?|avl\.?\s*lmt|available\s*limit)\b/i.test(flat) &&
    !/\b(debited|credited|spent|sent|paid|received|withdrawn|deposited|transferred|purchase|added|loaded|top[- ]?up|refund|reversed|cashback)\b/i.test(
      flat,
    ) &&
    !SHORT_MOVE.test(flat) &&
    !/\b(offer|apply|eligible|pre-?approved|loan of|upgrade)\b/i.test(flat)
  ) {
    let b = findBalance(flat);
    if (b.balance === undefined) {
      // Balance-enquiry replies put words between "balance" and the amount:
      // "Available Bal in HDFC Bank A/c XX4521 as on 06-OCT-26 INR 2,71,534.00" (U-11).
      const m = flat.match(
        new RegExp(
          String.raw`\b(?:avl\.?|available|avail\.?|clear|total)?\s*(bal(?:ance)?|lmt|limit)\b.{0,70}?${AMOUNT}`,
          'i',
        ),
      );
      if (m) b = { balance: toPaise(m[2]!), isLimit: /lmt|limit/i.test(m[1]!) };
    }
    if (b.balance !== undefined) {
      const { last4, instrument } = findLast4(flat);
      return {
        ...base(),
        reason: 'Balance update',
        instrument,
        last4,
        bank,
        balance: b.balance,
        balanceIsLimit: b.isLimit,
        date: findDate(flat),
      };
    }
  }

  // 4. Promotions and info messages with no money movement.
  const moneyVerb =
    /\b(debited|credited|spent|sent|paid|received|withdrawn|deposited|transferred|purchase|txn|transaction|refund|reversed|reversal|cashback|payment|added to|loaded|top[- ]?up)\b/i;
  if (
    (!moneyVerb.test(flat) && !SHORT_MOVE.test(flat)) ||
    (/\b(pre-?approved|apply now|offer|click here|limited period|get up to|eligible for|upgrade your|win\b|lucky|congratulations|loan of|insta loan)\b/i.test(
      flat,
    ) &&
      !/\b(debited|credited|spent)\b/i.test(flat))
  )
    return { ...base(), reason: 'Promotion or information — no money moved', bank };

  // Autopay set-ups that take a small first charge: that charge is what moved, not the limit
  // ("activated … for Rs. 75000 … An initial amount of Rs. 2.00 has been debited").
  const initial = flat.match(
    new RegExp(String.raw`\binitial (?:amount|charge|debit|payment) of ${AMOUNT}`, 'i'),
  );
  const amount = initial ? toPaise(initial[1]!) : findAmount(flat);
  const fx = flat.match(FOREIGN);
  if (!amount && fx) {
    // Spent abroad / online in another currency: a real payment whose rupee amount we don't know
    // yet. It waits in the Inbox for you to type the ₹ amount from the card app or statement.
    const f = findLast4(flat);
    return {
      kind: 'debit',
      reason: `Spent in ${fx[1]} — enter the ₹ amount`,
      instrument: f.instrument,
      last4: f.last4,
      bank,
      date: findDate(flat),
      time: findTime(flat),
      merchant: findCounterparty(flat, 'debit').merchant,
      mode: 'card',
      foreign: { currency: fx[1]!, amount: Math.round(Number(fx[2]!.replace(/,/g, '')) * 100) },
      confidence: 0.4,
    };
  }
  if (!amount) return { ...base(), reason: 'No amount found', bank };

  const found = findLast4(flat);
  const walletName = /\bwallet\b/i.test(flat)
    ? WALLETS.find(([re]) => re.test(flat))?.[1]
    : /\b(?:apay|amazon\s?pay)\s+balance\b/i.test(flat)
      ? 'Amazon Pay' // "using Apay Balance … SMS by Juspay" (A8)
      : undefined;
  const date = findDate(flat);
  const ref = findRef(text);
  const { balance, isLimit } = findBalance(flat);

  // 5. Card issuer confirming a bill payment.
  if (
    /\b(payment|amount)\b.*\b(received|credited|realised|realized|successful|has been credited)\b/i.test(
      flat,
    ) &&
    /\b(credit\s*card|card (?:ending|no|xx|account)|card a\/c|your card)\b/i.test(flat) &&
    !/\b(refund|reversal|cashback|spent|purchase)\b/i.test(flat)
  ) {
    return {
      kind: 'card_payment',
      amount,
      instrument: 'credit_card',
      last4: found.last4,
      bank,
      date,
      time: findTime(flat),
      ref,
      mode: 'other',
      confidence: found.last4 ? 0.85 : 0.6,
    };
  }

  // 6. Direction: whichever money word appears first decides.
  const debitIdx = lower.search(
    /\b(debited|spent|sent|paid|withdrawn|purchase|deducted|charged|used at|txn of|transaction of|transferred from|trf from|dr\b|debit\b|payment successful|payment (?:of )?(?:inr|rs\.?|₹))/,
  );
  const creditIdx = lower.search(
    /\b(credited|received|deposited|refund|reversed|reversal|cashback|cr\b|added to|credit\s*:|credit (?:with amount|of|by|for)|has (?:a )?credit)|\dcredited/,
  );
  let direction: 'debit' | 'credit';
  if (debitIdx === -1 && creditIdx === -1)
    return { ...base(), reason: 'Couldn’t tell if money went in or out', bank, amount };
  if (debitIdx === -1) direction = 'credit';
  else if (creditIdx === -1) direction = 'debit';
  else direction = debitIdx < creditIdx ? 'debit' : 'credit';
  // "Jerry has received Rs 6000 from your A/c", "credited to the beneficiary": money out (A9).
  if (
    /\bhas received (?:inr|rs\.?|₹)?\s*[\d,.]+.{0,30}\bfrom your (?:a\/c|acc(?:oun)?t|card)\b/i.test(
      flat,
    ) ||
    /\bcredited to (?:the )?(?:beneficiary|payee)\b/i.test(flat)
  )
    direction = 'debit';
  // "Net interest INR 248 paid on your Deposit": interest earned, money in (A15).
  if (/\binterest\b.{0,30}\bpaid on your\b.{0,20}\b(?:deposit|fd|account|a\/c)\b/i.test(flat))
    direction = 'credit';
  // "Refund of Rs.. credited", "reversed" always mean money in.
  const isRefund = /\b(refund|refunded|reversed|reversal|chargeback)\b/i.test(flat);
  if (isRefund) direction = 'credit';
  const isCashback = /\bcashback\b/i.test(flat) && direction === 'credit';

  const isAtm =
    direction === 'debit' && /\b(atm|cash withdrawal|withdrawn at|cash w\/?d)\b/i.test(flat);
  const isWalletTopUp =
    /\b(upi lite|wallet)\b/i.test(flat) &&
    /\b(added|loaded|load money|top[- ]?up|topped up|auto[- ]?top[- ]?up|auto[- ]?load|recharged)\b/i.test(
      flat,
    ) &&
    !/\b(paid|payment to|spent|purchase)\b/i.test(flat);
  const isCardBillPayment =
    direction === 'debit' &&
    found.instrument !== 'credit_card' &&
    /\b(credit ?card|cc ?payment|card ?bill|billdesk.*card|cred\b|towards card)\b/i.test(flat);
  const isRecurring = recurringWords.test(flat);
  // Paid from a wallet: the digits in the text are usually a phone number, not an account.
  const paidByWallet = !!walletName && !isWalletTopUp;
  const instrument: Instrument = paidByWallet ? 'wallet' : found.instrument;
  const last4 = paidByWallet ? undefined : found.last4;

  const cp = isAtm
    ? { merchant: 'ATM withdrawal' }
    : findCounterparty(text.includes('\n') ? text : flat, direction);

  let mode: ParsedSms['mode'] = 'other';
  if (isAtm) mode = 'atm';
  else if (isRecurring) mode = 'auto_debit';
  else if (/\bupi\b|@|vpa/i.test(flat)) mode = 'upi';
  else if (instrument === 'credit_card' || instrument === 'debit_card' || /\bcard\b/i.test(flat))
    mode = 'card';
  else if (/\b(neft|imps|rtgs|net ?banking|netbanking)\b/i.test(flat)) mode = 'netbanking';

  const isSelfTransfer =
    /\b(to self|self transfer|own account|to your own|between your accounts)\b/i.test(flat);
  const otherLast4 = last4 || isSelfTransfer ? otherAccount(flat, direction, last4) : undefined;

  let confidence = 0.5;
  if (last4 || instrument === 'upi_lite' || paidByWallet) confidence += 0.25;
  if (date) confidence += 0.1;
  if (cp.merchant) confidence += 0.1;
  if (ref) confidence += 0.05;

  return {
    kind: direction,
    amount,
    instrument,
    last4,
    bank,
    date,
    time: findTime(flat),
    ref,
    balance,
    balanceIsLimit: isLimit,
    merchant: cp.merchant,
    vpa: cp.vpa,
    mode,
    isRefund,
    isCashback,
    isAtm,
    isWalletTopUp,
    walletName,
    isCardBillPayment,
    isRecurring,
    otherLast4,
    isSelfTransfer: isSelfTransfer || undefined,
    confidence: Math.min(1, confidence),
  };
}

/**
 * Split a pasted block into separate messages: blank lines separate messages; a block with no
 * blank lines but several lines that each look like a full alert is split per line.
 */
export function splitMessages(pasted: string): string[] {
  const blocks = pasted
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const b of blocks) {
    const lines = b
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const amountLines = lines.filter((l) => new RegExp(AMOUNT, 'i').test(l) && l.length > 40);
    if (lines.length > 1 && amountLines.length === lines.length) out.push(...lines);
    else out.push(b);
  }
  return out;
}
