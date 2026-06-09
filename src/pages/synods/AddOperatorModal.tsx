import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  synodName: string;
  /** AID-ы архонтов, уже состоящих в группе (чтобы исключить их из селекта). */
  currentMembers: string[];
  onClose: () => void;
}

export function AddOperatorModal({ open, synodName, currentMembers, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [aid, setAid] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  // Список всех активных архонтов кластера — для селектора.
  const operatorsQ = useQuery({
    queryKey: ['operators.active'],
    queryFn: () => keeperApi.operators.list({ revoked: false }),
    enabled: open,
    staleTime: 30_000,
  });

  const availableOperators = (operatorsQ.data?.items ?? []).filter(
    (op) => !op.revoked_at && !currentMembers.includes(op.aid),
  );

  const mu = useMutation({
    mutationFn: () => keeperApi.synods.operators.add(synodName, aid),
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

  const isEmpty = !operatorsQ.isLoading && availableOperators.length === 0;
  const canSubmit = aid.length > 0 && !mu.isPending && !isEmpty;

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
        {isEmpty ? (
          <div
            style={{ color: 'var(--text-faint)', fontSize: 13, padding: '8px 0' }}
            data-testid="add-operator-empty"
          >
            {t('synods:addOperatorNoAvailable')}
          </div>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13 }}>{t('synods:addOperatorLabel')}</span>
            <select
              value={aid}
              onChange={(e) => setAid(e.target.value)}
              aria-label={t('synods:addOperatorLabel')}
              data-testid="add-operator-select"
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <option value="">—</option>
              {availableOperators.map((op) => (
                <option key={op.aid} value={op.aid}>{op.aid}</option>
              ))}
            </select>
          </label>
        )}
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
