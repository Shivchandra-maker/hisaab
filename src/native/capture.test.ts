import { describe, expect, it } from 'vitest';
import { IMPORT_RANGES, rangeStart } from './capture';

describe('import ranges', () => {
  const now = Date.UTC(2026, 9, 2);
  it('offers 7 days, 30 days, 1 year and all', () => {
    expect(IMPORT_RANGES.map((r) => r.label)).toEqual(['7 days', '30 days', '1 year', 'All']);
  });
  it('computes the start of each range', () => {
    expect(rangeStart('7d', now)).toBe(now - 7 * 86_400_000);
    expect(rangeStart('30d', now)).toBe(now - 30 * 86_400_000);
    expect(rangeStart('1y', now)).toBe(now - 365 * 86_400_000);
    expect(rangeStart('all', now)).toBe(0);
  });
});
