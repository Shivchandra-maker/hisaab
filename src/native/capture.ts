import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  addAllReady,
  CAPTURE_FILTER_VERSION,
  ingestCaptured,
  reparseInboxIfNeeded,
  type CapturedMessage,
  type IngestSummary,
} from '../db/inbox';
import { db, getMeta, setMeta } from '../db/repo';
import { needsDupCheck } from '../db/needs';
import { isDemo } from '../db/demo';
import { reviewLoanQuestions } from '../db/loans';
import { refreshCheckpoints } from '../db/checkpoints';
import { setContacts, type Contact } from '../domain/people';

/**
 * Web side of automatic capture. In the Android app, native code (android/app/src/main/java/
 * app/hisaab/) queues bank SMS and payment notifications; this file pulls the queue into the
 * Inbox whenever the app opens, resumes, or a new message arrives while it's open.
 * In a normal browser everything here is a no-op.
 */

export interface CaptureStatus {
  sms: boolean;
  notifications: boolean;
  notificationAccess: boolean;
  pending: number;
  notify: boolean;
  apps: string[];
  contacts?: boolean;
  /** Version of the Android part (CapturePlugin.NATIVE_VERSION); missing on APKs before 3. */
  nativeVersion?: number;
  /** CaptureFilter.VERSION; missing before 2. */
  filterVersion?: number;
}

/** The Android part this web code expects. Older = the APK was built without the latest android/ files. */
export const EXPECTED_NATIVE_VERSION = 4;

interface HisaabCapturePlugin {
  status(): Promise<CaptureStatus>;
  requestSms(): Promise<CaptureStatus>;
  requestNotifications(): Promise<CaptureStatus>;
  openNotificationAccess(): Promise<void>;
  readInbox(opts: { sinceMs: number; limit?: number }): Promise<{ messages: CapturedMessage[] }>;
  getPending(): Promise<{ items: CapturedMessage[] }>;
  ack(opts: { ids: string[] }): Promise<void>;
  setOptions(opts: { apps?: string[]; notify?: boolean }): Promise<CaptureStatus>;
  takeRoute(): Promise<{ route: string }>;
  requestContacts(): Promise<CaptureStatus>;
  readContacts(): Promise<{ contacts: Contact[] }>;
  openAppSettings(): Promise<void>;
  setBars(opts: { dark: boolean }): Promise<void>;
  addListener(event: 'captured' | 'route', fn: () => void): Promise<PluginListenerHandle>;
}

export const isAndroidApp = Capacitor.getPlatform() === 'android';
export const Capture = registerPlugin<HisaabCapturePlugin>('HisaabCapture');

let syncing: Promise<IngestSummary | null> | null = null;

/** Move everything the phone captured into the Inbox. Safe to call often. */
export function syncCaptured(): Promise<IngestSummary | null> {
  // The sample database never takes your real messages: they wait in the phone's queue for you.
  if (!isAndroidApp || isDemo) return Promise.resolve(null);
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { items } = await Capture.getPending();
      if (!items.length) return null;
      const summary = await ingestCaptured(items);
      await Capture.ack({ ids: items.map((i) => i.id) });
      if (await getMeta<boolean>('autoAdd', true)) await addAllReady();
      await refreshCheckpoints();
      return summary;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/**
 * Read contacts (if allowed) so "Spent or lent?" is only asked about people you know, then
 * re-check waiting questions. Without contacts we never ask.
 */
export async function loadContacts(): Promise<boolean> {
  if (!isAndroidApp) return false;
  try {
    const st = await Capture.status();
    if (st.contacts) {
      const { contacts } = await Capture.readContacts();
      setContacts(contacts);
    }
    await reviewLoanQuestions();
    return !!st.contacts;
  } catch {
    return false;
  }
}

/**
 * Ask for contacts. `blocked` = Android won't show the dialog any more (you chose "Don't allow"
 * before): only App info → Permissions can turn it on. `update` = this APK's Android part is too
 * old to ask at all.
 */
export type ContactsResult = 'granted' | 'denied' | 'blocked' | 'update';

export async function requestContacts(): Promise<ContactsResult> {
  if (!isAndroidApp) return 'denied';
  try {
    const before = await Capture.status();
    if ((before.nativeVersion ?? 0) < EXPECTED_NATIVE_VERSION && before.contacts === undefined)
      return 'update';
    const t0 = Date.now();
    const st = await Capture.requestContacts();
    if (st.contacts) {
      await loadContacts();
      return 'granted';
    }
    // An answer faster than a person can tap means Android didn't show the dialog at all.
    return Date.now() - t0 < 400 ? 'blocked' : 'denied';
  } catch (e) {
    // Only a missing method means an old APK; anything else is a plain "not allowed".
    return (e as { code?: string })?.code === 'UNIMPLEMENTED' ? 'update' : 'denied';
  }
}

export const openAppSettings = () => Capture.openAppSettings().catch(() => undefined);

/** Status and navigation bars follow the app's own light/dark theme. */
export function setSystemBars(dark: boolean) {
  if (isAndroidApp) void Capture.setBars({ dark }).catch(() => undefined);
}

/**
 * Pull-to-refresh: Android sometimes stops the app before it hears a new SMS. Re-read the last
 * few days of bank messages; ones already seen are skipped by their text.
 */
export async function catchUp(days = 3): Promise<number> {
  if (!isAndroidApp || isDemo) return 0;
  await syncCaptured().catch(() => null);
  const st = await Capture.status();
  if (!st.sms) return 0;
  const { messages } = await Capture.readInbox({
    sinceMs: Date.now() - days * 86_400_000,
    limit: 2000,
  });
  const s = await ingestCaptured(messages);
  const added = (await getMeta<boolean>('autoAdd', true)) ? await addAllReady() : 0;
  await refreshCheckpoints();
  return added || s.toReview;
}

/**
 * Older versions of the Android filter dropped many real alerts ("Sent Rs…", "Your txn of ₹…",
 * reversals, SIPs). Once after updating, read the same months as setup again; messages already
 * filed are skipped by their text, so only the missed ones are added.
 */
export async function rescanAfterFilterUpgrade(): Promise<number> {
  if (!isAndroidApp || isDemo) return 0;
  // Keyed on the filter the phone actually runs: an APK built without the new android/ files
  // still has the old filter, and re-reading through it would miss the same messages again.
  const st = await Capture.status();
  const native = st.filterVersion ?? 1;
  if (native < CAPTURE_FILTER_VERSION) return 0;
  // Android parts before 4 read only 30 days whatever was asked; wait for one that reads it all.
  if ((st.nativeVersion ?? 0) < 4) return 0;
  if ((await getMeta<number>('nativeFilterRead2', 1)) >= native) return 0;
  await reparseInboxIfNeeded(); // apply the new parser to what's already filed first
  if (!(await getMeta<boolean>('quickSetupDone', false))) {
    await setMeta('nativeFilterRead2', native);
    return 0;
  }
  if (!st.sms) return 0; // try again once SMS is allowed
  // A year: earlier imports stopped at 30 days even when "1 year" was chosen.
  const { messages } = await Capture.readInbox({ sinceMs: Date.now() - 365 * DAY, limit: 20_000 });
  const sorted = [...messages].sort((a, b) => a.ts - b.ts);
  let fresh = 0;
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const s = await ingestCaptured(sorted.slice(i, i + CHUNK));
    fresh += s.read - s.alreadySeen;
  }
  if (await getMeta<boolean>('autoAdd', true)) await addAllReady();
  await refreshCheckpoints();
  await setMeta('nativeFilterRead2', native);
  return fresh;
}

/** How far back the one-time import reads. */
export type ImportRange = '7d' | '30d' | '1y' | 'all';

export const IMPORT_RANGES: { value: ImportRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All' },
];

const DAY = 86_400_000;

export function rangeStart(range: ImportRange, now = Date.now()): number {
  if (range === 'all') return 0;
  return now - (range === '7d' ? 7 : range === '30d' ? 30 : 365) * DAY;
}

const CHUNK = 150;

/**
 * One-time import of bank messages already on the phone. Files them in chunks so the screen
 * can show progress; messages seen before are skipped by their text hash.
 */
export async function importPastMessages(
  range: ImportRange,
  onProgress?: (done: number, total: number) => void,
): Promise<IngestSummary> {
  if (isDemo) throw new Error('Switch back to your own data to read messages.');
  const { messages } = await Capture.readInbox({
    sinceMs: rangeStart(range),
    limit: range === 'all' ? 20_000 : 10_000,
  });
  const total = emptyTotals();
  onProgress?.(0, messages.length);
  // Oldest first, so later messages can pair with earlier ones (card bill paid ↔ received).
  const sorted = [...messages].sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < sorted.length; i += CHUNK) {
    addTotals(total, await ingestCaptured(sorted.slice(i, i + CHUNK)));
    onProgress?.(Math.min(i + CHUNK, sorted.length), sorted.length);
  }
  if (await getMeta<boolean>('autoAdd', true)) await addAllReady();
  await refreshCheckpoints();
  return total;
}

const emptyTotals = (): IngestSummary => ({
  read: 0,
  toReview: 0,
  duplicates: 0,
  ignored: 0,
  notices: 0,
  alreadySeen: 0,
});

function addTotals(a: IngestSummary, b: IngestSummary) {
  for (const k of Object.keys(a) as (keyof IngestSummary)[]) a[k] += b[k];
}

/** Where a tap on "₹292 to Swiggy" should land once the message is filed. */
export type CaptureTarget = { txnId: string } | { route: 'inbox' | 'transactions' };

/**
 * The newest captured message decides: added → open that payment; waiting for you → Inbox;
 * set aside (duplicate, notice) → Activity.
 */
export async function captureTarget(now = Date.now()): Promise<CaptureTarget> {
  if (await getMeta<boolean>('autoAdd', true)) await addAllReady().catch(() => 0);
  const recent = (await db.inbox.toArray())
    .filter((i) => i.source !== 'paste' && (i.receivedTs ?? 0) > now - 2 * DAY)
    .sort((a, b) => (b.receivedTs ?? 0) - (a.receivedTs ?? 0));
  const last = recent[0];
  if (!last) return { route: 'transactions' };
  if (last.status === 'added' && last.txnId) {
    const t = await db.transactions.get(last.txnId);
    if (t && !t.deletedAt) return t.askLoan ? { route: 'inbox' } : { txnId: t.id };
  }
  if (last.status === 'new' || needsDupCheck(last)) return { route: 'inbox' };
  return { route: 'transactions' };
}

/**
 * Start listening. `onNew` is told how many messages arrived; `onOpen` opens the payment (or a
 * screen) when a capture notification was tapped. Returns a stop function.
 */
export function startCapture(
  onNew: (s: IngestSummary) => void,
  onOpen: (target: CaptureTarget) => void,
): () => void {
  if (!isAndroidApp || isDemo) return () => {};
  const handles: Promise<PluginListenerHandle>[] = [];
  void loadContacts();
  const run = async () => {
    // Read the tap first: a later resume must not replay it.
    const { route } = await Capture.takeRoute().catch(() => ({ route: '' }));
    const s = await syncCaptured().catch(() => null);
    if (route === 'capture')
      onOpen(await captureTarget().catch(() => ({ route: 'inbox' as const })));
    else if (route) onOpen({ route: route === 'inbox' ? 'inbox' : 'transactions' });
    else if (s && (s.toReview || s.duplicates || s.notices)) onNew(s);
  };
  void run().then(() => rescanAfterFilterUpgrade().catch(() => 0));
  handles.push(Capture.addListener('captured', () => void run()));
  handles.push(Capture.addListener('route', () => void run()));
  handles.push(App.addListener('resume', () => void run()));
  return () => handles.forEach((h) => void h.then((x) => x.remove()));
}

/** Android back button: close sheets first, then go back, then leave the app. */
export function handleBackButton(onBack: () => boolean): () => void {
  if (!isAndroidApp) return () => {};
  const h = App.addListener('backButton', () => {
    if (onBack()) return;
    if (window.location.hash && window.location.hash !== '#home') window.history.back();
    else void App.minimizeApp();
  });
  return () => void h.then((x) => x.remove());
}
