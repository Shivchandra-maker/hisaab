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

/** A setup running in this session: the screen running it stays on screen, whatever the stage. */
let running: 'fresh' | 'resume' | null = null;

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
  // H-24: setup can be stopped half-way (app closed, phone killed it). Every stage is recorded so
  // the next open finishes the job instead of starting over, and accounts are never made twice.
  running = 'fresh';
  await setMeta('setupStage', 'accounts');
  if (opts.filterVersion) await setMeta('setupFilterVersion', opts.filterVersion);
  const existing = (await db.accounts.toArray()).filter((a) => !a.deletedAt);
  let order = existing.length;
  for (const c of kept) {
    const f = c.found;
    const same = sameAccount(existing, f);
    if (same) {
      ids.set(f.key, same.id);
      continue;
    }
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

  await setMeta('setupStage', 'reading');
  const r = await fileAndFinish(
    messages,
    opts.onProgress,
    kept.map((c) => c.found),
    ids,
  );
  return { accounts: kept.length + (opts.cash ? 1 : 0), ...r };
}

/** The account a found one already became (an earlier, interrupted setup). */
function sameAccount(accounts: Account[], f: FoundAccount): Account | undefined {
  return accounts.find(
    (a) =>
      a.kind === f.kind &&
      (f.last4
        ? a.last4 === f.last4
        : !a.last4 && (a.institution ?? '') === (f.institution ?? '') && a.name === f.name),
  );
}

/** File the messages, add what's ready, line balances up with the bank, mark setup done. */
async function fileAndFinish(
  messages: CapturedMessage[],
  onProgress: ((label: string, done: number, total: number) => void) | undefined,
  found: FoundAccount[],
  ids: Map<string, ID>,
): Promise<{ added: number; needYou: number }> {
  // Messages already filed are skipped by their text, so filing again after a stop is safe.
  const total = messages.length;
  for (let i = 0; i < total; i += 150) {
    await ingestCaptured(messages.slice(i, i + 150));
    onProgress?.('Reading payments', Math.min(i + 150, total), total);
  }
  await setMeta('setupStage', 'adding');
  await setAsideNotMine();
  const added = await addAllReady((d, t) => onProgress?.('Adding payments', d, t));

  // Cards: start from the last statement's amount due; then every balance the bank stated in a
  // message (bank/wallet balances, card available limits) re-anchors the account.
  for (const f of found) {
    const id = ids.get(f.key);
    const acc = id ? await db.accounts.get(id) : undefined;
    if (acc && !acc.check && !f.balance && f.statementDue)
      await calibrate(acc.id, f.statementDue.amount, f.statementDue.date, true);
  }
  await refreshCheckpoints();

  await setMeta('onboarded', true);
  await setMeta('quickSetupDone', true);
  // Setup just read the phone's messages through its filter: the one-time re-read after an
  // update only needs to look further back than setup did.
  const fv = await getMeta<number>('setupFilterVersion', 0);
  if (fv) await setMeta('nativeFilterRead2', fv);
  await setMeta('setupStage', 'done');
  running = null;
  const needYou = await db.inbox.where('status').equals('new').count();
  return { added, needYou };
}

/**
 * Was a setup from SMS stopped half-way? True when accounts were made but setup never finished
 * (also for installs from before setup kept its stage: accounts + auto-add on, not onboarded).
 */
export function setupInterrupted(meta: Record<string, unknown>, accounts: number): boolean {
  if (meta.onboarded === true) return false;
  if (running) return running === 'resume';
  const stage = meta.setupStage;
  if (stage === 'reading' || stage === 'adding') return true;
  return stage !== 'done' && accounts > 0 && meta.autoAdd === true;
}

/**
 * H-24: finish a setup that was stopped. `messages` are read again from the phone (pasted ones
 * can't be, but whatever was filed before the stop is still in the Inbox and gets added).
 */
export async function resumeSetup(
  messages: CapturedMessage[],
  onProgress?: (label: string, done: number, total: number) => void,
): Promise<{ added: number; needYou: number }> {
  running = 'resume';
  const found = scanMessages(messages);
  const accounts = (await db.accounts.toArray()).filter((a) => !a.deletedAt);
  const ids = new Map<string, ID>();
  for (const f of found) {
    const a = sameAccount(accounts, f);
    if (a) ids.set(f.key, a.id);
  }
  return fileAndFinish(messages, onProgress, found, ids);
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
