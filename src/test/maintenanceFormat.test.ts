import { describe, expect, it } from 'vitest';
import {
  durationBetween,
  formatDays,
  formatFreezeRange,
  formatInstant,
  freezeCovers,
  isoToWall,
  nextDay,
  prevDay,
  slotEnd,
  wallToIso,
  type Weekday,
} from '../pages/incarnations/maintenance';
import { freezeRangeFromForm } from '../pages/incarnations/schemas';

const en = (d: Weekday) => d.charAt(0).toUpperCase() + d.slice(1);

describe('formatDays', () => {
  it('collapses a run of three or more into a range', () => {
    expect(formatDays(['mon', 'tue', 'wed', 'thu', 'fri'], en)).toBe('Mon–Fri');
    expect(formatDays(['mon', 'tue', 'wed', 'fri', 'sat', 'sun'], en)).toBe('Mon–Wed, Fri–Sun');
  });

  it('lists a run of two and single days one by one, in calendar order', () => {
    expect(formatDays(['sun', 'sat'], en)).toBe('Sat, Sun');
    expect(formatDays(['fri', 'mon', 'wed'], en)).toBe('Mon, Wed, Fri');
    expect(formatDays(['sun'], en)).toBe('Sun');
  });
});

describe('slot end and duration', () => {
  it('a slot inside one day', () => {
    expect(slotEnd('02:00', 180)).toEqual({ end: '05:00', nextDay: false });
    expect(durationBetween('02:00', '05:00')).toBe(180);
  });

  it('a slot crossing midnight is marked, one ending at midnight is not', () => {
    expect(slotEnd('22:00', 240)).toEqual({ end: '02:00', nextDay: true });
    expect(slotEnd('22:00', 120)).toEqual({ end: '00:00', nextDay: false });
    expect(durationBetween('22:00', '02:00')).toBe(240);
  });

  it('an end equal to the start is a whole day, the API maximum', () => {
    expect(durationBetween('02:00', '02:00')).toBe(1440);
    expect(slotEnd('02:00', 1440)).toEqual({ end: '02:00', nextDay: true });
  });

  it('malformed time gives no duration', () => {
    expect(durationBetween('2:00', '05:00')).toBeNull();
  });
});

describe('formatInstant', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('renders the user\'s example in the window zone', () => {
    expect(formatInstant('2026-12-09T23:00:00Z', 'Europe/Moscow', en, now)).toBe('Thu 10.12 02:00');
  });

  it('adds the year only when it is not the current one', () => {
    expect(formatInstant('2027-01-04T23:00:00Z', 'Europe/Moscow', en, now)).toBe('Tue 05.01.2027 02:00');
  });
});

describe('formatFreezeRange', () => {
  it('whole days render as dates with the inclusive last day', () => {
    expect(formatFreezeRange('2026-11-19T21:00:00Z', '2026-12-02T21:00:00Z', 'Europe/Moscow')).toBe(
      '20.11.2026 – 02.12.2026',
    );
  });

  it('anything else renders with times, end as stored', () => {
    expect(formatFreezeRange('2026-11-20T15:00:00Z', '2026-11-21T07:00:00Z', 'Europe/Moscow')).toBe(
      '20.11.2026 18:00 – 21.11.2026 10:00',
    );
  });
});

describe('freezeCovers', () => {
  const f = { starts_at: '2026-11-20T00:00:00Z', ends_at: '2026-11-21T00:00:00Z' };
  it('start inclusive, end exclusive', () => {
    expect(freezeCovers(f, new Date('2026-11-20T00:00:00Z'))).toBe(true);
    expect(freezeCovers(f, new Date('2026-11-20T23:59:59Z'))).toBe(true);
    expect(freezeCovers(f, new Date('2026-11-21T00:00:00Z'))).toBe(false);
    expect(freezeCovers(f, new Date('2026-11-19T23:59:59Z'))).toBe(false);
  });
});

// Expectations are literal instants in a named zone, never `new Date(y, m, d)`: that is
// the runner's local clock, the very thing a regression to it would also use.
describe('freezeRangeFromForm', () => {
  it('whole days end at the midnight after the last day, in the given zone', () => {
    const r = freezeRangeFromForm(
      { wholeDays: true, startDate: '2026-11-20', startTime: '', endDate: '2026-12-02', endTime: '' },
      'Europe/Moscow',
    );
    expect(r).toEqual({ starts_at: '2026-11-19T21:00:00.000Z', ends_at: '2026-12-02T21:00:00.000Z' });
  });

  it('exact moments are taken as typed', () => {
    const r = freezeRangeFromForm(
      { wholeDays: false, startDate: '2026-11-20', startTime: '18:00', endDate: '2026-11-21', endTime: '10:00' },
      'Asia/Vladivostok',
    );
    expect(r).toEqual({ starts_at: '2026-11-20T08:00:00.000Z', ends_at: '2026-11-21T00:00:00.000Z' });
  });
});

describe('wall clock <-> instant', () => {
  it('round-trips in a zone with DST, on both sides of the change', () => {
    expect(wallToIso('2026-03-28', '12:00', 'Europe/Berlin')).toBe('2026-03-28T11:00:00.000Z');
    expect(wallToIso('2026-03-30', '12:00', 'Europe/Berlin')).toBe('2026-03-30T10:00:00.000Z');
    expect(isoToWall('2026-03-30T10:00:00.000Z', 'Europe/Berlin')).toEqual({ date: '2026-03-30', time: '12:00' });
  });

  it('day arithmetic crosses month and year ends without a zone', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
  });
});
