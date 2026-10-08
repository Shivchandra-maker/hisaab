import { PARSER_VERSION, parseSms, splitMessages } from '../domain/sms/parse';
import { accountHintKey, billCard, suggest, type Suggestion } from '../domain/sms/match';
import type { ID, InboxItem, InboxSource, ISODate, Transaction } from '../domain/types';
import { addDays, timeIST, todayIST } from '../domain/dates';
import { contactFor, contactsLoaded } from '../domain/people';
import { newId, stamp } from './db';
import { db, getMeta, saveTransaction, setMeta } from './repo';
import { personKey } from './needs';

/**
 * The Review inbox: messages go in (pasted now; read automatically by the Android app in
 * Phase 3), get parsed, and wait for one tap to become transactions.
 */

/** Stable hash of a message so pasting the same SMS twice never creates two items. */
export function messageHash(text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < norm.length; i++) {
    const c = norm.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${norm.length.toString(36)}`;
}

export interface IngestSummary {
  read: number;
  toReview: number;
  duplicates: number;
  ignored: number;
  notices: number;
  alreadySeen: number;
}

async function context(receivedAt: ISODate) {
  const [accounts, rules, transactions, accountHints] = await Promise.all([
    db.accounts.toArray(),
    db.rules.toArray(),
    db.transactions.toArray(),
    getMeta<Record<string, string>>('accountHints', {}),
  ]);
  return {
    accounts,
    rules,
    transactions: transactions.filter((t) => !t.deletedAt),
    receivedAt,
    accountHints,
  };
}

/**
 * One bank's debit and another's credit for the same move between your accounts: the side
 * already recorded becomes the transfer, so it's neither spending nor income.
 */
async function applyPair(s: Suggestion) {
  if (!s.pairTransfer || !s.duplicateOf) return;
  const t = await db.transactions.get(s.duplicateOf.id);
  if (!t || t.deletedAt) return;
  const upd: Partial<Transaction> = {
    kind: 'transfer',
    accountId: s.pairTransfer.accountId,
    toAccountId: s.pairTransfer.toAccountId,
    categoryId: undefined,
    splits: undefined,
    merchant: undefined,
    askLoan: undefined,
    note: t.note ?? 'Between your accounts',
    updatedAt: stamp(),
  };
  await db.transactions.put({ ...t, ...upd });
  // Keep the in-memory copy (used for the next messages in this batch) in step.
  Object.assign(s.duplicateOf, upd);
}

/** A message captured on the phone (see android/…/CaptureStore.java). */
export interface CapturedMessage {
  id: string;
  source: 'sms' | 'notification' | 'paste';
  sender?: string;
  body: string;
  /** Arrival time in ms since epoch. */
  ts: number;
}

const emptySummary = (): IngestSummary => ({
  read: 0,
  toReview: 0,
  duplicates: 0,
  ignored: 0,
  notices: 0,
  alreadySeen: 0,
});

/**
 * Version of the Android capture filter (CaptureFilter.java). 2 = wide filter (H-01): after an
 * update from 1, the phone's messages are read again once (native/capture.ts).
 */
export const CAPTURE_FILTER_VERSION = 2;

/** Payment apps whose notifications we read, by Android package. */
export const NOTIFICATION_APPS: Record<string, string> = {
  'com.phonepe.app': 'PhonePe',
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'net.one97.paytm': 'Paytm',
  'in.org.npci.upiapp': 'BHIM',
  'com.dreamplug.androidapp': 'CRED',
  'in.amazon.mShop.android.shopping': 'Amazon',
};

/** Minutes within which an SMS and an app notification for the same amount are one payment. */
const PAIR_WINDOW_MS = 20 * 60_000;

async function ingestOne(
  raw: string,
  opts: { source: InboxSource; receivedAt: ISODate; receivedTs?: number; sender?: string },
  ctx: Awaited<ReturnType<typeof context>>,
  summary: IngestSummary,
  now: string,
) {
  const rawText = raw.trim();
  if (!rawText) return;
  summary.read++;
  const hash = messageHash(rawText);
  if (await db.inbox.where('hash').equals(hash).first()) {
    summary.alreadySeen++;
    return;
  }
  const parsed = parseSms(rawText);
  // Notifications rarely name the account; remember choices per app instead.
  if (
    opts.source === 'notification' &&
    !parsed.walletName &&
    opts.sender &&
    NOTIFICATION_APPS[opts.sender]
  )
    parsed.walletName = NOTIFICATION_APPS[opts.sender];
  const item: InboxItem = {
    id: newId(),
    source: opts.source,
    rawText,
    hash,
    receivedAt: opts.receivedAt,
    receivedTs: opts.receivedTs,
    sender: opts.sender,
    parsed,
    status: 'new',
    createdAt: now,
    updatedAt: now,
  };
  if (parsed.kind === 'ignore') {
    item.status = 'ignored';
    item.note = parsed.reason;
    summary.ignored++;
  } else if (parsed.kind === 'autopay_notice' || parsed.kind === 'emi_notice') {
    item.status = 'notice';
    item.note = parsed.kind === 'emi_notice' ? 'EMI conversion' : parsed.reason;
    summary.notices++;
  } else {
    const twin =
      opts.receivedTs && parsed.amount
        ? (await db.inbox.where('status').anyOf('new', 'added').toArray()).find(
            (o) =>
              o.source !== opts.source &&
              o.receivedTs !== undefined &&
              Math.abs(o.receivedTs - opts.receivedTs!) <= PAIR_WINDOW_MS &&
              o.parsed.amount === parsed.amount,
          )
        : undefined;
    const s = twin ? undefined : suggest(parsed, ctx);
    if (twin) {
      item.status = 'duplicate';
      item.duplicateOf = twin.txnId;
      item.note = 'Same payment from a bank SMS and an app notification';
      summary.duplicates++;
    } else if (s?.duplicateOf) {
      item.status = 'duplicate';
      item.duplicateOf = s.duplicateOf.id;
      item.note = s.duplicateReason;
      summary.duplicates++;
      await applyPair(s);
    } else {
      summary.toReview++;
    }
  }
  await db.inbox.add(item);
}

export async function ingestMessages(
  input: string | string[],
  opts: { source?: InboxSource; receivedAt: ISODate },
): Promise<IngestSummary> {
  const texts = Array.isArray(input) ? input : splitMessages(input);
  const summary = emptySummary();
  const ctx = await context(opts.receivedAt);
  const now = stamp();
  for (const raw of texts)
    await ingestOne(
      raw,
      { source: opts.source ?? 'paste', receivedAt: opts.receivedAt },
      ctx,
      summary,
      now,
    );
  return summary;
}

/** File messages captured on the phone, oldest first, each with its real arrival time. */
export async function ingestCaptured(items: CapturedMessage[]): Promise<IngestSummary> {
  const summary = emptySummary();
  const now = stamp();
  const sorted = [...items].sort((a, b) => a.ts - b.ts);
  const ctx = await context(todayIST());
  for (const m of sorted) {
    const receivedAt = todayIST(new Date(m.ts));
    await ingestOne(
      m.body,
      { source: m.source, receivedAt, receivedTs: m.ts, sender: m.sender },
      { ...ctx, receivedAt },
      summary,
      now,
    );
  }
  return summary;
}

/** Recompute the suggestion for an item against current accounts, rules and transactions. */
export async function suggestionFor(item: InboxItem): Promise<Suggestion> {
  return suggest(item.parsed, await context(item.receivedAt));
}

export interface AddInput {
  kind: Transaction['kind'];
  amount: number;
  date: ISODate;
  accountId: ID;
  toAccountId?: ID;
  categoryId?: ID;
  merchant?: string;
  paymentMode?: Transaction['paymentMode'];
  externalRef?: string;
  note?: string;
  /** Payment to/from a person: ask "Spent, lent or paid back?" in the Inbox. */
  askLoan?: boolean;
  time?: string;
}

/**
 * Card-bill payments added before billCard() existed may sit on the wrong card (U-16). Once, look
 * again at each one Hisaab added from a bank SMS and move it when the bill amount says otherwise.
 */
export async function recheckBillPayments(): Promise<number> {
  if (await getMeta<boolean>('billCardsRechecked', false)) return 0;
  const [items, accounts, all] = await Promise.all([
    db.inbox.where('status').equals('added').toArray(),
    db.accounts.toArray(),
    db.transactions.toArray(),
  ]);
  const live = accounts.filter((a) => !a.deletedAt && !a.archived);
  let n = 0;
  for (const i of items) {
    if (!i.txnId || !i.parsed.isCardBillPayment) continue;
    const t = all.find((x) => x.id === i.txnId);
    if (!t || t.deletedAt || t.kind !== 'transfer' || t.source !== 'sms') continue;
    const others = all.filter((x) => x.id !== t.id && !x.deletedAt);
    // Strict: move it only when the card number or the exact bill amount says so — a card you
    // picked yourself is never overruled by a guess.
    const card = billCard(i.parsed, t.amount, t.date, live, others, t.accountId, true);
    if (card && card.id !== t.toAccountId) {
      await db.transactions.update(t.id, { toAccountId: card.id, updatedAt: stamp() });
      t.toAccountId = card.id;
      n++;
    }
  }
  await setMeta('billCardsRechecked', true);
  return n;
}

/** Older payments added from messages get their time of day once (U-15). */
export async function backfillTimes(): Promise<number> {
  if (await getMeta<boolean>('timesBackfilled', false)) return 0;
  const items = await db.inbox.where('status').equals('added').toArray();
  let n = 0;
  for (const i of items) {
    if (!i.txnId) continue;
    const t = await db.transactions.get(i.txnId);
    if (!t || t.time) continue;
    const time = timeForItem(
      { ...i, parsed: { ...i.parsed, time: parseSms(i.rawText).time } },
      t.date,
    );
    if (!time) continue;
    await db.transactions.update(t.id, { time });
    n++;
  }
  await setMeta('timesBackfilled', true);
  return n;
}

/**
 * When the payment happened, if we can tell: the time in the message, else when the SMS arrived
 * (same day only — banks send alerts within seconds). Pasted text has no real arrival time.
 */
export function timeForItem(item: InboxItem, date: ISODate): string | undefined {
  if (item.parsed.time && (!item.parsed.date || item.parsed.date === date)) return item.parsed.time;
  if (item.source === 'paste' || !item.receivedTs) return undefined;
  return todayIST(new Date(item.receivedTs)) === date ? timeIST(item.receivedTs) : undefined;
}

/** Turn an inbox item into a confirmed transaction (and teach the merchant rule). */
export async function addFromInbox(
  itemId: ID,
  input: AddInput,
  opts: { auto?: boolean } = {},
): Promise<Transaction> {
  const item = await db.inbox.get(itemId);
  if (!item) throw new Error('Message not found.');
  const t = await saveTransaction(
    {
      ...input,
      time: input.time ?? timeForItem(item, input.date),
      tags: [],
      source: item.source === 'paste' ? 'sms' : item.source,
      status: 'confirmed',
      rawText: item.rawText,
    },
    { learn: !opts.auto },
  );
  await db.inbox.update(itemId, { status: 'added', txnId: t.id, updatedAt: stamp() });
  // Remember which account messages like this belong to, for ones that don't say.
  const hints = await getMeta<Record<string, string>>('accountHints', {});
  const key = accountHintKey(item.parsed);
  if (hints[key] !== input.accountId)
    await setMeta('accountHints', { ...hints, [key]: input.accountId });
  return t;
}

/** People you told us about: "spent" = treat payments to them as spending without asking. */
export type PersonAnswers = Record<string, 'spent' | 'lent' | 'borrowed'>;

export { personKey };

/** Ask about payments of at least this much (smaller ones to friends are usually shared costs). */
export const LOAN_ASK_MIN = 50_000;
/** Only recent payments ask; older history goes in as spending. */
export const LOAN_RECENT_DAYS = 30;

export type Flows = Map<string, { out: boolean; in: boolean }>;

/** Which people money went to and came from (two-way money is the strongest loan signal). */
export function loanFlows(txns: Transaction[]): Flows {
  const m: Flows = new Map();
  for (const t of txns) addFlow(m, t);
  return m;
}

function addFlow(m: Flows, t: Pick<Transaction, 'kind' | 'merchant' | 'flow'>) {
  if (!t.merchant) return;
  const out = t.kind === 'expense' || (t.kind === 'debt' && t.flow === 'out');
  const inn = t.kind === 'income' || (t.kind === 'debt' && t.flow === 'in');
  if (!out && !inn) return;
  const k = personKey(t.merchant);
  const f = m.get(k) ?? { out: false, in: false };
  m.set(k, { out: f.out || out, in: f.in || inn });
}

/**
 * "Spent or lent?" is asked only when it's likely to matter: the payee is one of your contacts,
 * the payment is recent, and it's either ₹500+ or money has gone both ways with that person.
 * People you've said "spent" for are never asked again.
 */
export function shouldAskLoan(
  t: Pick<Transaction, 'kind' | 'amount' | 'date' | 'merchant'>,
  vpa: string | undefined,
  today: ISODate,
  answers: PersonAnswers,
  flows: Flows,
): boolean {
  if (t.kind !== 'expense' && t.kind !== 'income') return false;
  if (!contactsLoaded() || t.date < addDays(today, -LOAN_RECENT_DAYS)) return false;
  const contact = contactFor(t.merchant, vpa);
  if (!contact) return false;
  const a = answers[personKey(t.merchant ?? contact)];
  if (a === 'spent') return false;
  if (a === 'lent' || a === 'borrowed') return true;
  const f = flows.get(personKey(t.merchant ?? contact));
  return t.amount >= LOAN_ASK_MIN || (!!f && f.out && f.in);
}

/** One run at a time: the app, capture sync and setup can all ask at once (D-01). */
let addQueue: Promise<unknown> = Promise.resolve();

export function addAllReady(onProgress?: (done: number, total: number) => void): Promise<number> {
  const run = addQueue.then(() => addAllReadyNow(onProgress));
  addQueue = run.catch(() => undefined);
  return run;
}

async function addAllReadyNow(onProgress?: (done: number, total: number) => void): Promise<number> {
  const items = (await db.inbox.where('status').equals('new').toArray()).sort(
    (a, b) =>
      (a.parsed.date ?? a.receivedAt).localeCompare(b.parsed.date ?? b.receivedAt) ||
      (a.receivedTs ?? 0) - (b.receivedTs ?? 0),
  );
  if (!items.length) return 0;
  const base = await context(todayIST());
  const answers = await getMeta<PersonAnswers>('personAnswers', {});
  const flows = loanFlows(base.transactions);
  const today = todayIST();
  let n = 0;
  let seen = 0;
  for (const item of items) {
    seen++;
    const s = suggest(item.parsed, { ...base, receivedAt: item.receivedAt });
    if (s.ready && s.accountId) {
      const t = await addFromInbox(
        item.id,
        {
          kind: s.kind,
          amount: s.amount,
          date: s.date,
          accountId: s.accountId,
          toAccountId: s.toAccountId,
          categoryId: s.categoryId,
          merchant: s.merchant,
          paymentMode: s.paymentMode,
          externalRef: s.externalRef,
          askLoan:
            shouldAskLoan(
              { kind: s.kind, amount: s.amount, date: s.date, merchant: s.merchant },
              item.parsed.vpa,
              today,
              answers,
              flows,
            ) || undefined,
        },
        { auto: true },
      );
      base.transactions.push(t);
      addFlow(flows, t);
      base.accountHints = { ...base.accountHints, [accountHintKey(item.parsed)]: s.accountId };
      n++;
    } else if (s.duplicateOf) {
      await db.inbox.update(item.id, {
        status: 'duplicate',
        duplicateOf: s.duplicateOf.id,
        note: s.duplicateReason,
        updatedAt: stamp(),
      });
      await applyPair(s);
    }
    if (onProgress && seen % 25 === 0) onProgress(seen, items.length);
  }
  // Second look at what's left: a message can match one that came after it (the bank's "paid
  // to CRED" before the card's "payment received", one side of a transfer before the other).
  for (const item of items) {
    const now = await db.inbox.get(item.id);
    if (now?.status !== 'new') continue;
    const s = suggest(item.parsed, { ...base, receivedAt: item.receivedAt });
    if (!s.duplicateOf) continue;
    await db.inbox.update(item.id, {
      status: 'duplicate',
      duplicateOf: s.duplicateOf.id,
      note: s.duplicateReason,
      updatedAt: stamp(),
    });
    await applyPair(s);
  }
  onProgress?.(items.length, items.length);
  return n;
}

export const ignoreInboxItem = (id: ID, note = 'Ignored by you') =>
  db.inbox.update(id, { status: 'ignored', note, updatedAt: stamp() });

/** Bring an ignored or duplicate item back for review. */
export const restoreInboxItem = (id: ID) =>
  db.inbox.update(id, {
    status: 'new',
    duplicateOf: undefined,
    note: undefined,
    updatedAt: stamp(),
  });

export const dismissNotice = (id: ID) =>
  db.inbox.update(id, { status: 'ignored', note: 'Notice dismissed', updatedAt: stamp() });

/** Remove handled items older than `days` (keeps the inbox light; transactions are untouched). */
export async function clearHandled(): Promise<number> {
  const handled = await db.inbox.where('status').anyOf('added', 'ignored', 'duplicate').toArray();
  await db.inbox.bulkDelete(handled.map((i) => i.id));
  return handled.length;
}

/**
 * A message added automatically that the new parser says moved no money (a bill reminder, a
 * scam, a heads-up): remove its transaction, unless you've changed the amount or kind since.
 */
async function undoWrongAdd(item: InboxItem, parsed: InboxItem['parsed']): Promise<boolean> {
  if (parsed.kind !== 'ignore' && parsed.kind !== 'autopay_notice' && parsed.kind !== 'emi_notice')
    return false;
  const t = item.txnId ? await db.transactions.get(item.txnId) : undefined;
  if (
    t &&
    !t.deletedAt &&
    (t.source === 'sms' || t.source === 'notification') &&
    t.amount === item.parsed.amount &&
    (t.kind === 'expense' || t.kind === 'income' || t.kind === 'refund')
  )
    await db.transactions.update(t.id, { deletedAt: stamp(), updatedAt: stamp() });
  else if (t && !t.deletedAt) return false;
  await db.inbox.update(item.id, {
    parsed,
    status: parsed.kind === 'ignore' ? 'ignored' : 'notice',
    note: `${parsed.reason ?? 'Not a payment'} — removed`,
    updatedAt: stamp(),
  });
  return true;
}

/**
 * After a parser upgrade, read again every message still waiting (or set aside by the parser,
 * not by you), so fixes apply to messages you already pasted. Payments added automatically
 * from messages that turn out not to be payments are taken back out.
 */
export async function reparseInboxIfNeeded(): Promise<number> {
  if ((await getMeta<number>('parserVersion', 0)) === PARSER_VERSION) return 0;
  const items = await db.inbox.toArray();
  let n = 0;
  for (const item of items) {
    if (item.note === 'Ignored by you' || item.note === 'Notice dismissed') continue;
    if (item.status === 'added') {
      if (await undoWrongAdd(item, parseSms(item.rawText))) n++;
      continue;
    }
    const parsed = parseSms(item.rawText);
    const ctx = await context(item.receivedAt);
    let status: InboxItem['status'] = 'new';
    let note: string | undefined;
    let duplicateOf: string | undefined;
    if (parsed.kind === 'ignore') {
      status = 'ignored';
      note = parsed.reason;
    } else if (parsed.kind === 'autopay_notice' || parsed.kind === 'emi_notice') {
      status = 'notice';
      note = parsed.kind === 'emi_notice' ? 'EMI conversion' : parsed.reason;
    } else {
      const s = suggest(parsed, ctx);
      if (s.duplicateOf) {
        status = 'duplicate';
        duplicateOf = s.duplicateOf.id;
        note = s.duplicateReason;
        await applyPair(s);
      }
    }
    await db.inbox.update(item.id, { parsed, status, note, duplicateOf, updatedAt: stamp() });
    n++;
  }
  await setMeta('parserVersion', PARSER_VERSION);
  return n;
}
