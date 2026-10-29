import { useState } from 'react';
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
  formatInstant,
  freezeCovers,
  freezesKey,
  slotEnd,
  windowsKey,
  type Weekday,
} from './maintenance';
import {
  CopyWindowsModal,
  DeleteMaintenanceModal,
  FreezeModal,
  WindowModal,
  type DeleteTarget,
} from './MaintenanceModals';
import styles from '../common.module.css';

// The «Тех. окна» tab (ADR-0093, NIM-1076): an incarnation's maintenance windows and
// freezes, and the server's status line over both.

function isDegraded(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

type FreezePhase = 'active' | 'upcoming' | 'past';

function freezePhase(f: Freeze, now: Date): FreezePhase {
  if (freezeCovers(f, now)) return 'active';
  return new Date(f.starts_at) > now ? 'upcoming' : 'past';
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
  });
  const freezes = useQuery({
    queryKey: freezesKey(incarnationName),
    queryFn: () => keeperApi.maintenance.listFreezes(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
  });

  const windowRows = windows.data?.items ?? [];
  const freezeRows = freezes.data?.items ?? [];
  const now = new Date();
  const visibleFreezes = freezeRows.filter((f) => showPast || freezePhase(f, now) !== 'past');
  const pastCount = freezeRows.length - freezeRows.filter((f) => freezePhase(f, now) !== 'past').length;

  function windowSummary(w: MaintenanceWindow): string {
    const end = slotEnd(w.start_time, w.duration_minutes);
    return `${formatDays(w.days, dayLabel)} ${w.start_time}–${end.end} ${w.timezone}`;
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
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>{t('incarnations:tabMaintenance')}</h2>
        {canWrite ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" variant="ghost" onClick={() => setCopyOpen(true)} data-testid="mw-copy-open">
              <Copy size={13} style={iconStyle} />
              {t('incarnations:mwCopyOpen')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setWindowModal({ editing: null })} data-testid="mw-add">
              <Plus size={14} style={iconStyle} />
              {t('incarnations:mwAdd')}
            </Button>
          </div>
        ) : null}
      </div>
      <p style={descStyle}>{t('incarnations:mwDesc')}</p>

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
                  <td>{formatDays(w.days, dayLabel)}</td>
                  <td className="mono">
                    {w.start_time}–{end.end}
                    {end.nextDay ? <span style={mutedStyle}> {t('incarnations:mwNextDayMark')}</span> : null}
                  </td>
                  <td className="mono">{w.timezone}</td>
                  <td>{w.comment ? t('incarnations:mwQuoted', { text: w.comment }) : ''}</td>
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

      {windows.data ? (
        <StatusLine status={windows.data.status} hasWindows={windowRows.length > 0} windows={windowRows} tz={tz} />
      ) : null}

      <div style={{ ...headRowStyle, marginTop: 16 }}>
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>{t('incarnations:freezesTitle')}</h2>
        {canWrite ? (
          <Button type="button" variant="secondary" onClick={() => setFreezeModal({ editing: null })} data-testid="freeze-add">
            <Plus size={14} style={iconStyle} />
            {t('incarnations:freezeAdd')}
          </Button>
        ) : null}
      </div>
      <p style={descStyle}>{t('incarnations:freezesDesc')}</p>

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
                  <td>{f.comment ? t('incarnations:mwQuoted', { text: f.comment }) : ''}</td>
                  <td>
                    <Badge tone={phase === 'active' ? 'danger' : phase === 'upcoming' ? 'info' : 'muted'}>
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
                        onClick={() =>
                          setDeleteTarget({
                            kind: 'freeze',
                            row: f,
                            summary: f.comment ? `${range} ${t('incarnations:mwQuoted', { text: f.comment })}` : range,
                          })
                        }
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

/**
 * «Сейчас: закрыто · ближайшее: чт 10.12 02:00» — the server's status block in words.
 * Instants are shown in the browser's zone; the zone is named whenever a window keeps
 * a different one, so "02:00" is never read against the wrong clock.
 */
export function StatusLine({
  status,
  hasWindows,
  windows,
  tz,
}: {
  status: MaintenanceStatus;
  hasWindows: boolean;
  windows: MaintenanceWindow[];
  tz: string;
}) {
  const { t } = useTranslation();
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);
  const zoneNote = windows.some((w) => w.timezone !== tz) ? ` (${tz})` : '';
  const parts: string[] = [];

  if (status.active_freeze) {
    const f = status.active_freeze;
    parts.push(
      t('incarnations:mwStatusFrozen', {
        comment: f.comment ? t('incarnations:mwQuoted', { text: f.comment }) : '',
        until: formatInstant(f.ends_at, tz, dayLabel) + zoneNote,
      }).replace(/\s+/g, ' '),
    );
  } else {
    parts.push(status.open_now ? t('incarnations:mwStatusOpen') : t('incarnations:mwStatusClosed'));
  }
  if (!status.open_now) {
    parts.push(t('incarnations:mwStatusNext', { at: formatInstant(status.next_start, tz, dayLabel) + zoneNote }));
  } else if (!hasWindows) {
    parts.push(t('incarnations:mwStatusAnyTime'));
  }

  return (
    <div
      style={{
        fontSize: 13,
        padding: '8px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: status.active_freeze ? 'var(--danger-bg, var(--surface-2))' : 'var(--surface-2)',
        marginTop: 8,
      }}
      title={status.next_start}
      data-testid="mw-status"
    >
      {parts.join(' · ')}
    </div>
  );
}

const headRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
const descStyle: React.CSSProperties = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
const iconStyle: React.CSSProperties = { marginRight: 6, verticalAlign: 'middle' };
const mutedStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11.5 };
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
