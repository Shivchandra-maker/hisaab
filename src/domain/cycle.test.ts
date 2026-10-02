import { periodClosingIn, periodContaining, recentPeriods, statementDateIn } from './cycle';

const card15 = { statementDay: 15, dueDaysAfterStatement: 20 };
const card31 = { statementDay: 31, dueDaysAfterStatement: 18 };
const card3 = { statementDay: 3, dueDaysAfterStatement: 18 };

describe('statement periods', () => {
  it('16 Aug – 15 Sep for a 15th statement day (the project brief example)', () => {
    expect(periodClosingIn(card15, '2026-09')).toEqual({
      closesIn: '2026-09',
      start: '2026-08-16',
      end: '2026-09-15',
      due: '2026-10-05',
    });
  });

  it('spend on the statement day belongs to that statement; the next day rolls over', () => {
    expect(periodContaining(card15, '2026-09-15').closesIn).toBe('2026-09');
    expect(periodContaining(card15, '2026-09-16').closesIn).toBe('2026-10');
    expect(periodContaining(card15, '2026-09-01').closesIn).toBe('2026-09');
  });

  it('clamps a 31st statement day to short months and leap years', () => {
    expect(statementDateIn(card31, 2026, 4)).toBe('2026-04-30');
    expect(statementDateIn(card31, 2026, 2)).toBe('2026-02-28');
    expect(statementDateIn(card31, 2028, 2)).toBe('2028-02-29');
    expect(periodClosingIn(card31, '2026-03')).toMatchObject({
      start: '2026-03-01',
      end: '2026-03-31',
    });
    expect(periodClosingIn(card31, '2026-05')).toMatchObject({
      start: '2026-05-01',
      end: '2026-05-31',
    });
  });

  it('crosses the year boundary', () => {
    expect(periodClosingIn(card3, '2027-01')).toMatchObject({
      start: '2026-12-04',
      end: '2027-01-03',
    });
    expect(periodContaining(card3, '2026-12-31').closesIn).toBe('2027-01');
    expect(periodContaining(card15, '2026-12-20')).toMatchObject({
      closesIn: '2027-01',
      start: '2026-12-16',
      end: '2027-01-15',
    });
  });

  it('due date can fall in the next month or year', () => {
    expect(periodClosingIn(card15, '2026-12').due).toBe('2027-01-04');
  });

  it('respects a statement date the bank moved', () => {
    const moved = { ...card15, statementOverrides: { '2026-10': '2026-10-17' } };
    expect(periodContaining(moved, '2026-10-16').closesIn).toBe('2026-10');
    expect(periodContaining(moved, '2026-10-17').closesIn).toBe('2026-10');
    expect(periodContaining(moved, '2026-10-18').closesIn).toBe('2026-11');
    expect(periodClosingIn(moved, '2026-11').start).toBe('2026-10-18');
  });

  it('every day of a year belongs to exactly one period, with no gaps', () => {
    for (const card of [card15, card31, card3, { statementDay: 29, dueDaysAfterStatement: 15 }]) {
      const periods = recentPeriods(card, '2028-12-31', 14).reverse();
      for (let i = 1; i < periods.length; i++) {
        const prev = periods[i - 1]!;
        const cur = periods[i]!;
        const dayAfter = new Date(`${prev.end}T00:00:00Z`);
        dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
        expect(cur.start).toBe(dayAfter.toISOString().slice(0, 10));
        expect(cur.end >= cur.start).toBe(true);
      }
    }
  });
});
