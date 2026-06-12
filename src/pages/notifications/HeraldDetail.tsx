import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { HeraldModal } from './HeraldModal';
import styles from '../common.module.css';

const DELIVERIES_LIMIT = 50;

function relDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function HeraldDetail() {
  const { t } = useTranslation('notifications');
  const { name = '' } = useParams<{ name: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();
  const [editOpen, setEditOpen] = useState(false);
  const [deliveriesOffset, setDeliveriesOffset] = useState(0);

  const heraldQ = useQuery({
    queryKey: ['herald.get', name],
    queryFn: () => keeperApi.heralds.get(name),
    enabled: Boolean(name),
  });

  const tidingsQ = useQuery({
    queryKey: ['tidings.list'],
    queryFn: () => keeperApi.tidings.list({ limit: 200 }),
    enabled: Boolean(name),
  });

  const deliveriesQ = useQuery({
    queryKey: ['herald.deliveries', name, deliveriesOffset],
    queryFn: () =>
      keeperApi.audit.list({
        type: ['herald.delivered', 'herald.failed'],
        payload_herald: name,
        offset: deliveriesOffset,
        limit: DELIVERIES_LIMIT,
      }),
    enabled: Boolean(name),
  });

  const deleteMu = useMutation({
    mutationFn: () => keeperApi.heralds.delete(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['heralds.list'] });
      nav('/notifications');
    },
  });

  const canUpdate = hasPermission('herald.update');
  const canDelete = hasPermission('herald.delete');

  if (heraldQ.isLoading) return <div className={styles.loading}>{t('common:loading')}</div>;
  if (heraldQ.error) {
    return (
      <div className={styles.errorBox}>
        {heraldQ.error instanceof ApiError
          ? t('errors:generic', { status: heraldQ.error.status, detail: heraldQ.error.message })
          : String(heraldQ.error)}
      </div>
    );
  }

  const h = heraldQ.data;
  if (!h) return <div className={styles.empty}>{t('heraldEmpty')}</div>;

  const cfg = (h.config ?? {}) as Record<string, unknown>;
  const heraldTidings = (tidingsQ.data?.items ?? []).filter((td) => td.herald === name);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Bell size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            {h.name}
          </h1>
          <div className={styles.crumbs}>
            <Link to="/notifications">{t('pageTitle')}</Link>
            {' / '}
            <Link to="/notifications">{t('heraldTitle')}</Link>
            {' / '}
            {h.name}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {h.enabled ? (
            <Badge tone="ok">{t('heraldEnabled')}</Badge>
          ) : (
            <Badge tone="muted">{t('heraldDisabled')}</Badge>
          )}
          <Button
            variant="ghost"
            type="button"
            disabled={!canUpdate}
            onClick={() => setEditOpen(true)}
            title={!canUpdate ? 'herald.update' : undefined}
          >
            {t('common:edit')}
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={!canDelete}
            onClick={() => {
              if (window.confirm(t('heraldDeleteConfirm', { name: h.name }))) {
                deleteMu.mutate();
              }
            }}
            style={{ color: 'var(--danger)' }}
            title={!canDelete ? 'herald.delete' : undefined}
          >
            {deleteMu.isPending ? '…' : t('common:delete')}
          </Button>
        </div>
      </div>

      {deleteMu.error ? (
        <div role="alert" className={styles.errorBox}>
          {deleteMu.error instanceof ApiError
            ? t('errors:generic', { status: deleteMu.error.status, detail: deleteMu.error.message })
            : String(deleteMu.error)}
        </div>
      ) : null}

      <div className={styles.section}>
        <dl className={styles.meta}>
          <dt className={styles.metaKey}>{t('heraldColType')}</dt>
          <dd className={styles.metaVal}><Badge tone="muted">{h.type}</Badge></dd>

          <dt className={styles.metaKey}>{t('heraldColUrl')}</dt>
          <dd className={styles.metaVal} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {typeof cfg.url === 'string' ? cfg.url : '—'}
          </dd>

          <dt className={styles.metaKey}>{t('heraldFieldSecretRef')}</dt>
          <dd className={styles.metaVal} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {h.secret_ref ?? '—'}
          </dd>

          <dt className={styles.metaKey}>{t('heraldFieldHttpAllowed')}</dt>
          <dd className={styles.metaVal}>{String(Boolean(cfg.http_allowed))}</dd>

          <dt className={styles.metaKey}>{t('heraldFieldAllowPrivate')}</dt>
          <dd className={styles.metaVal}>{String(Boolean(cfg.allow_private))}</dd>

          <dt className={styles.metaKey}>{t('fieldCreatedAt')}</dt>
          <dd className={styles.metaVal}>{relDate(h.created_at)}</dd>

          <dt className={styles.metaKey}>{t('fieldUpdatedAt')}</dt>
          <dd className={styles.metaVal}>{relDate(h.updated_at)}</dd>

          {h.created_by_aid ? (
            <>
              <dt className={styles.metaKey}>{t('fieldCreatedBy')}</dt>
              <dd className={styles.metaVal}>
                <Link to={`/archons/${encodeURIComponent(h.created_by_aid)}`}>
                  {h.created_by_aid}
                </Link>
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('tidingsForHerald')}</h2>
        {tidingsQ.isLoading ? (
          <div className={styles.loading}>{t('common:loading')}</div>
        ) : heraldTidings.length === 0 ? (
          <div className={styles.empty}>{t('tidingEmpty')}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('tidingColName')}</th>
                <th>{t('tidingColEventTypes')}</th>
                <th>{t('tidingColEnabled')}</th>
              </tr>
            </thead>
            <tbody>
              {heraldTidings.map((td) => (
                <tr key={td.name}>
                  <td>
                    <Link to={`/notifications/tidings/${encodeURIComponent(td.name)}`}>
                      {td.name}
                    </Link>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {td.event_types.slice(0, 2).join(', ')}
                    {td.event_types.length > 2 ? ` +${td.event_types.length - 2}` : ''}
                  </td>
                  <td>
                    {td.enabled ? (
                      <Badge tone="ok">{t('tidingEnabled')}</Badge>
                    ) : (
                      <Badge tone="muted">{t('tidingDisabled')}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('heraldDeliveriesTitle')}</h2>
        {deliveriesQ.isLoading ? (
          <div className={styles.loading}>{t('common:loading')}</div>
        ) : deliveriesQ.error ? (
          <div className={styles.errorBox}>
            {deliveriesQ.error instanceof ApiError
              ? t('errors:generic', { status: deliveriesQ.error.status, detail: deliveriesQ.error.message })
              : String(deliveriesQ.error)}
          </div>
        ) : (deliveriesQ.data?.items ?? []).length === 0 ? (
          <div className={styles.empty} data-testid="herald-deliveries-empty">{t('heraldDeliveriesEmpty')}</div>
        ) : (
          <>
            <table className={styles.table} data-testid="herald-deliveries-table">
              <thead>
                <tr>
                  <th>{t('heraldDeliveryColEvent')}</th>
                  <th>{t('heraldDeliveryColVoyage')}</th>
                  <th>{t('heraldDeliveryColTiding')}</th>
                  <th>{t('heraldDeliveryColStatus')}</th>
                  <th>{t('heraldDeliveryColCode')}</th>
                  <th>{t('heraldDeliveryColAttempt')}</th>
                  <th>{t('heraldDeliveryColTime')}</th>
                </tr>
              </thead>
              <tbody>
                {(deliveriesQ.data?.items ?? []).map((ev) => {
                  const p = ev.payload as Record<string, unknown>;
                  const tidingName = typeof p.tiding === 'string' ? p.tiding : null;
                  const voyageId = ev.correlation_id ?? null;
                  const statusCode = typeof p.status_code === 'number' ? p.status_code : null;
                  const attempt = typeof p.attempt === 'number' ? p.attempt : null;
                  const isDelivered = ev.type === 'herald.delivered';
                  return (
                    <tr key={ev.id} data-testid={`delivery-row-${ev.id}`}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{ev.type}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {voyageId ? (
                          <Link to={`/voyages/${encodeURIComponent(voyageId)}`} data-testid={`delivery-voyage-link-${ev.id}`}>
                            {voyageId}
                          </Link>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {tidingName ? (
                          <Link to={`/notifications/tidings/${encodeURIComponent(tidingName)}`}>
                            {tidingName}
                          </Link>
                        ) : '—'}
                      </td>
                      <td>
                        <Badge tone={isDelivered ? 'ok' : 'danger'}>
                          {isDelivered ? t('heraldDeliveryStatusDelivered') : t('heraldDeliveryStatusFailed')}
                        </Badge>
                      </td>
                      <td style={{ fontSize: 12 }}>{statusCode ?? '—'}</td>
                      <td style={{ fontSize: 12 }}>{attempt ?? '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{relDate(ev.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Пагинация */}
            {(deliveriesQ.data?.total ?? 0) > DELIVERIES_LIMIT ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={deliveriesOffset === 0}
                  onClick={() => setDeliveriesOffset(Math.max(0, deliveriesOffset - DELIVERIES_LIMIT))}
                >
                  {t('common:prev')}
                </Button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {deliveriesOffset + 1}–{Math.min(deliveriesOffset + DELIVERIES_LIMIT, deliveriesQ.data?.total ?? 0)}
                  {' / '}{deliveriesQ.data?.total}
                </span>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={deliveriesOffset + DELIVERIES_LIMIT >= (deliveriesQ.data?.total ?? 0)}
                  onClick={() => setDeliveriesOffset(deliveriesOffset + DELIVERIES_LIMIT)}
                >
                  {t('common:next')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <HeraldModal open={editOpen} onClose={() => setEditOpen(false)} editing={h} />
    </div>
  );
}
