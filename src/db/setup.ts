import { todayIST } from '../domain/dates';
import { assetDelta, counted } from '../domain/ledger';
import { discoverAccounts, type FoundAccount } from '../domain/sms/discover';
import { parseSms, splitMessages } from '../domain/sms/parse';
import type { Account, ID, ISODate, Paise } from '../domain/types';
import { stamp } from './db';
import { addAllReady, ingestCaptured, NOTIFICATION_APPS, type CapturedMessage } from './inbox';
import { db, getMeta, learnRule, saveAccount, setMeta } from './repo';
import { refreshCheckpoints } from './checkpoints';

/**
 * First launch from SMS: read the messages, propose accounts, create the ones you keep, then
 * add every payment those messages describe. Screens: SetupFromSms.tsx.
 */

/** Pasted text (browser) becomes the same shape as messages read on the phone. */
export function pastedToCaptured(text: string, receivedAt = todayIST()): CapturedMessage[] {
  const base = new Date(`${receivedAt}T12:00:00+05:30`).getTime();
  return splitMessages(text).map((body, i) => ({
    id: `paste-${i}`,
    source: 'paste',
    body,
    ts: base + i,
  }));
}

export function scanMessages(messages: CapturedMessage[]): FoundAccount[] {
  return discoverAccounts(
    messages.map((m) => {
      const parsed = parseSms(m.body);
      if (
        m.source === 'notification' &&
        !parsed.walletName &&
        m.sender &&
        NOTIFICATION_APPS[m.sender]
      )
        parsed.walletName = NOTIFICATION_APPS[m.sender];
      return {
        parsed,
        receivedAt: todayIST(new Date(m.ts)),
        ts: m.ts,
        dated: !m.id.startsWith('paste-'),
      };
    }),
  );
}

/** One row on the "We found N accounts" screen, after your edits. */
export interface SetupChoice {
  found: FoundAccount;
  keep: boolean;
  /** Debit card: fold into this other found account (its key). */
  mergeInto?: string;
  name: string;
}

export interface SetupResult {
  accounts: number;
  added: number;
  needYou: number;
}

/** Balance on `date` was `amount` after that day's payments, so start the day before them. */
async function calibrate(accountId: ID, amount: Paise, date: ISODate, liability: boolean) {
  const acc = await db.accounts.get(accountId);
  if (!acc) return;
  const txns = (await db.transactions.toArray()).filter((t) => counted(t) && t.date === date);
  const delta = txns.reduce((s, t) => s + assetDelta(t, accountId), 0);
  await db.accounts.put({
    ...acc,
    openingDate: date,
    openingBalance: liability ? amount + delta : amount - delta,
    updatedAt: stamp(),
  });
}

export async function finishSetup(
  choices: SetupChoice[],
  messages: CapturedMessage[],
  opts: {
    cash: boolean;
    onProgress?: (label: string, done: number, total: number) => void;
    /** Android capture filter the messages were read with (CaptureFilter.VERSION). */
    filterVersion?: number;
  },
): Promise<SetupResult> {
  const today = todayIST();
  const ids = new Map<string, ID>();
  const kept = choices.filter((c) => c.keep && !c.mergeInto);
  let order = await db.accounts.count();
  for (const c of kept) {
    const f = c.found;
    const draft: Omit<Account, 'id' | 'createdAt' | 'updatedAt'> = {
      name: c.name.trim() || f.name,
      kind: f.kind,
      institution: f.institution,
      last4: f.last4,
      openingBalance: 0,
      openingDate: f.firstSeen,
      archived: false,
      sortOrder: order++,
      ...(f.kind === 'credit_card'
        ? {
            card: {
              statementDay: f.statementDay ?? 1,
              dueDaysAfterStatement: f.dueDaysAfterStatement ?? 20,
              creditLimit: 0,
            },
          }
        : {}),
    };
    const a = await saveAccount(draft);
    ids.set(f.key, a.id);
  }
  // Cash starts with the oldest message, so ATM withdrawals in the scanned months count.
  const earliest = kept.reduce<ISODate>(
    (d, c) => (c.found.firstSeen < d ? c.found.firstSeen : d),
    today,
  );
  if (opts.cash && !(await db.accounts.toArray()).some((a) => a.kind === 'cash' && !a.deletedAt))
    await saveAccount({
      name: 'Cash',
      kind: 'cash',
      openingBalance: 0,
      openingDate: earliest,
      archived: false,
      sortOrder: order++,
    });

  // Merged debit cards: their number now points at the account they spend from.
  // Not-mine accounts: their messages are set aside instead of asking about them.
  const hints = await getMeta<Record<string, string>>('accountHints', {});
  const notMine = new Set(await getMeta<string[]>('notMine', []));
  for (const c of choices) {
    const last4 = c.found.last4;
    if (c.keep && c.mergeInto && ids.has(c.mergeInto) && last4)
      hints[`last4:${last4}`] = ids.get(c.mergeInto)!;
    if (!c.keep && last4) notMine.add(last4);
  }
  await setMeta('accountHints', hints);
  await setMeta('notMine', [...notMine]);
  await setMeta('autoAdd', true);

  // File every message, then add everything that's ready.
  const total = messages.length;
  for (let i = 0; i < total; i += 150) {
    await ingestCaptured(messages.slice(i, i + 150));
    opts.onProgress?.('Reading payments', Math.min(i + 150, total), total);
  }
  await setAsideNotMine();
  const added = await addAllReady((d, t) => opts.onProgress?.('Adding payments', d, t));

  // Cards: start from the last statement's amount due; then every balance the bank stated in a
  // message (bank/wallet balances, card available limits) re-anchors the account.
  for (const c of kept) {
    const id = ids.get(c.found.key)!;
    if (!c.found.balance && c.found.statementDue)
      await calibrate(id, c.found.statementDue.amount, c.found.statementDue.date, true);
  }
  await refreshCheckpoints();

  await setMeta('onboarded', true);
  await setMeta('quickSetupDone', true);
  // Setup just read the phone's messages through its filter: no need to read them again.
  if (opts.filterVersion) await setMeta('nativeFilterRead', opts.filterVersion);
  const needYou = await db.inbox.where('status').equals('new').count();
  return { accounts: kept.length + (opts.cash ? 1 : 0), added, needYou };
}

/** Messages about accounts you said aren't yours stay out of the Inbox. */
export async function setAsideNotMine(): Promise<number> {
  const notMine = new Set(await getMeta<string[]>('notMine', []));
  if (!notMine.size) return 0;
  const items = await db.inbox.where('status').equals('new').toArray();
  let n = 0;
  for (const i of items)
    if (i.parsed.last4 && notMine.has(i.parsed.last4)) {
      await db.inbox.update(i.id, {
        status: 'ignored',
        note: 'Not your account',
        updatedAt: stamp(),
      });
      n++;
    }
  return n;
}

/** Save your category for each shop: a rule for next time, and every past payment there. */
export async function sortShops(
  picks: { name: string; txnIds: ID[]; categoryId: ID }[],
): Promise<number> {
  let n = 0;
  for (const p of picks) {
    await learnRule(p.name, p.categoryId);
    for (const id of p.txnIds) {
      const t = await db.transactions.get(id);
      if (!t || t.splits) continue;
      await db.transactions.put({ ...t, categoryId: p.categoryId, updatedAt: stamp() });
      n++;
    }
  }
  return n;
}
