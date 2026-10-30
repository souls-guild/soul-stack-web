// Presentation helpers for maintenance windows and freezes (NIM-1076).
//
// Nothing here decides whether an incarnation is open: that is the server's status
// block (ADR-0093 §7), and a second calculator in the browser would drift from it.
// These functions only render rows and instants, and convert form input to the wire.

import { ApiError } from '../../api/client';
import type { Freeze, MaintenanceDefaultWindow, MaintenanceWindow } from '../../api/keeper';

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

/** A row from a Keeper before one-off windows carries no kind, and is weekly. */
export function isOnce(w: { kind?: string }): boolean {
  return w.kind === 'once';
}

/**
 * Whether a window still counts at `now` (NIM-1137): a weekly one always, a one-off
 * one until its end. An ended one-off window stays listed until the Reaper deletes it.
 */
export function windowCounts(w: { kind?: string; ends_at?: string }, now: Date): boolean {
  if (!isOnce(w)) return true;
  const end = Date.parse(w.ends_at ?? '');
  return Number.isNaN(end) || end > now.getTime();
}

/** Where a slot comes from: an own weekly window, a one-off window, or the cluster default. */
export type SlotOrigin = 'weekly' | 'once' | 'default';

/** A window row, or a cluster default slot set, which has no id. */
export type SlotWindow = Partial<Omit<MaintenanceWindow, 'comment'>> & { comment?: string | null };

export interface EffectiveWindow {
  window: SlotWindow;
  origin: SlotOrigin;
}

/**
 * The windows in effect, the way keeper's calculator takes them (NIM-1138): the
 * incarnation's own weekly windows, or the cluster default when it has none, plus
 * every one-off window. An ended one-off window yields no slot ahead of its end.
 */
export function effectiveWindows(
  items: readonly MaintenanceWindow[],
  defaults: readonly MaintenanceDefaultWindow[] | null | undefined,
): EffectiveWindow[] {
  const own = items.filter((w) => !isOnce(w)).map((w): EffectiveWindow => ({ window: w, origin: 'weekly' }));
  const weekly = own.length > 0 ? own : (defaults ?? []).map((d): EffectiveWindow => ({ window: d, origin: 'default' }));
  return [...weekly, ...items.filter(isOnce).map((w): EffectiveWindow => ({ window: w, origin: 'once' }))];
}

/** Whether any window in effect counts at `now` — with none, a run may start at any time outside a freeze. */
export function hasCountingWindows(windows: readonly EffectiveWindow[], now: Date): boolean {
  return windows.some((e) => e.origin !== 'once' || windowCounts(e.window, now));
}

/**
 * Whether no window is in effect at `now`, so a run may start at any time outside a
 * freeze. A weekly set the server names as in effect (`source`, NIM-1138) settles it
 * even when this browser holds no slots for it; otherwise the rows decide.
 */
export function noWindowsInEffect(source: string | undefined, windows: readonly EffectiveWindow[], now: Date): boolean {
  if (source === 'own' || source === 'default') return false;
  return !hasCountingWindows(windows, now);
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
    const first = formatDate(s, tz, false);
    const last = formatDate(new Date(e.getTime() - 1), tz, false);
    return first === last ? first : `${first} – ${last}`;
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
  const from = formatDate(s, tz, !whole, withYear);
  const to = formatDate(last, tz, !whole, withYear);
  // One whole day is its date alone.
  return whole && from === to ? from : `${from} – ${to}`;
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

// --- slots, for the words of the status block and for the calendar ---
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
  window: SlotWindow;
  origin: SlotOrigin;
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

/**
 * Slots of the windows in effect on the local days `from`..`to` of each weekly
 * window's own zone, both offsets in days from the local date of `at`. A one-off
 * window is its one interval, wherever it falls.
 */
function slotsAround(windows: readonly EffectiveWindow[], at: number, from: number, to: number): Slot[] {
  const out: Slot[] = [];
  for (const { window: w, origin } of windows) {
    if (origin === 'once') {
      const start = Date.parse(w.starts_at ?? '');
      const end = Date.parse(w.ends_at ?? '');
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) out.push({ start, end, window: w, origin });
      continue;
    }
    const minute = parseHHMM(w.start_time ?? '');
    const tz = w.timezone ?? '';
    if (minute === null || !isValidTimeZone(tz) || !w.duration_minutes) continue;
    const local = wallParts(new Date(at), tz);
    for (let i = from; i <= to; i++) {
      const day = new Date(Date.UTC(local.year, local.month - 1, local.day + i));
      // getUTCDay counts from Sunday, WEEKDAYS from Monday.
      if (!(w.days ?? []).includes(WEEKDAYS[(day.getUTCDay() + 6) % 7])) continue;
      const start = wallClockMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), minute, tz);
      out.push({ start, end: start + w.duration_minutes * MS_PER_MINUTE, window: w, origin });
    }
  }
  return out;
}

function slotsNear(windows: readonly EffectiveWindow[], at: number): Slot[] {
  return slotsAround(windows, at, -2, 8);
}

/** Every slot that overlaps [from, to). */
export function slotsBetween(windows: readonly EffectiveWindow[], from: number, to: number): Slot[] {
  // A slot starts at most a day before the local date it belongs to, whatever the
  // zones, so two days of margin on either side catch every one that reaches in.
  const days = Math.ceil((to - from) / MS_PER_DAY);
  return slotsAround(windows, from, -2, days + 2).filter((s) => s.start < to && s.end > from);
}

/** The slot covering `at` that started last — the one an opening at `at` belongs to. */
export function slotAt(windows: readonly EffectiveWindow[], at: Date): Slot | null {
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
export function openRunEnd(windows: readonly EffectiveWindow[], freezes: readonly Freeze[], now: Date): OpenRunEnd {
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
  status: { open_now: boolean; next_start: string; active_freeze?: Freeze; source?: string },
  windows: readonly EffectiveWindow[],
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
  } else if (noWindowsInEffect(status.source, windows, answeredAt)) {
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

export function shiftDay(date: string, days: number): string {
  const dm = YMD_RE.exec(date);
  if (!dm) return date;
  const d = new Date(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]) + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export const nextDay = (date: string) => shiftDay(date, 1);
export const prevDay = (date: string) => shiftDay(date, -1);

/**
 * A one-off window's interval: "30.10 20:00 – 23:00" within a day, "30.10 22:00 –
 * 31.10 02:00" across one, a year on a date outside `now`'s.
 */
export function formatOnceRange(startsAt: string, endsAt: string, tz: string, now: Date = new Date()): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${startsAt} – ${endsAt}`;
  const year = wallParts(now, tz).year;
  const sp = wallParts(s, tz);
  const ep = wallParts(e, tz);
  const start = formatDate(s, tz, true, sp.year !== year);
  const sameDay = sp.year === ep.year && sp.month === ep.month && sp.day === ep.day;
  return `${start} – ${sameDay ? `${pad2(ep.hour)}:${pad2(ep.minute)}` : formatDate(e, tz, true, ep.year !== year)}`;
}

// --- the calendar ---
//
// A day is a row from its midnight to the next one in the browser's zone, the zone
// the status block speaks in. A slot is drawn on every day it overlaps, so one past
// midnight shows on both; a freeze splits a slot into what may still open and what
// it cancels. Like the slots above, this only draws: it never decides whether a
// run may start.

export type MarkKind = SlotOrigin | 'cut' | 'freeze';

export interface CalendarMark {
  kind: MarkKind;
  /** Offset and width, in percent of the day. */
  left: number;
  width: number;
  /** The piece goes on from the day before, or onto the day after. */
  fromPrev: boolean;
  toNext: boolean;
  /** The first piece of its slot or freeze in view: the one that carries its words. */
  lead: boolean;
  slot?: Slot;
  freeze?: Freeze;
}

export interface CalendarDay {
  /** YYYY-MM-DD on the wall clock of the zone. */
  date: string;
  weekday: Weekday;
  start: number;
  end: number;
  marks: CalendarMark[];
}

/** YYYY-MM-DD of the instant on the wall clock of `tz`. */
export function wallDate(d: Date, tz: string): string {
  const p = wallParts(d, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function ymd(date: string): [number, number, number] {
  const dm = YMD_RE.exec(date);
  return dm ? [Number(dm[1]), Number(dm[2]), Number(dm[3])] : [1970, 1, 1];
}

/** Weekday of a YYYY-MM-DD date. */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = ymd(date);
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/** The Monday of the week holding `date`. */
export function weekStart(date: string): string {
  return shiftDay(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

/** The first day of the month holding `date`, and the same day shifted by `months`. */
export function monthStart(date: string, months = 0): string {
  const [y, m] = ymd(date);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}

/** Whole weeks, Monday to Sunday, that cover the month holding `date`. */
export function monthGrid(date: string): { first: string; count: number } {
  const first = weekStart(monthStart(date));
  const last = prevDay(monthStart(date, 1));
  const lastSunday = shiftDay(last, 6 - WEEKDAYS.indexOf(weekdayOf(last)));
  const [y1, m1, d1] = ymd(first);
  const [y2, m2, d2] = ymd(lastSunday);
  return { first, count: Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / MS_PER_DAY) + 1 };
}

/**
 * Where an instant falls on its day's row, in percent: by the wall clock, so a
 * block lines up with the hour scale on the 23- and 25-hour days of a DST change.
 */
export function dayPosition(t: number, day: { start: number; end: number }, tz: string): number {
  if (t <= day.start) return 0;
  if (t >= day.end) return 100;
  const p = wallParts(new Date(t), tz);
  return ((p.hour * 60 + p.minute) / MINUTES_PER_DAY) * 100;
}

function dayStartMs(date: string, tz: string): number {
  const [y, m, d] = ymd(date);
  return wallClockMs(y, m, d, 0, tz);
}

/** Touching or overlapping freezes as one interval each. */
function frozenSpans(freezes: readonly Freeze[]): Array<[number, number]> {
  const spans = freezes
    .map((f): [number, number] => [Date.parse(f.starts_at), Date.parse(f.ends_at)])
    .filter(([s, e]) => !Number.isNaN(s) && !Number.isNaN(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of spans) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** [start, end) of a slot split into the parts a freeze cancels and the parts it leaves. */
function cutByFreezes(start: number, end: number, spans: ReadonlyArray<[number, number]>): Array<{ start: number; end: number; cut: boolean }> {
  const out: Array<{ start: number; end: number; cut: boolean }> = [];
  let at = start;
  for (const [s, e] of spans) {
    if (e <= at || s >= end) continue;
    if (s > at) out.push({ start: at, end: s, cut: false });
    out.push({ start: Math.max(s, at), end: Math.min(e, end), cut: true });
    at = Math.min(e, end);
  }
  if (at < end) out.push({ start: at, end, cut: false });
  return out;
}

/** `count` days from `first` in `tz`, each with the marks of the windows in effect and the freezes. */
export function calendarDays(
  first: string,
  count: number,
  tz: string,
  windows: readonly EffectiveWindow[],
  freezes: readonly Freeze[],
): CalendarDay[] {
  const dates = Array.from({ length: count }, (_, i) => shiftDay(first, i));
  const bounds = [...dates, shiftDay(first, count)].map((d) => dayStartMs(d, tz));
  const from = bounds[0];
  const to = bounds[count];

  interface Piece {
    kind: MarkKind;
    start: number;
    end: number;
    // The slot or freeze the piece belongs to, whose own start decides the lead.
    whole: number;
    slot?: Slot;
    freeze?: Freeze;
  }
  const pieces: Piece[] = [];
  const spans = frozenSpans(freezes);
  for (const slot of slotsBetween(windows, from, to)) {
    for (const p of cutByFreezes(slot.start, slot.end, spans)) {
      pieces.push({ kind: p.cut ? 'cut' : slot.origin, start: p.start, end: p.end, whole: slot.start, slot });
    }
  }
  for (const f of freezes) {
    const s = Date.parse(f.starts_at);
    const e = Date.parse(f.ends_at);
    if (!Number.isNaN(s) && !Number.isNaN(e) && e > s && s < to && e > from) {
      pieces.push({ kind: 'freeze', start: s, end: e, whole: s, freeze: f });
    }
  }

  return dates.map((date, i) => {
    const start = bounds[i];
    const end = bounds[i + 1];
    const day = { start, end };
    const marks: CalendarMark[] = [];
    for (const p of pieces) {
      const s = Math.max(p.start, start);
      const e = Math.min(p.end, end);
      if (e <= s) continue;
      const left = dayPosition(s, day, tz);
      const right = dayPosition(e, day, tz);
      marks.push({
        kind: p.kind,
        left,
        // An end inside the hour an autumn change repeats can read left of its start
        // on the wall clock; the elapsed length is the honest width there.
        width: right > left ? right - left : ((e - s) / (end - start)) * 100,
        fromPrev: p.start < start,
        toNext: p.end > end,
        lead: s === Math.max(p.whole, from),
        slot: p.slot,
        freeze: p.freeze,
      });
    }
    // Windows under freezes, each layer in time order.
    marks.sort((a, b) => Number(a.kind === 'freeze') - Number(b.kind === 'freeze') || a.left - b.left);
    // A freeze that starts its words on this row speaks for what it cancels under them.
    const worded = marks.filter((m) => m.kind === 'freeze' && m.lead);
    for (const m of marks) {
      if (m.kind === 'cut' && worded.some((f) => m.left >= f.left && m.left < f.left + f.width)) m.lead = false;
    }
    return { date, weekday: weekdayOf(date), start, end, marks };
  });
}
