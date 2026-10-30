/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Freeze, MaintenanceWindow } from '../api/keeper';
import {
  durationBetween,
  formatDays,
  formatFreezeRange,
  formatFreezeRangeShort,
  formatInstant,
  freezeCovers,
  frozenUntil,
  isoToWall,
  nextDay,
  openRunEnd,
  prevDay,
  slotAt,
  slotEnd,
  statusChangeAt,
  wallToIso,
  withComment,
  type OpenRunEnd,
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

function win(over: Partial<MaintenanceWindow>): MaintenanceWindow {
  return {
    id: 'w',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    start_time: '02:00',
    duration_minutes: 180,
    timezone: 'Europe/Moscow',
    comment: '',
    created_at: '2026-10-27T10:00:00Z',
    updated_at: '2026-10-27T10:00:00Z',
    ...over,
  };
}

function freeze(startsAt: string, endsAt: string): Freeze {
  return { id: 'f', starts_at: startsAt, ends_at: endsAt, comment: '', created_at: startsAt, updated_at: startsAt };
}

describe('slotAt and openRunEnd (the words of the status block)', () => {
  const NIGHT = win({ id: 'night', comment: 'night works' });
  const SAT_LATE = win({ id: 'sat', days: ['sat'], start_time: '22:00', duration_minutes: 240, comment: 'weekend' });
  const until = (r: OpenRunEnd) => (r.kind === 'until' ? r.at.toISOString() : r.kind);

  it('finds the slot an instant falls in, and none between slots', () => {
    expect(slotAt([NIGHT], new Date('2026-10-30T00:00:00Z'))?.window.id).toBe('night');
    expect(slotAt([NIGHT], new Date('2026-10-29T23:00:00Z'))?.start).toBe(Date.parse('2026-10-29T23:00:00Z'));
    expect(slotAt([NIGHT], new Date('2026-10-30T02:00:00Z'))).toBeNull();
    expect(slotAt([NIGHT], new Date('2026-10-31T00:00:00Z'))).toBeNull();
  });

  it('a slot across midnight belongs to the day it starts on', () => {
    // Sat 22:00 MSK for 4 h: Sun 01:30 MSK is still Saturday's slot, which ends Sun 02:00.
    expect(slotAt([SAT_LATE], new Date('2026-10-31T22:30:00Z'))?.window.id).toBe('sat');
    expect(until(openRunEnd([SAT_LATE], [], new Date('2026-10-31T20:00:00Z')))).toBe('2026-10-31T23:00:00.000Z');
  });

  it('touching slots chain into one stretch; the end is where the chain breaks', () => {
    const early = win({ id: 'early', start_time: '00:00', duration_minutes: 120 });
    expect(until(openRunEnd([early, NIGHT], [], new Date('2026-10-29T21:30:00Z')))).toBe('2026-10-30T02:00:00.000Z');
  });

  it('a freeze starting inside the stretch cuts it short; one starting after does not', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    expect(until(openRunEnd([NIGHT], [freeze('2026-10-30T01:00:00Z', '2026-10-31T00:00:00Z')], now))).toBe(
      '2026-10-30T01:00:00.000Z',
    );
    expect(until(openRunEnd([NIGHT], [freeze('2026-10-30T03:00:00Z', '2026-10-31T00:00:00Z')], now))).toBe(
      '2026-10-30T02:00:00.000Z',
    );
  });

  it('round-the-clock slots are unbounded unless a freeze starts within the horizon', () => {
    const always = win({ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start_time: '00:00', duration_minutes: 1440 });
    const now = new Date('2026-10-30T00:00:00Z');
    expect(until(openRunEnd([always], [], now))).toBe('unbounded');
    expect(until(openRunEnd([always], [freeze('2026-11-02T21:00:00Z', '2026-11-04T21:00:00Z')], now))).toBe(
      '2026-11-02T21:00:00.000Z',
    );
    // Past the horizon the chain is not followed, so a far freeze is not named as the end.
    expect(until(openRunEnd([always], [freeze('2026-11-20T21:00:00Z', '2026-12-02T21:00:00Z')], now))).toBe('unbounded');
  });

  it('a freeze another one picks up from does not end the wait', () => {
    const a = freeze('2026-10-30T21:00:00Z', '2026-11-01T21:00:00Z');
    const b = freeze('2026-11-01T21:00:00Z', '2026-11-04T21:00:00Z');
    const later = freeze('2026-11-05T21:00:00Z', '2026-11-06T21:00:00Z');
    expect(frozenUntil([a, b, later], a).toISOString()).toBe('2026-11-04T21:00:00.000Z');
    expect(frozenUntil([a, later], a).toISOString()).toBe('2026-11-01T21:00:00.000Z');
    // The list comes in any order; a chain found late still extends the end.
    const c = freeze('2026-11-04T21:00:00Z', '2026-11-05T21:00:00Z');
    expect(frozenUntil([c, b, a], a).toISOString()).toBe('2026-11-05T21:00:00.000Z');
  });

  describe('statusChangeAt', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    const at = (d: Date | null) => d?.toISOString() ?? null;
    const sale = freeze('2026-10-30T21:00:00Z', '2026-11-01T21:00:00Z');
    const next = freeze('2026-11-01T21:00:00Z', '2026-11-04T21:00:00Z');

    it('frozen: the end of the freeze in force, since the next one taking over changes the answer too', () => {
      const status = { open_now: false, next_start: '2026-11-04T23:00:00Z', active_freeze: sale };
      expect(at(statusChangeAt(status, [NIGHT], [sale, next], now))).toBe('2026-11-01T21:00:00.000Z');
    });

    it('frozen: the start of an overlapping freeze that ends later, which keeper then names', () => {
      const status = { open_now: false, next_start: '2026-11-04T23:00:00Z', active_freeze: sale };
      const longer = freeze('2026-10-31T09:00:00Z', '2026-11-04T21:00:00Z');
      const shorter = freeze('2026-10-31T06:00:00Z', '2026-11-01T00:00:00Z');
      expect(at(statusChangeAt(status, [NIGHT], [sale, longer, shorter], now))).toBe('2026-10-31T09:00:00.000Z');
      // One that started before the answer is not a change to come: here the list
      // already carries the freeze in force with a later end, edited after the answer.
      const edited = { ...sale, ends_at: '2026-11-03T21:00:00Z' };
      expect(at(statusChangeAt(status, [NIGHT], [edited], new Date('2026-10-31T00:00:00Z')))).toBe('2026-11-01T21:00:00.000Z');
    });

    it('closed: the next opening; nothing for an unparsable one', () => {
      expect(at(statusChangeAt({ open_now: false, next_start: '2026-10-30T23:00:00Z' }, [NIGHT], undefined, now))).toBe(
        '2026-10-30T23:00:00.000Z',
      );
      expect(statusChangeAt({ open_now: false, next_start: 'garbage' }, [NIGHT], [], now)).toBeNull();
    });

    it('open in a window: the end of the stretch, cut by a freeze when the list is known', () => {
      const open = { open_now: true, next_start: now.toISOString() };
      expect(at(statusChangeAt(open, [NIGHT], [], now))).toBe('2026-10-30T02:00:00.000Z');
      expect(at(statusChangeAt(open, [NIGHT], [freeze('2026-10-30T01:00:00Z', '2026-10-30T05:00:00Z')], now))).toBe(
        '2026-10-30T01:00:00.000Z',
      );
      expect(at(statusChangeAt(open, [NIGHT], undefined, now))).toBe('2026-10-30T02:00:00.000Z');
      expect(statusChangeAt(open, [NIGHT], [], new Date('2026-10-30T12:00:00Z'))).toBeNull();
    });

    it('open with no windows: the next freeze, and nothing without one or without the list', () => {
      const open = { open_now: true, next_start: now.toISOString() };
      expect(at(statusChangeAt(open, [], [sale], now))).toBe('2026-10-30T21:00:00.000Z');
      expect(statusChangeAt(open, [], [], now)).toBeNull();
      expect(statusChangeAt(open, [], undefined, now)).toBeNull();
    });
  });

  it('outside every slot the browser says it does not know, rather than a wrong end', () => {
    expect(openRunEnd([NIGHT], [], new Date('2026-10-30T12:00:00Z'))).toEqual({ kind: 'unknown' });
  });

  it('a slot on a DST night starts at the first occurrence of a repeated wall time, as keeper does', () => {
    // Berlin, 25.10.2026: 03:00 CEST falls back to 02:00 CET; 02:30 happens twice.
    const berlin = win({ days: ['sun'], start_time: '02:30', duration_minutes: 60, timezone: 'Europe/Berlin' });
    expect(slotAt([berlin], new Date('2026-10-25T00:45:00Z'))?.start).toBe(Date.parse('2026-10-25T00:30:00Z'));
    // Spring, 29.03.2026: 02:30 does not exist and moves forward by the gap, to 03:30 CEST.
    const spring = win({ days: ['sun'], start_time: '02:30', duration_minutes: 60, timezone: 'Europe/Berlin' });
    expect(slotAt([spring], new Date('2026-03-29T01:45:00Z'))?.start).toBe(Date.parse('2026-03-29T01:30:00Z'));
  });
});

describe('the short freeze range and the comment separator', () => {
  const now = new Date('2026-10-29T21:50:00Z');

  it('drops the year inside the current one, keeps it otherwise', () => {
    expect(formatFreezeRangeShort('2026-10-30T21:00:00Z', '2026-11-01T21:00:00Z', 'Europe/Moscow', now)).toBe('31.10 – 01.11');
    expect(formatFreezeRangeShort('2026-12-30T21:00:00Z', '2027-01-02T21:00:00Z', 'Europe/Moscow', now)).toBe(
      '31.12.2026 – 02.01.2027',
    );
    expect(formatFreezeRangeShort('2026-11-01T15:00:00Z', '2026-11-01T18:00:00Z', 'Europe/Moscow', now)).toBe(
      '01.11 18:00 – 01.11 21:00',
    );
  });

  it('a comment follows " · " and is never quoted; no comment, no separator', () => {
    expect(withComment('Freeze until Mon 02.11 00:00', 'Sale')).toBe('Freeze until Mon 02.11 00:00 · Sale');
    expect(withComment('Freeze until Mon 02.11 00:00', '')).toBe('Freeze until Mon 02.11 00:00');
  });

  it('[GUARD] no maintenance string in either locale carries a quote mark', () => {
    const files = [
      'src/i18n/locales/en/incarnations.json',
      'public/locales/ru/incarnations.json',
      'src/i18n/locales/en/run.json',
      'public/locales/ru/run.json',
    ];
    for (const file of files) {
      const json = JSON.parse(readFileSync(path.resolve(file), 'utf-8')) as Record<string, string>;
      for (const [key, value] of Object.entries(json)) {
        if (!/^(mw|freeze|inWindow)/.test(key)) continue;
        expect({ file, key, value }).toEqual({ file, key, value: value.replace(/[«»“”„"‘’]/g, '') });
      }
    }
  });
});
