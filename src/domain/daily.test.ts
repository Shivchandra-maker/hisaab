import { dailyStats, vsTypical } from './daily';

const r = (n: number) => n * 100; // rupees → paise

describe('dailyStats (D-13)', () => {
  it('treats one rent day as an outlier and keeps the typical day honest', () => {
    const d = [r(200), r(300), r(500), r(0), r(28_500), r(2_760), r(1_200)];
    const s = dailyStats(d, 7);
    expect(s.outliers).toEqual([4]);
    // (200 + 300 + 500 + 0 + 2,760 + 1,200) / 6 = ₹826.67 → ₹827 (whole rupees)
    expect(s.typical).toBe(r(827));
    expect(s.scaleTop).toBe(r(2_760));
  });

  it('has no outliers when spending is even', () => {
    const s = dailyStats([r(500), r(700), r(600), r(800)]);
    expect(s.outliers).toEqual([]);
    expect(s.typical).toBe(r(650));
  });

  it('needs a few spending days before flagging anything', () => {
    expect(dailyStats([r(100), r(30_000), 0], 3).outliers).toEqual([]);
  });

  it('ignores days that have not happened yet', () => {
    const s = dailyStats([r(400), r(600), r(50_000)], 2);
    expect(s.days).toBe(2);
    expect(s.outliers).toEqual([]);
    expect(s.typical).toBe(r(500));
  });

  it('is empty for a month with no spending', () => {
    expect(dailyStats([0, 0, 0])).toMatchObject({ outliers: [], typical: 0 });
  });
});

describe('vsTypical', () => {
  it('words the comparison', () => {
    expect(vsTypical(r(860), r(830))).toBe('about');
    expect(vsTypical(r(3_000), r(800))).toBe('more');
    expect(vsTypical(r(100), r(800))).toBe('less');
  });
});
