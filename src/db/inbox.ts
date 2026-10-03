import { PARSER_VERSION, parseSms, splitMessages } from '../domain/sms/parse';
import { accountHintKey, suggest, type Suggestion } from '../domain/sms/match';
import type { ID, InboxItem, InboxSource, ISODate, Transaction } from '../domain/types';
import { todayIST } from '../domain/dates';
import { newId, stamp } from './db';
import { db, getMeta, saveTransaction, setMeta } from './repo';

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

/** A message captured on the phone (see android/…/CaptureStore.java). */
export interface CapturedMessage {
  id: string;
  source: 'sms' | 'notification';
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

export const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Add every item that needs no decision: account known, not a duplicate. Payments to people
 * are added too (they count until you say otherwise) and flagged for one question.
 * Loads everything once, so a first import of hundreds of messages stays quick.
 */
export async function addAllReady(
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const items = await db.inbox.where('status').equals('new').toArray();
  if (!items.length) return 0;
  const base = await context(todayIST());
  const answers = await getMeta<PersonAnswers>('personAnswers', {});
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
          askLoan: !!s.person && answers[personKey(s.person)] !== 'spent',
        },
        { auto: true },
      );
      base.transactions.push(t);
      base.accountHints = { ...base.accountHints, [accountHintKey(item.parsed)]: s.accountId };
      n++;
    } else if (s.duplicateOf) {
      await db.inbox.update(item.id, {
        status: 'duplicate',
        duplicateOf: s.duplicateOf.id,
        note: s.duplicateReason,
        updatedAt: stamp(),
      });
    }
    if (onProgress && seen % 25 === 0) onProgress(seen, items.length);
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
 * After a parser upgrade, read again every message still waiting (or set aside by the parser,
 * not by you), so fixes apply to messages you already pasted.
 */
export async function reparseInboxIfNeeded(): Promise<number> {
  if ((await getMeta<number>('parserVersion', 0)) === PARSER_VERSION) return 0;
  const items = await db.inbox.toArray();
  let n = 0;
  for (const item of items) {
    if (
      item.status === 'added' ||
      item.note === 'Ignored by you' ||
      item.note === 'Notice dismissed'
    )
      continue;
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
      }
    }
    await db.inbox.update(item.id, { parsed, status, note, duplicateOf, updatedAt: stamp() });
    n++;
  }
  await setMeta('parserVersion', PARSER_VERSION);
  return n;
}
