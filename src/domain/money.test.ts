import { formatINR, formatINRCompact, toPaise } from './money';
import { ordinal, todayIST } from './dates';

describe('money', () => {
  it('parses rupee input to paise without float errors', () => {
    expect(toPaise('1,250.50')).toBe(125050);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise('₹ 99')).toBe(9900);
  });

  it('formats with Indian lakh grouping', () => {
    expect(formatINR(125_000_000)).toBe('₹12,50,000');
    expect(formatINR(12345)).toBe('₹123.45');
    expect(formatINR(-50000)).toBe('−₹500');
    expect(formatINR(50000, { sign: 'always' })).toBe('+₹500');
  });

  it('compact form uses k, L and Cr', () => {
    expect(formatINRCompact(95000)).toBe('₹950');
    expect(formatINRCompact(1_250_000)).toBe('₹12.5k');
    expect(formatINRCompact(34_000_000)).toBe('₹3.4L');
    expect(formatINRCompact(1_200_000_000)).toBe('₹1.2Cr');
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal).join(' ')).toBe(
      '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 31st',
    );
  });

  it("today is computed in IST, not the device's zone", () => {
    // 20:00 UTC on 30 Sep is 01:30 on 1 Oct in India.
    expect(todayIST(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
  });
});
