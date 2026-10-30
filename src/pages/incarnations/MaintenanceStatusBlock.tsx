import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Check, Clock, Snowflake } from 'lucide-react';
import type { Freeze, MaintenanceStatus } from '../../api/keeper';
import { useTimeZone } from '../../hooks/useTimeZone';
import {
  formatFreezeRangeShort,
  formatInstant,
  frozenUntil,
  instantParts,
  nextFreeze,
  noWindowsInEffect,
  openRunEnd,
  slotAt,
  type EffectiveWindow,
  type Weekday,
} from './maintenance';
import css from './MaintenanceStatusBlock.module.css';

// The top of the maintenance windows tab: the server's status over the windows and
// freezes, as one card whose look follows the state. `windows` are the ones in
// effect (see effectiveWindows). `freezes` is undefined when the list failed to
// load: the card then leaves out the end of an open stretch and the freeze ahead,
// and shows a freeze in force to its own end.

export type MaintenanceState = 'closed' | 'open' | 'always' | 'frozen';

/** "1 h 10 min", "45 min", "2 d 3 h" — rounded to the minute, never below one. */
function spanText(ms: number, t: TFunction): string {
  const total = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(total / (24 * 60));
  const h = Math.floor((total % (24 * 60)) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? t('incarnations:mwSpanDayHour', { d, h }) : t('incarnations:mwSpanDays', { d });
  if (h > 0) return m > 0 ? t('incarnations:mwSpanHourMinute', { h, m }) : t('incarnations:mwSpanHours', { h });
  return t('incarnations:mwSpanMinutes', { m });
}

export function MaintenanceStatusBlock({
  status,
  windows,
  freezes,
  tz,
  now,
}: {
  status: MaintenanceStatus;
  windows: EffectiveWindow[];
  freezes: Freeze[] | undefined;
  tz: string;
  now: Date;
}) {
  const { t } = useTranslation();
  const { browser } = useTimeZone();
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);
  // A Keeper before the cluster default has no source; then the default cannot apply.
  const fromDefault = status.source === 'default' || windows.some((w) => w.origin === 'default');

  let state: MaintenanceState;
  let title: string;
  const sub: ReactNode[] = [];
  // A freeze ahead is one after the run of freezes in force, not one the title spans.
  let aheadFrom = now;

  if (status.active_freeze) {
    const f = status.active_freeze;
    state = 'frozen';
    const end = frozenUntil(freezes ?? [], f);
    const until = Number.isNaN(end.getTime()) ? f.ends_at : end.toISOString();
    if (!Number.isNaN(end.getTime())) aheadFrom = end;
    title = t('incarnations:mwStatusFrozen', { until: formatInstant(until, tz, dayLabel, now) });
    if (f.comment) sub.push(f.comment);
    sub.push(t('incarnations:mwStatusConsent'));
  } else if (status.open_now && noWindowsInEffect(status.source, windows, now)) {
    state = 'always';
    title = t('incarnations:mwStatusAlways');
    sub.push(t('incarnations:mwStatusNoWindows'));
  } else if (status.open_now) {
    state = 'open';
    title = t('incarnations:mwStatusOpen');
    const run = freezes ? openRunEnd(windows, freezes, now) : null;
    if (run?.kind === 'until') {
      const p = instantParts(run.at.toISOString(), tz, dayLabel, now);
      sub.push(t('incarnations:mwStatusUntil', { at: p.today ? p.time : `${p.day} ${p.time}` }));
    } else if (run?.kind === 'unbounded') {
      sub.push(t('incarnations:mwStatusNoBreak'));
    }
    const comment = slotAt(windows, now)?.window.comment;
    if (comment) sub.push(comment);
  } else {
    state = 'closed';
    title = t('incarnations:mwStatusClosed');
    const next = new Date(status.next_start);
    const p = instantParts(status.next_start, tz, dayLabel, now);
    sub.push(
      <>
        {t('incarnations:mwStatusOpens')}{' '}
        <b title={status.next_start}>{t('incarnations:mwStatusDayAt', { day: p.day, time: p.time })}</b>
      </>,
    );
    if (!Number.isNaN(next.getTime())) {
      sub.push(t('incarnations:mwStatusIn', { span: spanText(next.getTime() - now.getTime(), t) }));
      const comment = slotAt(windows, next)?.window.comment;
      if (comment) sub.push(comment);
    }
  }

  const ahead = freezes ? nextFreeze(freezes, aheadFrom) : undefined;
  const aheadRange = ahead ? formatFreezeRangeShort(ahead.starts_at, ahead.ends_at, tz, now) : '';
  const Icon = state === 'frozen' ? Snowflake : state === 'closed' ? Clock : Check;

  return (
    <div
      className={`${css.status} ${state === 'always' ? css.open : css[state]}`}
      data-testid="mw-status"
      data-state={state}
    >
      <div className={css.dot} aria-hidden>
        <Icon size={state === 'closed' ? 20 : 18} strokeWidth={2} />
      </div>
      <div className={css.main}>
        <div className={css.title} data-testid="mw-status-title">{title}</div>
        {sub.length > 0 ? (
          <div className={css.sub} data-testid="mw-status-sub">
            {sub.map((part, i) => (
              <Fragment key={i}>
                {i > 0 ? ' · ' : null}
                {part}
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
      <div className={css.side}>
        {fromDefault && state !== 'always' ? (
          <span className={`${css.chip} ${css.neutral}`} title={t('incarnations:mwDefaultHint')} data-testid="mw-status-default">
            {t('incarnations:mwStatusDefault')}
          </span>
        ) : null}
        {ahead ? (
          <span className={css.chip} title={`${ahead.starts_at} – ${ahead.ends_at}`} data-testid="mw-status-freeze-ahead">
            {t('incarnations:mwStatusFreezeAhead', { what: ahead.comment ? `${ahead.comment}, ${aheadRange}` : aheadRange })}
          </span>
        ) : null}
        <span data-testid="mw-status-zone">
          {t(browser ? 'incarnations:mwStatusZone' : 'incarnations:mwStatusZoneChosen')} <span className={css.zone}>{tz}</span>
        </span>
      </div>
    </div>
  );
}
