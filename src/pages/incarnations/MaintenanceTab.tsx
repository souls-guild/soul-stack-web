import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button } from '../../components/primitives';
import { keeperApi, type Freeze, type MaintenanceStatus, type MaintenanceWindow } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import {
  browserTimeZone,
  formatDays,
  formatFreezeRange,
  freezeCovers,
  freezesKey,
  slotEnd,
  statusChangeAt,
  STATUS_REFRESH,
  windowsKey,
  withComment,
  type Weekday,
} from './maintenance';
import {
  CopyWindowsModal,
  DeleteMaintenanceModal,
  FreezeModal,
  NextDayMark,
  WindowModal,
  type DeleteTarget,
} from './MaintenanceModals';
import { MaintenanceStatusBlock } from './MaintenanceStatusBlock';
import styles from '../common.module.css';

// The maintenance windows tab (ADR-0093, NIM-1076): the server's status over an
// incarnation's windows and freezes, then both lists.

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
  windows: MaintenanceWindow[],
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

export function MaintenanceTab({ incarnationName }: { incarnationName: string }) {
  const { t } = useTranslation();
  const { hasPermission } = useMyPermissions();
  const canWrite = hasPermission('incarnation.maintenance-set');
  const tz = browserTimeZone();
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);

  const [windowModal, setWindowModal] = useState<{ editing: MaintenanceWindow | null } | null>(null);
  const [freezeModal, setFreezeModal] = useState<{ editing: Freeze | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

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

  const windowRows = windows.data?.items ?? [];
  const freezeRows = freezes.data?.items ?? [];
  // A fresh answer is read against the time it arrived, not the last tick.
  const tick = useNow(STATUS_REFRESH.tickMs);
  const now = new Date(Math.max(tick.getTime(), windows.dataUpdatedAt, freezes.dataUpdatedAt));
  const visibleFreezes = freezeRows.filter((f) => showPast || freezePhase(f, now) !== 'past');
  const pastCount = freezeRows.length - freezeRows.filter((f) => freezePhase(f, now) !== 'past').length;

  useRefetchAtChange(
    freezes.isLoading ? undefined : windows.data?.status,
    windowRows,
    freezes.data ? freezeRows : undefined,
    windows.dataUpdatedAt,
    windows.refetch,
  );

  function windowSummary(w: MaintenanceWindow): string {
    const end = slotEnd(w.start_time, w.duration_minutes);
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

  return (
    <section className={styles.section} data-testid="maintenance-tab">
      <div style={headRowStyle}>
        <h2 className={styles.sectionTitle} style={{ margin: 0, flex: 1 }}>{t('incarnations:tabMaintenance')}</h2>
        {canWrite ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button type="button" variant="ghost" style={{ fontSize: 13 }} onClick={() => setCopyOpen(true)} data-testid="mw-copy-open">
              <Copy size={13} style={iconStyle} />
              {t('incarnations:mwCopyOpen')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setWindowModal({ editing: null })} data-testid="mw-add">
              <Plus size={14} style={iconStyle} />
              {t('incarnations:mwAdd')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setFreezeModal({ editing: null })} data-testid="freeze-add">
              <Plus size={14} style={iconStyle} />
              {t('incarnations:freezeAdd')}
            </Button>
          </div>
        ) : null}
      </div>

      {windows.data && !freezes.isLoading ? (
        <MaintenanceStatusBlock
          status={windows.data.status}
          windows={windowRows}
          freezes={freezes.data ? freezeRows : undefined}
          tz={tz}
          now={now}
        />
      ) : null}

      <div style={groupStyle} data-testid="mw-windows-section">
        <div style={groupHeadStyle}>
          <h3 style={groupTitleStyle}>{t('incarnations:mwWindowsTitle')}</h3>
          <p style={descStyle}>{t('incarnations:mwDesc')}</p>
        </div>

        {windows.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
        {windows.error ? (
          <div className={styles.errorBox}>
            {windows.error instanceof ApiError
              ? t('errors:generic', { status: windows.error.status, detail: windows.error.message })
              : String(windows.error)}
          </div>
        ) : null}

        {windows.data && windowRows.length === 0 ? (
          <div className={styles.empty} data-testid="mw-empty">{t('incarnations:mwEmpty')}</div>
        ) : null}
        {windowRows.length > 0 ? (
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
              {windowRows.map((w) => {
                const end = slotEnd(w.start_time, w.duration_minutes);
                return (
                  <tr key={w.id} data-testid={`mw-row-${w.id}`}>
                    <td style={{ fontWeight: 500 }}>{formatDays(w.days, dayLabel)}</td>
                    <td className="mono">
                      {w.start_time}–{end.end}
                      {end.nextDay ? <NextDayMark /> : null}
                    </td>
                    <td className="mono">{w.timezone}</td>
                    <CommentCell comment={w.comment} />
                    {canWrite ? (
                      <td style={actionsCellStyle}>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setWindowModal({ editing: w })}
                          aria-label={t('incarnations:mwEditAria')}
                          data-testid={`mw-edit-${w.id}`}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setDeleteTarget({ kind: 'window', row: w, summary: windowSummary(w) })}
                          aria-label={t('incarnations:mwDeleteAria')}
                          data-testid={`mw-delete-${w.id}`}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>

      <div style={groupStyle} data-testid="freeze-section">
        <div style={groupHeadStyle}>
          <h3 style={groupTitleStyle}>{t('incarnations:freezesTitle')}</h3>
          <p style={descStyle}>{t('incarnations:freezesDesc')}</p>
        </div>

        {freezes.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
        {freezes.error ? (
          <div className={styles.errorBox}>
            {freezes.error instanceof ApiError
              ? t('errors:generic', { status: freezes.error.status, detail: freezes.error.message })
              : String(freezes.error)}
          </div>
        ) : null}
        {freezes.data && visibleFreezes.length === 0 ? (
          <div className={styles.empty} data-testid="freeze-empty">{t('incarnations:freezesEmpty')}</div>
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
                const range = formatFreezeRange(f.starts_at, f.ends_at, tz);
                return (
                  <tr key={f.id} data-testid={`freeze-row-${f.id}`} style={phase === 'past' ? { opacity: 0.6 } : undefined}>
                    <td className="mono" title={`${f.starts_at} – ${f.ends_at}`}>{range}</td>
                    <CommentCell comment={f.comment} />
                    <td>
                      <Badge tone={phase === 'active' ? 'danger' : phase === 'upcoming' ? 'warn' : 'muted'}>
                        {t(`incarnations:freezePhase_${phase}`)}
                      </Badge>
                    </td>
                    {canWrite ? (
                      <td style={actionsCellStyle}>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setFreezeModal({ editing: f })}
                          aria-label={t('incarnations:freezeEditAria')}
                          data-testid={`freeze-edit-${f.id}`}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setDeleteTarget({ kind: 'freeze', row: f, summary: withComment(range, f.comment) })}
                          aria-label={t('incarnations:freezeDeleteAria')}
                          data-testid={`freeze-delete-${f.id}`}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {pastCount > 0 ? (
          <button type="button" style={linkButtonStyle} onClick={() => setShowPast((v) => !v)} data-testid="freeze-toggle-past">
            {showPast ? t('incarnations:freezeHidePast') : t('incarnations:freezeShowPast', { n: pastCount })}
          </button>
        ) : null}
      </div>

      <WindowModal
        open={windowModal !== null}
        incarnationName={incarnationName}
        editing={windowModal?.editing ?? null}
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
        currentWindows={windowRows}
        onClose={() => setCopyOpen(false)}
      />
    </section>
  );
}

function CommentCell({ comment }: { comment: string | null | undefined }) {
  return comment ? <td style={commentStyle}>{comment}</td> : <td style={noCommentStyle}>—</td>;
}

const headRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 };
const groupStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 };
const groupHeadStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const groupTitleStyle: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' };
const descStyle: React.CSSProperties = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
const iconStyle: React.CSSProperties = { marginRight: 6, verticalAlign: 'middle' };
const commentStyle: React.CSSProperties = { color: 'var(--text-muted)' };
const noCommentStyle: React.CSSProperties = { color: 'var(--text-faint)' };
const actionsCellStyle: React.CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap', width: 1 };
const linkButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  color: 'var(--text-muted)',
  fontSize: 12.5,
  cursor: 'pointer',
  textDecoration: 'underline',
  alignSelf: 'flex-start',
};
