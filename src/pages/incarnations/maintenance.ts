// Presentation helpers for maintenance windows and freezes (NIM-1076).
//
// Nothing here decides whether an incarnation is open: that is the server's status
// block (ADR-0093 §7), and a second calculator in the browser would drift from it.
// These functions only render rows and instants, and convert form input to the wire.

import { ApiError } from '../../api/client';
import type { Freeze, MaintenanceWindow } from '../../api/keeper';

/** The problem type Keeper answers an act during a freeze with (409, ADR-0093 §5). */
export function isFreezeRefusal(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.type.endsWith('freeze-active');
}

/**
 * The tab's refresh rhythm. The status block counts down on the tick; the server's
 * status is re-read a second after the instant it is due to change, and on the beat
 * for edits made elsewhere (a hidden browser tab pauses the beat, not a timeout). A
 * browser clock ahead of keeper's gets the old answer back and asks again on the
 * retry, for a minute at most. An object rather than constants, so a test can
 * shorten the retry.
 */
export const STATUS_REFRESH = {
  tickMs: 30_000,
  beatMs: 60_000,
  staleRetryMs: 5_000,
  staleRetryForMs: 60_000,
};

export const windowsKey = (incarnation: string) => ['incarnation-maintenance-windows', incarnation];
export const freezesKey = (incarnation: string) => ['incarnation-freezes', incarnation];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

export function isWeekday(s: string): s is Weekday {
  return (WEEKDAYS as readonly string[]).includes(s);
}

/** "text · comment", or the text alone. Comments are never quoted. */
export function withComment(text: string, comment: string | null | undefined): string {
  return comment ? `${text} · ${comment}` : text;
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
    wallFormatter(tz);
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

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(tz: string): Intl.DateTimeFormat {
  let f = wallFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    wallFormatters.set(tz, f);
  }
  return f;
}

function wallParts(d: Date, tz: string): WallParts {
  const parts = wallFormatter(tz).formatToParts(d);
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
 * { day: "Thu 10.12", time: "02:00" } in `tz`, and whether that is `now`'s own date.
 * The year is added only when it is not the current one, so a forecast a year out
 * cannot read as next week.
 */
export function instantParts(
  iso: string,
  tz: string,
  label: (d: Weekday) => string,
  now: Date = new Date(),
): { day: string; time: string; today: boolean } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: iso, time: '', today: false };
  const p = wallParts(d, tz);
  const n = wallParts(now, tz);
  const year = p.year !== n.year ? `.${p.year}` : '';
  return {
    day: `${label(p.weekday)} ${pad2(p.day)}.${pad2(p.month)}${year}`,
    time: `${pad2(p.hour)}:${pad2(p.minute)}`,
    today: p.year === n.year && p.month === n.month && p.day === n.day,
  };
}

/** "Thu 10.12 02:00" in `tz` — see {@link instantParts}. */
export function formatInstant(
  iso: string,
  tz: string,
  label: (d: Weekday) => string,
  now: Date = new Date(),
): string {
  const p = instantParts(iso, tz, label, now);
  return p.time ? `${p.day} ${p.time}` : p.day;
}

/** "20.11.2026", "20.11" without the year, or either with " 18:00", in `tz`. */
function formatDate(d: Date, tz: string, withTime: boolean, withYear = true): string {
  const p = wallParts(d, tz);
  const date = withYear ? `${pad2(p.day)}.${pad2(p.month)}.${p.year}` : `${pad2(p.day)}.${pad2(p.month)}`;
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

/**
 * {@link formatFreezeRange} without the years when both ends fall in `now`'s year:
 * "31.10 – 01.11", the form of a chip.
 */
export function formatFreezeRangeShort(startsAt: string, endsAt: string, tz: string, now: Date = new Date()): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${startsAt} – ${endsAt}`;
  const whole = isWholeDays(startsAt, endsAt, tz);
  const last = whole ? new Date(e.getTime() - 1) : e;
  const year = wallParts(now, tz).year;
  const withYear = wallParts(s, tz).year !== year || wallParts(last, tz).year !== year;
  return `${formatDate(s, tz, !whole, withYear)} – ${formatDate(last, tz, !whole, withYear)}`;
}

export function isWholeDays(startsAt: string, endsAt: string, tz: string): boolean {
  return isMidnight(new Date(startsAt), tz) && isMidnight(new Date(endsAt), tz);
}

/** Whether [starts_at, ends_at) covers the instant. */
export function freezeCovers(f: { starts_at: string; ends_at: string }, at: Date): boolean {
  const t = at.getTime();
  return new Date(f.starts_at).getTime() <= t && t < new Date(f.ends_at).getTime();
}

export function nextFreeze(freezes: readonly Freeze[], now: Date): Freeze | undefined {
  const t = now.getTime();
  let best: Freeze | undefined;
  for (const f of freezes) {
    const s = new Date(f.starts_at).getTime();
    if (s > t && (!best || s < new Date(best.starts_at).getTime())) best = f;
  }
  return best;
}

/**
 * The end of the run of touching or overlapping freezes `active` belongs to, as
 * keeper merges them: a freeze another one picks up from does not end the wait.
 */
export function frozenUntil(freezes: readonly Freeze[], active: Freeze): Date {
  let end = Date.parse(active.ends_at);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of freezes) {
      const s = Date.parse(f.starts_at);
      const e = Date.parse(f.ends_at);
      if (s <= end && end < e) {
        end = e;
        grew = true;
      }
    }
  }
  return new Date(end);
}

// --- slots, for the words of the status block ---
//
// The server's status says whether a run may start now and when it next may. It
// does not say where the open stretch ends or which window an opening belongs to,
// and the status block names both. These functions mirror the slot rules of
// keeper's maintenance calculator (local days two back and eight ahead, a wall time
// a DST change skips or repeats settled the same way), and only ever add detail to
// the server's answer: where they cannot find a slot the server implies, the block
// says less, never something else.

export interface Slot {
  start: number;
  end: number;
  window: MaintenanceWindow;
}

/**
 * A wall-clock time on a date in `tz` → epoch ms. A time the spring change skips
 * moves forward by the gap; a time the autumn change repeats is its first
 * occurrence — keeper's wallClock, offset for offset.
 */
function wallClockMs(y: number, m: number, d: number, minuteOfDay: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  let early = naive - zoneOffsetMs(naive - 2 * MS_PER_DAY, tz);
  let late = naive - zoneOffsetMs(naive + 2 * MS_PER_DAY, tz);
  if (early > late) [early, late] = [late, early];
  const p = wallParts(new Date(early), tz);
  const matches = p.year === y && p.month === m && p.day === d && p.hour * 60 + p.minute === minuteOfDay;
  return matches ? early : late;
}

function slotsNear(windows: readonly MaintenanceWindow[], at: number): Slot[] {
  const out: Slot[] = [];
  for (const w of windows) {
    const minute = parseHHMM(w.start_time);
    if (minute === null || !isValidTimeZone(w.timezone)) continue;
    const local = wallParts(new Date(at), w.timezone);
    for (let i = -2; i <= 8; i++) {
      const day = new Date(Date.UTC(local.year, local.month - 1, local.day + i));
      // getUTCDay counts from Sunday, WEEKDAYS from Monday.
      if (!(w.days ?? []).includes(WEEKDAYS[(day.getUTCDay() + 6) % 7])) continue;
      const start = wallClockMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), minute, w.timezone);
      out.push({ start, end: start + w.duration_minutes * MS_PER_MINUTE, window: w });
    }
  }
  return out;
}

/** The slot covering `at` that started last — the one an opening at `at` belongs to. */
export function slotAt(windows: readonly MaintenanceWindow[], at: Date): Slot | null {
  const t = at.getTime();
  let best: Slot | null = null;
  for (const s of slotsNear(windows, t)) {
    if (s.start <= t && t < s.end && (!best || s.start > best.start)) best = s;
  }
  return best;
}

export type OpenRunEnd =
  | { kind: 'until'; at: Date }
  /** The slots run on past the horizon and no freeze starts before it. */
  | { kind: 'unbounded' }
  /** No slot covers `now`: this browser disagrees with the server's open_now. */
  | { kind: 'unknown' };

// Past it the chain is not followed: weekly slots in a DST zone can open a gap on
// the night the clocks change, and a freeze beyond it may not be the real end.
const OPEN_RUN_HORIZON_MS = 8 * MS_PER_DAY;

/**
 * Where the open stretch holding `now` ends: the end of the chain of touching or
 * overlapping slots from `now`, cut short by the first freeze that starts inside it.
 */
export function openRunEnd(windows: readonly MaintenanceWindow[], freezes: readonly Freeze[], now: Date): OpenRunEnd {
  const t0 = now.getTime();
  const horizon = t0 + OPEN_RUN_HORIZON_MS;
  let end = t0;
  while (end < horizon) {
    let next = end;
    for (const s of slotsNear(windows, end)) {
      if (s.start <= end && end < s.end && s.end > next) next = s.end;
    }
    if (next === end) break;
    end = next;
  }
  if (end === t0) return { kind: 'unknown' };
  const bounded = end < horizon;
  let cut = bounded ? end : horizon;
  for (const f of freezes) {
    const s = new Date(f.starts_at).getTime();
    if (s > t0 && s < cut) cut = s;
  }
  return bounded || cut < horizon ? { kind: 'until', at: new Date(cut) } : { kind: 'unbounded' };
}

/**
 * When the server's answer given at `answeredAt` next changes on its own: the end
 * of the freeze in force, or the start of an overlapping one that ends later (keeper
 * then names that one), the next opening, or the end of the open stretch. null when
 * no such instant is known; `freezes` undefined is a list that failed to load.
 */
export function statusChangeAt(
  status: { open_now: boolean; next_start: string; active_freeze?: Freeze },
  windows: readonly MaintenanceWindow[],
  freezes: readonly Freeze[] | undefined,
  answeredAt: Date,
): Date | null {
  let at: Date | null;
  if (status.active_freeze) {
    const ends = Date.parse(status.active_freeze.ends_at);
    let first = ends;
    for (const f of freezes ?? []) {
      const s = Date.parse(f.starts_at);
      if (s > answeredAt.getTime() && s < first && Date.parse(f.ends_at) > ends) first = s;
    }
    at = new Date(first);
  } else if (!status.open_now) {
    at = new Date(status.next_start);
  } else if (windows.length === 0) {
    const ahead = freezes ? nextFreeze(freezes, answeredAt) : undefined;
    at = ahead ? new Date(ahead.starts_at) : null;
  } else {
    const run = openRunEnd(windows, freezes ?? [], answeredAt);
    at = run.kind === 'until' ? run.at : null;
  }
  return at && !Number.isNaN(at.getTime()) ? at : null;
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
