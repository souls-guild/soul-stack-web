import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  synodName: string;
  onClose: () => void;
}

export function AddOperatorModal({ open, synodName, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [aid, setAid] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () => keeperApi.synods.operators.add(synodName, aid.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['synods'] });
      setAid('');
      setServerError(null);
      onClose();
    },
    onError: (err) => setServerError(prettySynodError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setAid('');
    setServerError(null);
    onClose();
  }

  const canSubmit = aid.trim().length > 0 && !mu.isPending;

  return (
    <Modal
      open={open}
      title={t('synods:addOperatorTitle', { name: synodName })}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => { setServerError(null); mu.mutate(); }}
            data-testid="add-operator-submit"
          >
            {mu.isPending ? t('common:adding') : t('common:add')}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); if (canSubmit) mu.mutate(); }}>
        <Input
          label={t('synods:addOperatorLabel')}
          mono
          placeholder={t('synods:addOperatorPlaceholder')}
          value={aid}
          onChange={(e) => setAid(e.target.value)}
          data-testid="add-operator-input"
        />
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
