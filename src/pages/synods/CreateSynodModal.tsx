import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateSynodModal({ open, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () =>
      keeperApi.synods.create({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['synods'] });
      setName('');
      setDescription('');
      setServerError(null);
      onClose();
    },
    onError: (err) => setServerError(prettySynodError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setName('');
    setDescription('');
    setServerError(null);
    onClose();
  }

  const canSubmit = name.trim().length > 0 && !mu.isPending;

  return (
    <Modal
      open={open}
      title={t('synods:createSynodTitle')}
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
          >
            {mu.isPending ? t('common:creating') : t('common:create')}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); if (canSubmit) mu.mutate(); }}>
        <Input
          label={t('synods:name')}
          mono
          placeholder={t('synods:namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="synod-name-input"
        />
        <div style={{ height: 12 }} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{t('synods:description')}</span>
          <textarea
            rows={2}
            placeholder={t('synods:descriptionPlaceholder')}
            spellCheck={false}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontFamily: 'inherit',
              fontSize: 13,
              resize: 'vertical',
            }}
          />
        </label>
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
