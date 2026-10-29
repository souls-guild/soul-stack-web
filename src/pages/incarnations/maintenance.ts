// Presentation helpers for maintenance windows and freezes (NIM-1076).
//
// Nothing here decides whether an incarnation is open: that is the server's status
// block (ADR-0093 §7), and a second calculator in the browser would drift from it.
// These functions only render rows and instants, and convert form input to the wire.

import { ApiError } from '../../api/client';

/** The problem type Keeper answers an act during a freeze with (409, ADR-0093 §5). */
export function isFreezeRefusal(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.type.endsWith('freeze-active');
}

export const windowsKey = (incarnation: string) => ['incarnation-maintenance-windows', incarnation];
export const freezesKey = (incarnation: string) => ['incarnation-freezes', incarnation];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const MINUTES_PER_DAY = 24 * 60;

export function isWeekday(s: string): s is Weekday {
  return (WEEKDAYS as readonly string[]).includes(s);
}

/**
 * Days in calendar order, consecutive runs of three or more collapsed into a range:
 * mon..fri → "Mon–Fri", sat+sun → "Sat, Sun", mon,wed,fri → "Mon, Wed, Fri".
 */
export function formatDays(days: readonly string[] | null | undefined, label: (d: Weekday) => string): string {
  const idx = WEEKDAYS.map((d, i) => ((days ?? []).includes(d) ? i : -1)).filter((i) => i >= 0);
  const parts: string[] = [];
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    if (j - i >= 2) {
      parts.push(`${label(WEEKDAYS[idx[i]])}–${label(WEEKDAYS[idx[j]])}`);
    } else {
      for (let k = i; k <= j; k++) parts.push(label(WEEKDAYS[idx[k]]));
    }
    i = j + 1;
  }
  return parts.join(', ');
}

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function toHHMM(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Wall-clock end of a slot. Wall-clock arithmetic on purpose: on a DST night the
 * slot still lasts `durationMinutes` of elapsed time, and the row says what the
 * operator typed, not what that one night does to it.
 */
export function slotEnd(start: string, durationMinutes: number): { end: string; nextDay: boolean } {
  const s = parseHHMM(start) ?? 0;
  // An end exactly at midnight reads "22:00–00:00" with no marker.
  return { end: toHHMM(s + durationMinutes), nextDay: s + durationMinutes > MINUTES_PER_DAY };
}

/**
 * Minutes from start to end on the wall clock. An end at or before the start crosses
 * midnight; an end equal to the start is a whole day (the API's maximum, 1440).
 * null when either side is not HH:MM.
 */
export function durationBetween(start: string, end: string): number | null {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null) return null;
  const d = (e - s + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return d === 0 ? MINUTES_PER_DAY : d;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function timeZoneNames(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
}

interface WallParts {
  weekday: Weekday;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const SHORT_WEEKDAY: Record<string, Weekday> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
};

function wallParts(d: Date, tz: string): WallParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: SHORT_WEEKDAY[get('weekday')] ?? 'mon',
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "Thu 10.12 02:00" in `tz` — the form of the status line. The year is added only
 * when it is not the current one, so a forecast a year out cannot read as next week.
 */
export function formatInstant(
  iso: string,
  tz: string,
  label: (d: Weekday) => string,
  now: Date = new Date(),
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = wallParts(d, tz);
  const year = p.year !== wallParts(now, tz).year ? `.${p.year}` : '';
  return `${label(p.weekday)} ${pad2(p.day)}.${pad2(p.month)}${year} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "20.11.2026" or "20.11.2026 18:00" in `tz`. */
function formatDate(d: Date, tz: string, withTime: boolean): string {
  const p = wallParts(d, tz);
  const date = `${pad2(p.day)}.${pad2(p.month)}.${p.year}`;
  return withTime ? `${date} ${pad2(p.hour)}:${pad2(p.minute)}` : date;
}

function isMidnight(d: Date, tz: string): boolean {
  const p = wallParts(d, tz);
  return p.hour === 0 && p.minute === 0;
}

/**
 * A freeze covering whole days renders as dates, with the inclusive last day —
 * [20.11 00:00, 03.12 00:00) is "20.11.2026 – 02.12.2026", the way the operator
 * said it. Anything else renders with times, end exclusive as stored.
 */
export function formatFreezeRange(startsAt: string, endsAt: string, tz: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${startsAt} – ${endsAt}`;
  if (isWholeDays(startsAt, endsAt, tz)) {
    const lastDay = new Date(e.getTime() - 1);
    return `${formatDate(s, tz, false)} – ${formatDate(lastDay, tz, false)}`;
  }
  return `${formatDate(s, tz, true)} – ${formatDate(e, tz, true)}`;
}

export function isWholeDays(startsAt: string, endsAt: string, tz: string): boolean {
  return isMidnight(new Date(startsAt), tz) && isMidnight(new Date(endsAt), tz);
}

/** Whether [starts_at, ends_at) covers the instant. */
export function freezeCovers(f: { starts_at: string; ends_at: string }, at: Date): boolean {
  const t = at.getTime();
  return new Date(f.starts_at).getTime() <= t && t < new Date(f.ends_at).getTime();
}

// --- wall-clock form values <-> RFC 3339 ---
//
// Freeze inputs are wall-clock values in one zone — the browser's, the same zone the
// tab renders freezes in. <input type="date"> gives YYYY-MM-DD, <input type="time"> HH:MM.
// The zone is explicit rather than the Date constructor's implicit local one, so what
// is typed and what is shown can never disagree.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^(\d{2}):(\d{2})$/;

/** Offset of `tz` from UTC at the instant, in ms (positive east of Greenwich). */
function zoneOffsetMs(utcMs: number, tz: string): number {
  const p = wallParts(new Date(utcMs), tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wallAsUtc - Math.floor(utcMs / 60_000) * 60_000;
}

/**
 * YYYY-MM-DD + HH:MM on the wall clock of `tz` → ISO instant; null when malformed.
 * Two passes settle the offset across a DST change; a wall time the spring change
 * skips lands on the far side of the gap.
 */
export function wallToIso(date: string, time: string, tz: string): string | null {
  const dm = YMD_RE.exec(date);
  const tm = HM_RE.exec(time);
  if (!dm || !tm) return null;
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  if (Number.isNaN(guess)) return null;
  const first = guess - zoneOffsetMs(guess, tz);
  const ts = guess - zoneOffsetMs(first, tz);
  return new Date(ts).toISOString();
}

/** ISO instant → { date: YYYY-MM-DD, time: HH:MM } on the wall clock of `tz`. */
export function isoToWall(iso: string, tz: string): { date: string; time: string } {
  const p = wallParts(new Date(iso), tz);
  return { date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`, time: `${pad2(p.hour)}:${pad2(p.minute)}` };
}

function shiftDay(date: string, days: number): string {
  const dm = YMD_RE.exec(date);
  if (!dm) return date;
  const d = new Date(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]) + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export const nextDay = (date: string) => shiftDay(date, 1);
export const prevDay = (date: string) => shiftDay(date, -1);
