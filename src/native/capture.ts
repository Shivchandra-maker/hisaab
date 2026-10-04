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
import { getMeta, setMeta } from '../db/repo';
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
}

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
  addListener(event: 'captured', fn: () => void): Promise<PluginListenerHandle>;
}

export const isAndroidApp = Capacitor.getPlatform() === 'android';
export const Capture = registerPlugin<HisaabCapturePlugin>('HisaabCapture');

let syncing: Promise<IngestSummary | null> | null = null;

/** Move everything the phone captured into the Inbox. Safe to call often. */
export function syncCaptured(): Promise<IngestSummary | null> {
  if (!isAndroidApp) return Promise.resolve(null);
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

export async function requestContacts(): Promise<boolean> {
  if (!isAndroidApp) return false;
  const st = await Capture.requestContacts();
  if (st.contacts) await loadContacts();
  return !!st.contacts;
}

/**
 * Pull-to-refresh: Android sometimes stops the app before it hears a new SMS. Re-read the last
 * few days of bank messages; ones already seen are skipped by their text.
 */
export async function catchUp(days = 3): Promise<number> {
  if (!isAndroidApp) return 0;
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
  if (!isAndroidApp) return 0;
  if ((await getMeta<number>('captureFilterVersion', 1)) >= CAPTURE_FILTER_VERSION) return 0;
  await reparseInboxIfNeeded(); // apply the new parser to what's already filed first
  if (!(await getMeta<boolean>('quickSetupDone', false))) {
    await setMeta('captureFilterVersion', CAPTURE_FILTER_VERSION);
    return 0;
  }
  const st = await Capture.status();
  if (!st.sms) return 0; // try again once SMS is allowed
  const { messages } = await Capture.readInbox({ sinceMs: Date.now() - 180 * DAY, limit: 20_000 });
  const sorted = [...messages].sort((a, b) => a.ts - b.ts);
  let fresh = 0;
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const s = await ingestCaptured(sorted.slice(i, i + CHUNK));
    fresh += s.read - s.alreadySeen;
  }
  if (await getMeta<boolean>('autoAdd', true)) await addAllReady();
  await refreshCheckpoints();
  await setMeta('captureFilterVersion', CAPTURE_FILTER_VERSION);
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

/**
 * Start listening. `onNew` is told how many messages arrived; `onRoute` opens a screen when the
 * app was launched from a capture notification. Returns a stop function.
 */
export function startCapture(
  onNew: (s: IngestSummary) => void,
  onRoute: (route: string) => void,
): () => void {
  if (!isAndroidApp) return () => {};
  const handles: Promise<PluginListenerHandle>[] = [];
  void loadContacts();
  const run = async () => {
    const s = await syncCaptured().catch(() => null);
    if (s && (s.toReview || s.duplicates || s.notices)) onNew(s);
    const { route } = await Capture.takeRoute().catch(() => ({ route: '' }));
    if (route) onRoute(route);
  };
  void run().then(() => rescanAfterFilterUpgrade().catch(() => 0));
  handles.push(Capture.addListener('captured', () => void run()));
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
