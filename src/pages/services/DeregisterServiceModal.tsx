import { useState } from 'react';
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

// DELETE /v1/services/{name} — удаляет запись реестра. Git-репо не трогается.
export function DeregisterServiceModal({ open, service, onClose }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () => keeperApi.services.deregister(service.name),
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
      title={`Deregister service: ${service.name}`}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            Отмена
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
            {mu.isPending ? 'Удаляем…' : 'Deregister'}
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
        Запись сервиса <strong>{service.name}</strong> будет удалена из реестра. Git-репо{' '}
        <span className="mono">{service.git}</span> не трогается — сервис можно зарегистрировать
        заново. Инкарнации этого сервиса при этом останутся, но потеряют ссылку на реестр.
      </div>
      {serverError ? (
        <div className={styles.errorBox} role="alert">
          {serverError}
        </div>
      ) : null}
    </Modal>
  );
}
