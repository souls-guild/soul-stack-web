import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Play } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { Modal } from '../../components/primitives';
import { relative, scheduleLabel } from './format';
import styles from '../common.module.css';

export function CadencesList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmEnable, setConfirmEnable] = useState<{ id: string; name: string } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<{ id: string; name: string } | null>(null);

  const q = useQuery({
    queryKey: ['cadences.list'],
    queryFn: () => keeperApi.cadences.list({ limit: 100 }),
  });

  const enableMu = useMutation({
    mutationFn: (id: string) => keeperApi.cadences.enable(id),
    onSuccess: () => {
      setConfirmEnable(null);
      qc.invalidateQueries({ queryKey: ['cadences.list'] });
    },
  });

  const disableMu = useMutation({
    mutationFn: (id: string) => keeperApi.cadences.disable(id),
    onSuccess: () => {
      setConfirmDisable(null);
      qc.invalidateQueries({ queryKey: ['cadences.list'] });
    },
  });

  const deleteMu = useMutation({
    mutationFn: (id: string) => keeperApi.cadences.delete(id),
    onSuccess: () => {
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ['cadences.list'] });
    },
  });

  const items = q.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <CalendarClock size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            {t('cadences:title')}
          </h1>
          <div className={styles.crumbs}>{t('cadences:crumbs')}</div>
        </div>
        <Button variant="primary" onClick={() => navigate('/run?recurrence=true')} type="button">
          <Play size={14} /> {t('cadences:createBtn')}
        </Button>
      </div>

      {q.isLoading ? (
        <div className={styles.loading}>{t('loading')}</div>
      ) : q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>{t('cadences:empty')}</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('cadences:colName')}</th>
              <th>{t('cadences:colSchedule')}</th>
              <th>{t('cadences:colKind')}</th>
              <th>{t('cadences:colOverlap')}</th>
              <th>{t('cadences:colNextRun')}</th>
              <th>{t('cadences:colLastRun')}</th>
              <th>{t('cadences:colEnabled')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.cadence_id}>
                <td>
                  <Link to={`/cadences/${encodeURIComponent(c.cadence_id)}`}>
                    {c.name}
                  </Link>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                  {scheduleLabel(c)}
                </td>
                <td>
                  <Badge tone="muted">{c.kind}</Badge>
                  {c.scenario_name ? (
                    <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.scenario_name}
                    </span>
                  ) : c.module ? (
                    <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.module}
                    </span>
                  ) : null}
                </td>
                <td>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t(`cadences:overlap_${c.overlap_policy}`)}
                  </span>
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {relative(c.next_run_at)}
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {relative(c.last_run_at)}
                </td>
                <td>
                  {c.enabled ? (
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={t('cadences:disableAriaLabel')}
                      onClick={() => setConfirmDisable({ id: c.cadence_id, name: c.name })}
                      style={{ padding: '2px 6px' }}
                    >
                      <Badge tone="ok">{t('cadences:enabled')}</Badge>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={t('cadences:enableAriaLabel')}
                      onClick={() => setConfirmEnable({ id: c.cadence_id, name: c.name })}
                      style={{ padding: '2px 6px' }}
                    >
                      <Badge tone="muted">{t('cadences:disabled')}</Badge>
                    </Button>
                  )}
                </td>
                <td>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setDeleteId(c.cadence_id)}
                    style={{ color: 'var(--danger)', fontSize: 12 }}
                  >
                    {t('delete')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Модалка подтверждения Enable */}
      <Modal
        open={confirmEnable !== null}
        title={t('cadences:enableTitle')}
        onClose={() => setConfirmEnable(null)}
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          {t('cadences:enableConfirm', { name: confirmEnable?.name ?? '' })}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={() => setConfirmEnable(null)} disabled={enableMu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={enableMu.isPending}
            onClick={() => confirmEnable && enableMu.mutate(confirmEnable.id)}
          >
            {t('cadences:confirmBtn')}
          </Button>
        </div>
        {enableMu.isError ? (
          <div className={styles.errorBox} style={{ marginTop: 8 }}>
            {enableMu.error instanceof ApiError
              ? t('errors:generic', { status: enableMu.error.status, detail: enableMu.error.message })
              : String(enableMu.error)}
          </div>
        ) : null}
      </Modal>

      {/* Модалка подтверждения Disable */}
      <Modal
        open={confirmDisable !== null}
        title={t('cadences:disableTitle')}
        onClose={() => setConfirmDisable(null)}
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          {t('cadences:disableConfirm', { name: confirmDisable?.name ?? '' })}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={() => setConfirmDisable(null)} disabled={disableMu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            type="button"
            disabled={disableMu.isPending}
            onClick={() => confirmDisable && disableMu.mutate(confirmDisable.id)}
          >
            {t('cadences:confirmBtn')}
          </Button>
        </div>
        {disableMu.isError ? (
          <div className={styles.errorBox} style={{ marginTop: 8 }}>
            {disableMu.error instanceof ApiError
              ? t('errors:generic', { status: disableMu.error.status, detail: disableMu.error.message })
              : String(disableMu.error)}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteId !== null}
        title={t('cadences:deleteTitle')}
        onClose={() => setDeleteId(null)}
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          {t('cadences:deleteConfirm', {
            name: items.find((c) => c.cadence_id === deleteId)?.name ?? deleteId ?? '',
          })}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={() => setDeleteId(null)}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            type="button"
            disabled={deleteMu.isPending}
            onClick={() => deleteId && deleteMu.mutate(deleteId)}
          >
            {t('delete')}
          </Button>
        </div>
        {deleteMu.isError ? (
          <div className={styles.errorBox} style={{ marginTop: 8 }}>
            {deleteMu.error instanceof ApiError
              ? t('errors:generic', { status: deleteMu.error.status, detail: deleteMu.error.message })
              : String(deleteMu.error)}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
