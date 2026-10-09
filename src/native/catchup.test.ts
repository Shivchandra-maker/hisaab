import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake phone: Android, Android part 4, a year of bank SMS in its inbox.
const DAY = 86_400_000;
const NOW = new Date('2026-10-09T12:00:00+05:30').getTime();
const reads: number[] = [];
let inboxOnPhone: { id: string; source: 'sms'; body: string; ts: number }[] = [];
let failAfterReads = Infinity;

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
  registerPlugin: () => ({
    status: async () => ({ sms: true, filterVersion: 3, nativeVersion: 4 }),
    readInbox: async ({ sinceMs }: { sinceMs: number }) => {
      reads.push(sinceMs);
      if (reads.length > failAfterReads) throw new Error('app closed');
      return { messages: inboxOnPhone.filter((m) => m.ts >= sinceMs) };
    },
  }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));

const { rescanAfterFilterUpgrade } = await import('./capture');
const { db, getMeta, resetAll, saveAccount, setMeta } = await import('../db/repo');

const sms = (daysAgo: number, amount: number) => {
  const ts = NOW - daysAgo * DAY;
  const d = new Date(ts + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [y, m, dd] = d.split('-');
  return {
    id: `m${daysAgo}`,
    source: 'sms' as const,
    ts,
    body: `Rs.${amount}.00 debited from A/c XX4521 on ${dd}-${m}-${y!.slice(2)} to VPA shop${daysAgo}@ybl. UPI Ref ${100000 + daysAgo}`,
  };
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  reads.length = 0;
  failAfterReads = Infinity;
  await resetAll();
  await saveAccount({
    name: 'HDFC',
    kind: 'bank',
    last4: '4521',
    institution: 'HDFC Bank',
    openingBalance: 1_00_000_00,
    openingDate: '2025-09-01',
    archived: false,
    sortOrder: 0,
  });
  await setMeta('onboarded', true);
  await setMeta('quickSetupDone', true);
  inboxOnPhone = [2, 10, 40, 100, 300].map((d) => sms(d, 100 + d));
});

describe('H-25: one-time catch-up after updating', () => {
  it('reads newest days first and ends with a year of payments', async () => {
    await rescanAfterFilterUpgrade();
    expect(reads.map((r) => Math.round((NOW - r) / DAY))).toEqual([14, 60, 180, 365]);
    const amounts = (await db.transactions.toArray())
      .map((t) => t.amount / 100)
      .sort((a, b) => a - b);
    expect(amounts).toEqual([102, 110, 140, 200, 400]);
    expect(await getMeta('nativeFilterRead2', 0)).toBe(3);
    expect(await getMeta('catchUp', 'x')).toBeNull();
  });

  it('closing the app half-way keeps what was read and carries on from there', async () => {
    failAfterReads = 2; // stopped while reading the 180-day window
    await expect(rescanAfterFilterUpgrade()).rejects.toThrow();
    expect(await db.transactions.count()).toBe(3); // last 60 days already in
    const saved = await getMeta<{ stage: number } | null>('catchUp', null);
    expect(saved?.stage).toBe(2);
    failAfterReads = Infinity;
    reads.length = 0;
    await rescanAfterFilterUpgrade();
    expect(reads.map((r) => Math.round((NOW - r) / DAY))).toEqual([180, 365]);
    expect(await db.transactions.count()).toBe(5);
  });

  it('H-26: set up by hand and never read messages → nothing to catch up', async () => {
    await setMeta('quickSetupDone', false);
    await rescanAfterFilterUpgrade();
    expect(reads).toEqual([]);
    expect(await getMeta('nativeFilterRead2', 0)).toBe(3);
  });
});
