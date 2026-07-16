import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, SearchMultiSelect } from '../../components/primitives';
import { keeperApi, type Operator } from '../../api/keeper';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  synodName: string;
  /** AIDs of archons already in the group (excluded from the search). */
  currentMembers: string[];
  onClose: () => void;
}

interface Failure {
  aid: string;
  msg: string;
}

export function AddOperatorModal({ open, synodName, currentMembers, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  // Fan-out: N idempotent POSTs; partial failure does not roll back successful ones.
  const mu = useMutation({
    mutationFn: async (): Promise<Failure[]> => {
      const results = await Promise.allSettled(
        selected.map((aid) => keeperApi.synods.operators.add(synodName, aid)),
      );
      const failed: Failure[] = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') failed.push({ aid: selected[i], msg: prettySynodError(r.reason) });
      });
      return failed;
    },
    onSuccess: (failed) => {
      qc.invalidateQueries({ queryKey: ['synods'] });
      if (failed.length === 0) {
        reset();
        onClose();
      } else {
        // Keep the modal open; leave only the failed ones in the selection.
        setFailures(failed);
        setSelected(failed.map((f) => f.aid));
      }
    },
    onError: (err) => setServerError(prettySynodError(err)),
  });

  function reset() {
    setSelected([]);
    setFailures([]);
    setServerError(null);
  }

  function close() {
    if (mu.isPending) return;
    reset();
    onClose();
  }

  const canSubmit = selected.length > 0 && !mu.isPending;

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
            onClick={() => { setServerError(null); setFailures([]); mu.mutate(); }}
            data-testid="add-operator-submit"
          >
            {mu.isPending ? t('common:adding') : t('synods:addOperatorSubmit', { n: selected.length })}
          </Button>
        </>
      }
    >
      <SearchMultiSelect<Operator>
        search={(q) =>
          keeperApi.operators
            .list({ revoked: false, q })
            .then((r) =>
              (r.items ?? []).filter((op) => !op.revoked_at && !currentMembers.includes(op.aid)),
            )
        }
        queryKey={['operators.search']}
        enabled={open}
        selected={selected}
        onChange={setSelected}
        getKey={(op) => op.aid}
        getLabel={(op) => op.display_name || op.aid}
        getSublabel={(op) => op.aid}
        placeholder={t('synods:addOperatorSearchPlaceholder')}
        emptyText={t('synods:addOperatorNoResults')}
        testidPrefix="add-operator"
      />
      {failures.length > 0 ? (
        <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert" data-testid="add-operator-partial">
          <div>{t('synods:addOperatorPartialFail', { list: failures.map((f) => f.aid).join(', ') })}</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {failures.map((f) => (
              <li key={f.aid}><span className="mono">{f.aid}</span>: {f.msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {serverError ? (
        <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert">
          {serverError}
        </div>
      ) : null}
    </Modal>
  );
}
