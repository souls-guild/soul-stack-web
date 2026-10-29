import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { browserTimeZone, formatInstant, type Weekday } from '../incarnations/maintenance';
import styles from '../common.module.css';

/**
 * «отложен до чт 10.12 02:00» and its cancel, for a `scheduled` Voyage — the carrier
 * of a run deferred to a maintenance window (ADR-0093 §3). Cancelling it is the
 * ordinary Voyage cancel; a cancelled deferred run never starts.
 */
export function DeferredUntil({
  voyageId,
  scheduleAt,
  invalidate,
}: {
  voyageId: string;
  scheduleAt: string;
  invalidate: QueryKey[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const dayLabel = (d: Weekday) => t(`incarnations:mwDay_${d}`);
  const at = formatInstant(scheduleAt, browserTimeZone(), dayLabel);

  const mu = useMutation({
    mutationFn: () => keeperApi.voyages.cancel(voyageId),
    onSuccess: () => {
      for (const key of invalidate) qc.invalidateQueries({ queryKey: key });
      setOpen(false);
    },
  });

  return (
    <>
      <span style={{ fontSize: 12.5, color: 'var(--text-muted)', marginLeft: 6 }} title={scheduleAt} data-testid={`deferred-until-${voyageId}`}>
        {t('runhistory:deferredUntil', { at })}
      </span>
      <Button
        type="button"
        variant="ghost"
        onClick={() => { mu.reset(); setOpen(true); }}
        style={{ marginLeft: 6, padding: '2px 8px', fontSize: 12 }}
        data-testid={`deferred-cancel-${voyageId}`}
      >
        {t('cancel2')}
      </Button>
      <Modal
        open={open}
        title={t('runhistory:deferredCancelTitle')}
        onClose={() => { if (!mu.isPending) setOpen(false); }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={mu.isPending}>
              {t('runhistory:deferredKeep')}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => mu.mutate()}
              disabled={mu.isPending}
              data-testid={`deferred-cancel-confirm-${voyageId}`}
            >
              {mu.isPending ? t('cancelling') : t('runhistory:deferredCancelConfirm')}
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 13, margin: 0 }}>
          {t('runhistory:deferredCancelBody', { at })} <span className="mono">{voyageId}</span>
        </p>
        {mu.error ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }}>
            {mu.error instanceof ApiError
              ? t('errors:generic', { status: mu.error.status, detail: mu.error.message })
              : String(mu.error)}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
