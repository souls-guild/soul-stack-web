import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronDown, Copy, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { Badge, Button } from '../../components/primitives';
import {
  keeperApi,
  type Freeze,
  type MaintenanceDefaultWindow,
  type MaintenanceStatus,
  type MaintenanceWindow,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import {
  browserTimeZone,
  effectiveWindows,
  formatDays,
  formatFreezeRange,
  formatFreezeRangeShort,
  formatOnceRange,
  freezeCovers,
  freezesKey,
  isOnce,
  slotEnd,
  statusChangeAt,
  STATUS_REFRESH,
  windowCounts,
  windowsKey,
  withComment,
  type EffectiveWindow,
  type Weekday,
} from './maintenance';
import {
  CopyWindowsModal,
  DeleteMaintenanceModal,
  FreezeModal,
  NextDayMark,
  WindowModal,
  type DeleteTarget,
  type WindowKind,
} from './MaintenanceModals';
import { MaintenanceCalendar } from './MaintenanceCalendar';
import { MaintenanceStatusBlock } from './MaintenanceStatusBlock';
import styles from '../common.module.css';
import css from './MaintenanceTab.module.css';

// The maintenance windows tab (ADR-0093, NIM-1076, NIM-1136): the server's status
// over an incarnation's windows and freezes, a calendar of them, then the lists —
// weekly windows, one-off windows, freezes.

function isDegraded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

type FreezePhase = 'active' | 'upcoming' | 'past';

function freezePhase(f: Freeze, now: Date): FreezePhase {
  if (freezeCovers(f, now)) return 'active';
  return new Date(f.starts_at) > now ? 'upcoming' : 'past';
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Asks for the status again a second after the instant it is due to change (see
 * STATUS_REFRESH). While the answers stay the same and the retry minute lasts, the
 * instant is the one worked out from the first of them: worked out again from a
 * later answer, one that is late to change no longer has an instant to retry against.
 */
function useRefetchAtChange(
  status: MaintenanceStatus | undefined,
  windows: EffectiveWindow[],
  freezes: Freeze[] | undefined,
  answeredAt: number,
  refetch: () => unknown,
) {
  const changeRef = useRef<{ key: string; at: number | null } | null>(null);
  useEffect(() => {
    if (!status) return;
    // next_start is the answer's own time while open, so it does not tell answers apart.
    const key = JSON.stringify([
      status.open_now,
      status.active_freeze ?? null,
      status.open_now ? null : status.next_start,
      windows,
      freezes ?? null,
    ]);
    const prev = changeRef.current;
    const retrying = prev?.key === key && prev.at !== null && Date.now() - prev.at <= STATUS_REFRESH.staleRetryForMs;
    if (!retrying) {
      changeRef.current = { key, at: statusChangeAt(status, windows, freezes, new Date(answeredAt))?.getTime() ?? null };
    }
    const at = changeRef.current?.at ?? null;
    if (at === null) return;
    const late = Date.now() - at;
    if (late > STATUS_REFRESH.staleRetryForMs) return;
    const delay = late >= 0 ? STATUS_REFRESH.staleRetryMs : Math.min(1000 - late, MAX_TIMEOUT_MS);
    const id = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(id);
  }, [status, windows, freezes, answeredAt, refetch]);
}

/** «Add window», which asks which kind first. */
function AddWindowMenu({ onPick }: { onPick: (kind: WindowKind) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // On the document, not the menu: a click on the menu's own padding takes focus off its items.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    const list = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const pick = (kind: WindowKind) => {
    setOpen(false);
    onPick(kind);
  };

  return (
    <div className={css.menuWrap} ref={ref}>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="mw-add"
      >
        <Plus size={14} />
        {t('incarnations:mwAdd')}
        <ChevronDown size={13} className={css.caret} />
      </Button>
      {open ? (
        <div className={css.menu} role="menu" onKeyDown={onMenuKey}>
          <button type="button" role="menuitem" className={css.menuItem} onClick={() => pick('weekly')} data-testid="mw-add-weekly">
            <Repeat size={15} className={css.menuIcon} />
            <span>
              <b>{t('incarnations:mwAddWeekly')}</b>
              <small>{t('incarnations:mwAddWeeklyHint')}</small>
            </span>
          </button>
          <button type="button" role="menuitem" className={css.menuItem} onClick={() => pick('once')} data-testid="mw-add-once">
            <CalendarClock size={15} className={css.menuIcon} />
            <span>
              <b>{t('incarnations:mwAddOnce')}</b>
              <small>{t('incarnations:mwAddOnceHint')}</small>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function MaintenanceTab({ incarnationName }: { incarnationName: string }) {
  const { t } = useTranslation();
  const { hasPermission } = useMyPermissions();
  const canWrite = hasPermission('incarnation.maintenance-set');
  const tz = browserTimeZone();
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);

  const [windowModal, setWindowModal] = useState<{ editing: MaintenanceWindow | null; kind: WindowKind } | null>(null);
  const [freezeModal, setFreezeModal] = useState<{ editing: Freeze | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [showPastOnce, setShowPastOnce] = useState(false);

  const windows = useQuery({
    queryKey: windowsKey(incarnationName),
    queryFn: () => keeperApi.maintenance.listWindows(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
    refetchInterval: STATUS_REFRESH.beatMs,
  });
  const freezes = useQuery({
    queryKey: freezesKey(incarnationName),
    queryFn: () => keeperApi.maintenance.listFreezes(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
    refetchInterval: STATUS_REFRESH.beatMs,
  });

  const windowRows = useMemo(() => windows.data?.items ?? [], [windows.data]);
  const freezeRows = useMemo(() => freezes.data?.items ?? [], [freezes.data]);
  const effective = useMemo(
    () => effectiveWindows(windows.data?.items ?? [], windows.data?.defaults),
    [windows.data],
  );
  const weeklyRows = windowRows.filter((w) => !isOnce(w));
  const defaultRows: MaintenanceDefaultWindow[] = weeklyRows.length === 0 ? (windows.data?.defaults ?? []) : [];
  const onceRows = windowRows.filter(isOnce).sort((a, b) => Date.parse(a.starts_at ?? '') - Date.parse(b.starts_at ?? ''));

  // A fresh answer is read against the time it arrived, not the last tick.
  const tick = useNow(STATUS_REFRESH.tickMs);
  const now = new Date(Math.max(tick.getTime(), windows.dataUpdatedAt, freezes.dataUpdatedAt));
  const visibleFreezes = freezeRows.filter((f) => showPast || freezePhase(f, now) !== 'past');
  const pastCount = freezeRows.filter((f) => freezePhase(f, now) === 'past').length;
  const visibleOnce = onceRows.filter((w) => showPastOnce || windowCounts(w, now));
  const pastOnceCount = onceRows.filter((w) => !windowCounts(w, now)).length;

  useRefetchAtChange(
    freezes.isLoading ? undefined : windows.data?.status,
    effective,
    freezes.data ? freezeRows : undefined,
    windows.dataUpdatedAt,
    windows.refetch,
  );

  function windowSummary(w: MaintenanceWindow): string {
    if (isOnce(w)) {
      return withComment(formatOnceRange(w.starts_at ?? '', w.ends_at ?? '', tz, now), w.comment);
    }
    const end = slotEnd(w.start_time ?? '', w.duration_minutes ?? 0);
    return withComment(`${formatDays(w.days, dayLabel)} ${w.start_time}–${end.end} ${w.timezone}`, w.comment);
  }

  if (isDegraded(windows.error)) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('incarnations:tabMaintenance')}</h2>
        <div className={styles.empty} data-testid="maintenance-degraded">
          {t('incarnations:mwDegraded', { status: (windows.error as ApiError).status })}
        </div>
      </section>
    );
  }

  const editActions = (onEdit: () => void, onDelete: () => void, aria: { edit: string; del: string }, id: string, prefix: string) => (
    <td className={css.act}>
      <Button type="button" variant="ghost" onClick={onEdit} aria-label={aria.edit} data-testid={`${prefix}-edit-${id}`}>
        <Pencil size={13} />
      </Button>
      <Button type="button" variant="ghost" onClick={onDelete} aria-label={aria.del} data-testid={`${prefix}-delete-${id}`}>
        <Trash2 size={13} />
      </Button>
    </td>
  );
  const windowAria = { edit: t('incarnations:mwEditAria'), del: t('incarnations:mwDeleteAria') };
  const freezeAria = { edit: t('incarnations:freezeEditAria'), del: t('incarnations:freezeDeleteAria') };

  const loadError = (err: unknown) =>
    err ? (
      <div className={styles.errorBox}>
        {err instanceof ApiError ? t('errors:generic', { status: err.status, detail: err.message }) : String(err)}
      </div>
    ) : null;

  return (
    <section className={styles.section} data-testid="maintenance-tab">
      <div className={css.head}>
        <h2 className={styles.sectionTitle} style={{ margin: 0, flex: 1 }}>{t('incarnations:tabMaintenance')}</h2>
        {canWrite ? (
          <div className={css.actions}>
            <Button type="button" variant="ghost" style={{ fontSize: 13 }} onClick={() => setCopyOpen(true)} data-testid="mw-copy-open">
              <Copy size={13} />
              {t('incarnations:mwCopyOpen')}
            </Button>
            <AddWindowMenu onPick={(kind) => setWindowModal({ editing: null, kind })} />
            <Button type="button" variant="secondary" onClick={() => setFreezeModal({ editing: null })} data-testid="freeze-add">
              <Plus size={14} />
              {t('incarnations:freezeAdd')}
            </Button>
          </div>
        ) : null}
      </div>

      {windows.data && !freezes.isLoading ? (
        <MaintenanceStatusBlock
          status={windows.data.status}
          windows={effective}
          freezes={freezes.data ? freezeRows : undefined}
          tz={tz}
          now={now}
        />
      ) : null}

      {windows.data && !freezes.isLoading ? (
        <MaintenanceCalendar
          windows={effective}
          freezes={freezeRows}
          tz={tz}
          now={now}
          canWrite={canWrite}
          onEditWindow={(w) => setWindowModal({ editing: w, kind: isOnce(w) ? 'once' : 'weekly' })}
          onEditFreeze={(f) => setFreezeModal({ editing: f })}
        />
      ) : null}

      <div className={css.group} data-testid="mw-windows-section">
        <div className={css.groupHead}>
          <h3 className={css.groupTitle}>{t('incarnations:mwWeeklyTitle')}</h3>
          {defaultRows.length > 0 ? <span className={css.tag}>{t('incarnations:mwDefaultTag')}</span> : null}
        </div>

        {windows.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
        {loadError(windows.error)}

        {weeklyRows.length > 0 ? (
          <table className={styles.table} data-testid="mw-table">
            <thead>
              <tr>
                <th>{t('incarnations:mwColDays')}</th>
                <th>{t('incarnations:mwColTime')}</th>
                <th>{t('incarnations:mwColTimezone')}</th>
                <th>{t('incarnations:mwColComment')}</th>
                {canWrite ? <th aria-label={t('incarnations:mwColActions')} /> : null}
              </tr>
            </thead>
            <tbody>
              {weeklyRows.map((w) => (
                <WeeklyRow key={w.id} w={w} testId={`mw-row-${w.id}`} dayLabel={dayLabel}>
                  {canWrite
                    ? editActions(
                        () => setWindowModal({ editing: w, kind: 'weekly' }),
                        () => setDeleteTarget({ kind: 'window', row: w, summary: windowSummary(w) }),
                        windowAria,
                        w.id,
                        'mw',
                      )
                    : null}
                </WeeklyRow>
              ))}
            </tbody>
          </table>
        ) : null}

        {defaultRows.length > 0 ? (
          <>
            <table className={`${styles.table} ${css.readOnly}`} data-testid="mw-defaults-table">
              <thead>
                <tr>
                  <th>{t('incarnations:mwColDays')}</th>
                  <th>{t('incarnations:mwColTime')}</th>
                  <th>{t('incarnations:mwColTimezone')}</th>
                  <th>{t('incarnations:mwColComment')}</th>
                </tr>
              </thead>
              <tbody>
                {defaultRows.map((w, i) => (
                  <WeeklyRow key={i} w={w} testId={`mw-default-row-${i}`} dayLabel={dayLabel} />
                ))}
              </tbody>
            </table>
            <div className={css.note} data-testid="mw-defaults-note">
              <Trans
                i18nKey="incarnations:mwDefaultNote"
                values={{ key: 'maintenance.default_windows' }}
                components={{ code: <code className={css.key} /> }}
              />
            </div>
          </>
        ) : null}

        {windows.data && weeklyRows.length === 0 && defaultRows.length === 0 ? (
          <div className={`${styles.empty} ${css.compact}`} data-testid="mw-empty">{t('incarnations:mwWeeklyEmpty')}</div>
        ) : null}
      </div>

      <div className={css.two}>
        <div className={css.group} data-testid="mw-once-section">
          <div className={css.groupHead}>
            <h3 className={css.groupTitle}>{t('incarnations:mwOnceTitle')}</h3>
          </div>
          {windows.data && visibleOnce.length === 0 ? (
            <div className={`${styles.empty} ${css.compact}`} data-testid="mw-once-empty">{t('incarnations:mwOnceEmpty')}</div>
          ) : null}
          {visibleOnce.length > 0 ? (
            <table className={styles.table} data-testid="mw-once-table">
              <thead>
                <tr>
                  <th>{t('incarnations:freezeColRange', { tz })}</th>
                  <th>{t('incarnations:mwColComment')}</th>
                  {canWrite ? <th aria-label={t('incarnations:mwColActions')} /> : null}
                </tr>
              </thead>
              <tbody>
                {visibleOnce.map((w) => {
                  const past = !windowCounts(w, now);
                  return (
                    <tr key={w.id} data-testid={`mw-once-row-${w.id}`} className={past ? css.pastRow : undefined}>
                      <td className="mono" title={`${w.starts_at} – ${w.ends_at}`}>
                        {formatOnceRange(w.starts_at ?? '', w.ends_at ?? '', tz, now)}
                      </td>
                      <CommentCell comment={w.comment} />
                      {canWrite
                        ? editActions(
                            () => setWindowModal({ editing: w, kind: 'once' }),
                            () => setDeleteTarget({ kind: 'window', row: w, summary: windowSummary(w) }),
                            windowAria,
                            w.id,
                            'mw',
                          )
                        : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
          {pastOnceCount > 0 ? (
            <button type="button" className={css.linkButton} onClick={() => setShowPastOnce((v) => !v)} data-testid="mw-once-toggle-past">
              {showPastOnce ? t('incarnations:mwOnceHidePast') : t('incarnations:mwOnceShowPast', { n: pastOnceCount })}
            </button>
          ) : null}
        </div>

        <div className={css.group} data-testid="freeze-section">
          <div className={css.groupHead}>
            <h3 className={css.groupTitle}>{t('incarnations:freezesTitle')}</h3>
          </div>
          {freezes.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
          {loadError(freezes.error)}
          {freezes.data && visibleFreezes.length === 0 ? (
            <div className={`${styles.empty} ${css.compact}`} data-testid="freeze-empty">{t('incarnations:freezesEmpty')}</div>
          ) : null}
          {visibleFreezes.length > 0 ? (
            <table className={styles.table} data-testid="freeze-table">
              <thead>
                <tr>
                  <th>{t('incarnations:freezeColRange', { tz })}</th>
                  <th>{t('incarnations:mwColComment')}</th>
                  <th>{t('common:colStatus')}</th>
                  {canWrite ? <th aria-label={t('incarnations:mwColActions')} /> : null}
                </tr>
              </thead>
              <tbody>
                {visibleFreezes.map((f) => {
                  const phase = freezePhase(f, now);
                  return (
                    <tr key={f.id} data-testid={`freeze-row-${f.id}`} className={phase === 'past' ? css.pastRow : undefined}>
                      <td className="mono" title={`${f.starts_at} – ${f.ends_at}`}>
                        {formatFreezeRangeShort(f.starts_at, f.ends_at, tz, now)}
                      </td>
                      <CommentCell comment={f.comment} />
                      <td>
                        <Badge tone={phase === 'active' ? 'danger' : phase === 'upcoming' ? 'warn' : 'muted'}>
                          {t(`incarnations:freezePhase_${phase}`)}
                        </Badge>
                      </td>
                      {canWrite
                        ? editActions(
                            () => setFreezeModal({ editing: f }),
                            () =>
                              setDeleteTarget({
                                kind: 'freeze',
                                row: f,
                                summary: withComment(formatFreezeRange(f.starts_at, f.ends_at, tz), f.comment),
                              }),
                            freezeAria,
                            f.id,
                            'freeze',
                          )
                        : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
          {pastCount > 0 ? (
            <button type="button" className={css.linkButton} onClick={() => setShowPast((v) => !v)} data-testid="freeze-toggle-past">
              {showPast ? t('incarnations:freezeHidePast') : t('incarnations:freezeShowPast', { n: pastCount })}
            </button>
          ) : null}
        </div>
      </div>

      <WindowModal
        open={windowModal !== null}
        incarnationName={incarnationName}
        editing={windowModal?.editing ?? null}
        kind={windowModal?.kind}
        onClose={() => setWindowModal(null)}
      />
      <FreezeModal
        open={freezeModal !== null}
        incarnationName={incarnationName}
        editing={freezeModal?.editing ?? null}
        onClose={() => setFreezeModal(null)}
      />
      <DeleteMaintenanceModal
        target={deleteTarget}
        incarnationName={incarnationName}
        onClose={() => setDeleteTarget(null)}
      />
      <CopyWindowsModal
        open={copyOpen}
        incarnationName={incarnationName}
        currentWindows={windowRows.filter((w) => windowCounts(w, now))}
        onClose={() => setCopyOpen(false)}
      />
    </section>
  );
}

function WeeklyRow({
  w,
  testId,
  dayLabel,
  children,
}: {
  w: Pick<MaintenanceWindow, 'days' | 'start_time' | 'duration_minutes' | 'timezone'> & { comment?: string | null };
  testId: string;
  dayLabel: (d: Weekday) => string;
  children?: React.ReactNode;
}) {
  const end = slotEnd(w.start_time ?? '', w.duration_minutes ?? 0);
  return (
    <tr data-testid={testId}>
      <td style={{ fontWeight: 500 }}>{formatDays(w.days, dayLabel)}</td>
      <td className="mono">
        {w.start_time}–{end.end}
        {end.nextDay ? <NextDayMark /> : null}
      </td>
      <td className="mono">{w.timezone}</td>
      <CommentCell comment={w.comment} />
      {children}
    </tr>
  );
}

function CommentCell({ comment }: { comment: string | null | undefined }) {
  return comment ? <td className={css.comment}>{comment}</td> : <td className={css.noComment}>—</td>;
}
