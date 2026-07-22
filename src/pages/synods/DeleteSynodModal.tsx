import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type SynodView } from '../../api/keeper';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  synod: SynodView;
  onClose: () => void;
}

export function DeleteSynodModal({ open, synod, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () => keeperApi.synods.delete(synod.name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['synods'] });
      setServerError(null);
      onClose();
    },
    onError: (err) => setServerError(prettySynodError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={t('synods:deleteSynodTitle', { name: synod.name })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={mu.isPending}
            onClick={() => { setServerError(null); mu.mutate(); }}
          >
            {mu.isPending ? t('common:deleting') : t('common:delete')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 14 }}>
        {t('synods:deleteSynodConfirm', { name: synod.name })}
      </p>
      {serverError ? (
        <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
          {serverError}
        </div>
      ) : null}
    </Modal>
  );
}
