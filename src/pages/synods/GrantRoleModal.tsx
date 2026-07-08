import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, SearchMultiSelect } from '../../components/primitives';
import { keeperApi, type RoleView } from '../../api/keeper';
import { prettySynodError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  synodName: string;
  /** Уже привязанные роли (исключаются из выбора). */
  currentRoles: string[];
  onClose: () => void;
}

interface Failure {
  role: string;
  msg: string;
}

export function GrantRoleModal({ open, synodName, currentRoles, onClose }: Props) {
  const { t } = useTranslation(['synods', 'common']);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  // Каталог ролей кластера — небольшой, фильтруем на клиенте.
  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
    enabled: open,
    staleTime: 30_000,
  });

  const availableRoles = (rolesQ.data?.items ?? []).filter(
    (r): r is RoleView => typeof r?.name === 'string' && !currentRoles.includes(r.name),
  );

  // Fan-out: N идемпотентных POST-ов; partial failure не откатывает успешные.
  const mu = useMutation({
    mutationFn: async (): Promise<Failure[]> => {
      const results = await Promise.allSettled(
        selected.map((role) => keeperApi.synods.roles.grant(synodName, role)),
      );
      const failed: Failure[] = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') failed.push({ role: selected[i], msg: prettySynodError(r.reason) });
      });
      return failed;
    },
    onSuccess: (failed) => {
      qc.invalidateQueries({ queryKey: ['synods'] });
      if (failed.length === 0) {
        reset();
        onClose();
      } else {
        setFailures(failed);
        setSelected(failed.map((f) => f.role));
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
      title={t('synods:grantRoleTitle', { name: synodName })}
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
            data-testid="grant-role-submit"
          >
            {mu.isPending ? t('common:adding') : t('synods:grantRoleSubmit', { n: selected.length })}
          </Button>
        </>
      }
    >
      <SearchMultiSelect<RoleView>
        items={availableRoles}
        loading={rolesQ.isLoading}
        selected={selected}
        onChange={setSelected}
        getKey={(r) => r.name}
        getLabel={(r) => r.name}
        getSublabel={(r) => r.description}
        placeholder={t('synods:grantRoleSearchPlaceholder')}
        emptyText={t('synods:grantRoleNoResults')}
        testidPrefix="grant-role"
      />
      {failures.length > 0 ? (
        <div className={styles.errorBox} style={{ marginTop: 12 }} role="alert" data-testid="grant-role-partial">
          <div>{t('synods:grantRolePartialFail', { list: failures.map((f) => f.role).join(', ') })}</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {failures.map((f) => (
              <li key={f.role}><span className="mono">{f.role}</span>: {f.msg}</li>
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
