import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import i18n from '../../i18n';
import { Modal, Button } from '../../components/primitives';
import styles from '../common.module.css';

interface Props {
  aid: string;
  open: boolean;
  onClose: () => void;
  // Опциональный hook на успешный revoke — нужен detail-странице, чтобы
  // переключить локальный UI на «revoked».
  onSuccess?: () => void;
}

// Расшифровка серверной 409 «last cluster-admin» в человеческое сообщение.
// Бэкенд возвращает problem+json с type/title/detail (ADR-013, self-lockout).
function prettyError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    if (err.status === 409) return t('errors:revokeLastAdmin');
    if (err.status === 404) return t('errors:archonNotFound');
    if (err.status === 403) return t('errors:revokeForbidden');
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}

export function RevokeArchonModal({ aid, open, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const mut = useMutation({
    mutationFn: () => keeperApi.operators.revoke(aid, { reason: reason || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operators.list'] });
      qc.invalidateQueries({ queryKey: ['operator', aid] });
      setReason('');
      onSuccess?.();
      onClose();
    },
  });

  function handleClose() {
    if (mut.isPending) return;
    mut.reset();
    setReason('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:revokeArchonTitle', { aid })}
      onClose={handleClose}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={mut.isPending}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            data-testid="revoke-submit"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
          >
            {mut.isPending ? t('revoking') : t('revoke')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 'var(--s-4)' }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
          {t('forms:revokeArchonWarn', { aid })}
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={styles.metaKey}>{t('forms:revokeReasonLabel')}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t('forms:revokeReasonPlaceholder')}
            style={{
              fontFamily: 'inherit',
              fontSize: 13,
              padding: 8,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              resize: 'vertical',
            }}
          />
        </label>
        {mut.error ? (
          <div className={styles.errorBox} role="alert">
            {prettyError(mut.error)}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
