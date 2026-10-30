import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Freeze, MaintenanceWindow } from '../../api/keeper';
import {
  WEEKDAYS,
  calendarDays,
  dayPosition,
  formatDays,
  formatFreezeRange,
  formatOnceRange,
  monthGrid,
  monthStart,
  shiftDay,
  slotEnd,
  wallDate,
  weekStart,
  withComment,
  type CalendarDay,
  type CalendarMark,
  type EffectiveWindow,
  type Weekday,
} from './maintenance';
import css from './MaintenanceCalendar.module.css';

// The calendar of the maintenance windows tab (NIM-1136): a week of rows, or a
// month of days, with the weekly windows in effect, the one-off windows and the
// freezes, in the browser's zone. It draws what the lists hold; the status block
// above is what says whether a run may start.

type View = 'week' | 'month';

const HOURS = ['00', '03', '06', '09', '12', '15', '18', '21'];

function intlLocale(lang: string): string {
  // en-GB puts the day first, as the rest of the tab does ("26 October").
  return lang.startsWith('ru') ? 'ru' : 'en-GB';
}

function utcOf(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dayMonth(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(utcOf(date));
}

/** "26 October – 1 November 2026", "2 – 8 November 2026"; a year on each side when the week spans two. */
function weekLabel(first: string, last: string, locale: string): string {
  const y1 = first.slice(0, 4);
  const y2 = last.slice(0, 4);
  if (y1 !== y2) return `${dayMonth(first, locale)} ${y1} – ${dayMonth(last, locale)} ${y2}`;
  const from = first.slice(0, 7) === last.slice(0, 7) ? String(Number(first.slice(8, 10))) : dayMonth(first, locale);
  return `${from} – ${dayMonth(last, locale)} ${y2}`;
}

/** "October 2026": the standalone month name, which Russian declines differently from "26 October". */
function monthLabel(date: string, locale: string): string {
  const name = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(utcOf(date));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${date.slice(0, 4)}`;
}

const ddmm = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

function hhmm(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(ms));
}

export function MaintenanceCalendar({
  windows,
  freezes,
  tz,
  now,
  canWrite,
  onEditWindow,
  onEditFreeze,
}: {
  windows: EffectiveWindow[];
  freezes: Freeze[];
  tz: string;
  now: Date;
  canWrite: boolean;
  onEditWindow: (w: MaintenanceWindow) => void;
  onEditFreeze: (f: Freeze) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language ?? 'en');
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);
  const today = wallDate(now, tz);
  const [view, setView] = useState<View>('week');
  // null follows today, so a tab left open over midnight moves on with the date.
  const [picked, setPicked] = useState<string | null>(null);
  const anchor = picked ?? today;

  const grid = view === 'week' ? { first: weekStart(anchor), count: 7 } : monthGrid(anchor);
  const days = useMemo(
    () => calendarDays(grid.first, grid.count, tz, windows, freezes),
    [grid.first, grid.count, tz, windows, freezes],
  );
  const label =
    view === 'week' ? weekLabel(grid.first, shiftDay(grid.first, 6), locale) : monthLabel(monthStart(anchor), locale);
  const hasDefaults = windows.some((w) => w.origin === 'default');
  const nowMs = now.getTime();

  function step(dir: 1 | -1) {
    setPicked(view === 'week' ? shiftDay(weekStart(anchor), 7 * dir) : monthStart(anchor, dir));
  }

  function words(m: CalendarMark): string {
    if (m.freeze) return withComment(t('incarnations:mwCalFreeze'), m.freeze.comment);
    return m.slot?.window.comment ?? '';
  }

  function describe(m: CalendarMark): string {
    if (m.freeze) {
      return withComment(`${t('incarnations:mwCalKind_freeze')} · ${formatFreezeRange(m.freeze.starts_at, m.freeze.ends_at, tz)}`, m.freeze.comment);
    }
    const slot = m.slot;
    if (!slot) return '';
    const w = slot.window;
    const when =
      slot.origin === 'once'
        ? formatOnceRange(w.starts_at ?? '', w.ends_at ?? '', tz, now)
        : `${formatDays(w.days, dayLabel)} ${w.start_time}–${slotEnd(w.start_time ?? '', w.duration_minutes ?? 0).end} ${w.timezone}`;
    const kind = m.kind === 'cut' ? `${t(`incarnations:mwCalKind_${slot.origin}`)}, ${t('incarnations:mwCalKind_cut')}` : t(`incarnations:mwCalKind_${slot.origin}`);
    return withComment(`${kind} · ${when}`, w.comment);
  }

  function edit(m: CalendarMark): (() => void) | null {
    if (!canWrite) return null;
    if (m.freeze) {
      const f = m.freeze;
      return () => onEditFreeze(f);
    }
    const slot = m.slot;
    // A cluster default is set in Keeper's settings, not on the incarnation.
    if (!slot || slot.origin === 'default' || !slot.window.id) return null;
    const w = slot.window as MaintenanceWindow;
    return () => onEditWindow(w);
  }

  function mark(m: CalendarMark, i: number, compact: boolean) {
    const cls = [css.blk, css[m.kind], m.fromPrev ? css.fromPrev : '', m.toNext ? css.toNext : ''].filter(Boolean).join(' ');
    const style = { left: `${m.left}%`, width: `${m.width}%` };
    const plain = !compact && m.lead ? words(m) : '';
    // A freeze's words lie over the windows it cancels, so they get a ground of their own.
    const text = plain && m.kind === 'freeze' ? <span className={css.freezeWords}>{plain}</span> : plain;
    // A month cell's strip is too small to aim at: its notes and its date are the targets.
    const onClick = compact ? null : edit(m);
    const title = describe(m);
    const common = {
      className: cls,
      style,
      title,
      'aria-label': title,
      'data-testid': 'mw-cal-mark',
      'data-kind': m.kind,
      'data-ref': m.freeze?.id ?? m.slot?.window.id ?? 'default',
    };
    return onClick ? (
      <button key={i} type="button" {...common} onClick={onClick}>
        {text}
      </button>
    ) : (
      <div key={i} role="img" {...common}>
        {text}
      </div>
    );
  }

  function nowLine(d: CalendarDay, withLabel: boolean) {
    if (nowMs < d.start || nowMs >= d.end) return null;
    return (
      <div className={css.now} style={{ left: `${dayPosition(nowMs, d, tz)}%` }} data-testid="mw-cal-now">
        {withLabel ? <span className={css.nowLabel}>{t('incarnations:mwCalNow', { time: hhmm(nowMs, tz) })}</span> : null}
      </div>
    );
  }

  const dayState = (d: CalendarDay) => ({ isToday: d.date === today, isPast: d.end <= nowMs });

  return (
    <div className={css.cal} data-testid="mw-calendar" data-view={view}>
      <div className={css.top}>
        <div className={css.nav}>
          <button type="button" className={css.navBtn} onClick={() => step(-1)} aria-label={t('incarnations:mwCalPrev')} data-testid="mw-cal-prev">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className={css.navBtn} onClick={() => step(1)} aria-label={t('incarnations:mwCalNext')} data-testid="mw-cal-next">
            <ChevronRight size={16} />
          </button>
        </div>
        <span className={css.range} data-testid="mw-cal-range">{label}</span>
        <button type="button" className={css.todayBtn} onClick={() => setPicked(null)} data-testid="mw-cal-today">
          {t('incarnations:mwCalToday')}
        </button>
        <div className={css.seg} role="group" aria-label={t('incarnations:mwCalViewAria')}>
          {(['week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? css.on : undefined}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              data-testid={`mw-cal-${v}`}
            >
              {t(`incarnations:mwCalView_${v}`)}
            </button>
          ))}
        </div>
      </div>

      {view === 'week' ? (
        <>
          <div className={css.hours} aria-hidden>
            <span />
            <div className={css.scale}>
              {HOURS.map((h) => (
                <span key={h}>{h}</span>
              ))}
            </div>
          </div>
          <div className={css.rows}>
            {days.map((d) => {
              const { isToday, isPast } = dayState(d);
              return (
                <div
                  key={d.date}
                  className={[css.row, isPast ? css.past : '', isToday ? css.today : ''].filter(Boolean).join(' ')}
                  data-testid={`mw-cal-day-${d.date}`}
                  data-past={isPast || undefined}
                  data-today={isToday || undefined}
                >
                  <div className={css.day}>
                    <b>{dayLabel(d.weekday)}</b>
                    {ddmm(d.date)}
                  </div>
                  <div className={css.track}>
                    {d.marks.map((m, i) => mark(m, i, false))}
                    {nowLine(d, true)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className={css.month}>
          <div className={css.monthHead} aria-hidden>
            {WEEKDAYS.map((d) => (
              <span key={d}>{dayLabel(d)}</span>
            ))}
          </div>
          <div className={css.monthGrid}>
            {days.map((d) => {
              const { isToday, isPast } = dayState(d);
              const outside = d.date.slice(0, 7) !== monthStart(anchor).slice(0, 7);
              const notes = d.marks.filter((m) => m.lead && (m.kind === 'once' || m.kind === 'freeze'));
              return (
                <div
                  key={d.date}
                  className={[css.cell, isPast ? css.past : '', isToday ? css.today : '', outside ? css.outside : '']
                    .filter(Boolean)
                    .join(' ')}
                  data-testid={`mw-cal-day-${d.date}`}
                  data-past={isPast || undefined}
                  data-today={isToday || undefined}
                >
                  <button
                    type="button"
                    className={css.cellDate}
                    onClick={() => {
                      setPicked(d.date);
                      setView('week');
                    }}
                    title={t('incarnations:mwCalOpenWeek', { day: `${dayLabel(d.weekday)} ${ddmm(d.date)}` })}
                    aria-label={t('incarnations:mwCalOpenWeek', { day: `${dayLabel(d.weekday)} ${ddmm(d.date)}` })}
                  >
                    <b>{Number(d.date.slice(8, 10))}</b>
                  </button>
                  <div className={`${css.track} ${css.mini}`}>
                    {d.marks.map((m, i) => mark(m, i, true))}
                    {nowLine(d, false)}
                  </div>
                  {notes.slice(0, 2).map((m, i) => {
                    const onClick = edit(m);
                    const props = {
                      className: `${css.note} ${css[`note_${m.kind}`]}`,
                      title: describe(m),
                      'data-testid': 'mw-cal-note',
                      'data-kind': m.kind,
                    };
                    const label = words(m) || (m.slot ? t('incarnations:mwCalKind_once') : '');
                    return onClick ? (
                      <button key={i} type="button" {...props} onClick={onClick}>
                        {label}
                      </button>
                    ) : (
                      <div key={i} {...props}>
                        {label}
                      </div>
                    );
                  })}
                  {notes.length > 2 ? <div className={css.more}>+{notes.length - 2}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={css.legend}>
        {hasDefaults ? (
          <span>
            <i className={css.lgDefault} />
            {t('incarnations:mwCalLegendDefault')}
          </span>
        ) : (
          <span>
            <i className={css.lgWeekly} />
            {t('incarnations:mwCalLegendWeekly')}
          </span>
        )}
        <span>
          <i className={css.lgOnce} />
          {t('incarnations:mwCalLegendOnce')}
        </span>
        <span>
          <i className={css.lgFreeze} />
          {t('incarnations:mwCalLegendFreeze')}
        </span>
        <span>
          <i className={css.lgCut} />
          {t('incarnations:mwCalLegendCut')}
        </span>
        <span className={css.zone} data-testid="mw-cal-zone">
          {t('incarnations:mwCalZone', { tz })}
          {view === 'month'
            ? ` · ${t(canWrite ? 'incarnations:mwCalClickHintMonth' : 'incarnations:mwCalClickHintMonthRead')}`
            : canWrite
              ? ` · ${t('incarnations:mwCalClickHint')}`
              : ''}
        </span>
      </div>
    </div>
  );
}
