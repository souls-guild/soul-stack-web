import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '../../components/primitives';
import styles from '../common.module.css';

// Confirmation for DELETE .../members/{sid} — the destructive half of membership.
//
// Unbinding is not "remove a row from a list": the host leaves the roster that
// EVERY future run resolves, so a scenario that used to reach it silently stops
// doing so. Warning box + explicit checkbox + danger button. The mutation lives
// in MembersPanel; this is confirmation UI only.

interface Props {
  // sid = null → modal closed (nothing selected for unbinding).
  sid: string | null;
  incarnationName: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (sid: string) => void;
}

export function UnbindMemberModal({ sid, incarnationName, pending, error, onClose, onConfirm }: Props) {
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
      title={t('forms:unbindMemberTitle', { sid: sid ?? '' })}
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
            data-testid="unbind-member-confirm"
          >
            {pending ? t('incarnations:memberUnbinding') : t('incarnations:memberUnbind')}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
        {t('incarnations:memberUnbindDesc')}
      </p>

      <div
        className={styles.errorBox}
        style={{ fontSize: 12.5, lineHeight: 1.5 }}
        data-testid="unbind-member-warning"
      >
        <strong>{t('incarnations:unbindWarningTitle')}</strong>{' '}
        {t('incarnations:memberUnbindWarningBody', { sid: sid ?? '', name: incarnationName })}
      </div>

      <label
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13 }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          aria-label={t('incarnations:memberUnbindConfirmAria')}
        />
        <span>{t('incarnations:memberUnbindConfirmLabel')}</span>
      </label>

      {error ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  );
}
