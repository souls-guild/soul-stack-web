import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '../../components/primitives';
import styles from '../common.module.css';

// Remove host из declared spec.hosts[] incarnation (PATCH .../hosts, mode=remove).
// Зеркальна AddHostModal: warning-box + чекбокс-подтверждение + danger-кнопка,
// disabled пока чекбокс не отмечен. Мутация (removeMu) живёт в HostsTab — модалка
// только UI подтверждения: дёргает onConfirm, получает pending/error пробросом.

interface Props {
  // sid = null → модалка закрыта (ничего не выбрано к удалению).
  sid: string | null;
  incarnationName: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (sid: string) => void;
}

export function RemoveHostModal({ sid, incarnationName, pending, error, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);

  function close() {
    if (pending) return;
    setConfirmed(false);
    onClose();
  }

  function submit() {
    if (!sid || !confirmed) return;
    onConfirm(sid);
  }

  return (
    <Modal
      open={sid !== null}
      title={t('forms:removeHostTitle', { sid: sid ?? '' })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={submit}
            disabled={pending || !confirmed}
            data-testid="remove-host-confirm"
          >
            {pending ? t('deleting') : t('remove')}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        {t('incarnations:removeHostDesc')}
      </p>

      <div
        className={styles.errorBox}
        style={{ fontSize: 12.5, lineHeight: 1.5 }}
        data-testid="remove-host-warning"
      >
        <strong>{t('incarnations:removeHostWarningTitle')}</strong>{' '}
        {t('incarnations:removeHostWarningBody', { sid: sid ?? '', name: incarnationName })}
      </div>

      <label
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13 }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          aria-label={t('incarnations:removeHostConfirmAria')}
        />
        <span>{t('incarnations:removeHostConfirmLabel')}</span>
      </label>

      {error ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  );
}
