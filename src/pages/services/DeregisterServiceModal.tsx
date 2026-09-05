import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type ServiceView } from '../../api/keeper';
import { prettyServiceError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  service: ServiceView;
  onClose: () => void;
}

// DELETE /v1/services/{id} — removes the registry entry. Git repo is untouched.
// Names the service by its id, not its caption: a destructive confirmation has to
// name the key it acts on, and two services may carry the same caption.
export function DeregisterServiceModal({ open, service, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () => keeperApi.services.deregister(service.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services.list'] });
      onClose();
      navigate('/services');
    },
    onError: (err) => setServerError(prettyServiceError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('forms:deregisterServiceTitle', { name: service.id })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={mu.isPending}
            onClick={() => {
              setServerError(null);
              mu.mutate();
            }}
          >
            {mu.isPending ? t('deregistering') : t('deregister')}
          </Button>
        </>
      }
    >
      <div
        style={{
          padding: 12,
          background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--border))',
          borderRadius: 'var(--radius)',
          fontSize: 13,
          color: 'var(--danger)',
          marginBottom: 12,
        }}
      >
        {t('admin:svcDeregisterRecordPrefix')} <strong>{service.id}</strong> {t('admin:svcDeregisterWarn')}{' '}
        <span className="mono">{service.git}</span> {t('admin:svcDeregisterWarn2')}
      </div>
      {serverError ? (
        <div className={styles.errorBox} role="alert">
          {serverError}
        </div>
      ) : null}
    </Modal>
  );
}
