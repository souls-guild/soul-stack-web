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

export function EditSynodModal({ open, synod, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [description, setDescription] = useState(synod.description ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

  const mu = useMutation({
    mutationFn: () =>
      keeperApi.synods.update(synod.name, { description: description.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['synods'] });
      setServerError(null);
      onClose();
    },
    onError: (err) => setServerError(prettySynodError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setDescription(synod.description ?? '');
    setServerError(null);
    onClose();
  }

  const canSubmit =
    description.trim().length > 0 &&
    description.trim().length <= 1024 &&
    !mu.isPending;

  return (
    <Modal
      open={open}
      title={t('synods:editSynodTitle', { name: synod.name })}
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
            {mu.isPending ? t('common:saving') : t('common:save')}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); if (canSubmit) mu.mutate(); }}>
        {/* Name — read-only */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13 }}>{t('synods:nameLabel')}</span>
            <input
              readOnly
              value={synod.name}
              data-testid="edit-synod-name-readonly"
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-muted)',
                cursor: 'default',
              }}
            />
          </label>
          <div
            style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}
            data-testid="edit-synod-name-hint"
          >
            {t('synods:nameReadOnly')}
          </div>
        </div>

        {/* Description */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{t('synods:description')}</span>
          <textarea
            rows={3}
            placeholder={t('synods:descriptionPlaceholder')}
            spellCheck={false}
            value={description}
            maxLength={1024}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="edit-synod-description-input"
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
