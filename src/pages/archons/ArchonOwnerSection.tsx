// Operator card → Owner of a machine operator: a person or a Synod, changed with
// PUT and cleared with DELETE /v1/operators/{aid}/owner (operator.set-owner). An
// owner Archon revoked since is flagged: the operator needs a new one.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keeperApi, type Operator } from '../../api/keeper';
import { Badge, Button, Modal } from '../../components/primitives';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { SetOwnerModal } from './SetOwnerModal';
import { ownerErrorText } from './owner';
import styles from '../common.module.css';

export function ArchonOwnerSection({ op }: { op: Operator }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();
  const [changeOpen, setChangeOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const ownerAid = op.owner_aid;

  const ownerQ = useQuery({
    queryKey: ['operator', ownerAid],
    queryFn: () => keeperApi.operators.get(ownerAid!),
    enabled: Boolean(ownerAid),
    retry: false,
  });
  const ownerRevoked = Boolean(ownerQ.data?.revoked_at);

  const clearMut = useMutation({
    mutationFn: () => keeperApi.operators.clearOwner(op.aid),
    onSuccess: () => {
      setClearOpen(false);
      setClearError(null);
      qc.invalidateQueries({ queryKey: ['operator', op.aid] });
      qc.invalidateQueries({ queryKey: ['operators.list'] });
    },
    onError: (err) => setClearError(ownerErrorText(err)),
  });

  const mayEdit = hasPermission('operator.set-owner');
  const hasOwner = Boolean(ownerAid || op.owner_synod);
  // A revoked operator's owner can still be cleared — that is what unblocks
  // deleting the Synod that owned it — but no longer set.
  const canChange = mayEdit && !op.revoked_at;
  const canClear = mayEdit && hasOwner;

  return (
    <section className={styles.section} aria-label={t('pages:archonOwnerSection')}>
      <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{t('pages:archonOwnerSection')}</span>
        <span style={{ flex: 1 }} />
        {canChange ? (
          <Button type="button" variant="ghost" data-testid="owner-change-btn" onClick={() => setChangeOpen(true)}>
            {t('pages:archonOwnerChange')}
          </Button>
        ) : null}
        {canClear ? (
          <Button
            type="button"
            variant="ghost"
            data-testid="owner-clear-btn"
            onClick={() => {
              setClearError(null);
              setClearOpen(true);
            }}
          >
            {t('clear')}
          </Button>
        ) : null}
      </h2>
      <div data-testid="archon-owner" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        {ownerAid ? (
          <>
            <Link to={`/archons/${encodeURIComponent(ownerAid)}`} className="mono">
              {ownerAid}
            </Link>
            {ownerRevoked ? (
              <span data-testid="archon-owner-revoked">
                <Badge tone="danger">{t('pages:archonOwnerRevokedBadge')}</Badge>
              </span>
            ) : null}
          </>
        ) : op.owner_synod ? (
          <>
            <Link to={`/synods/${encodeURIComponent(op.owner_synod)}`} className="mono">
              {op.owner_synod}
            </Link>
            <Badge tone="info">{t('pages:archonOwnerKindSynod')}</Badge>
          </>
        ) : (
          <Badge tone="muted">{t('pages:archonNoOwner')}</Badge>
        )}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {op.revoked_at
          ? t('pages:archonOwnerRevokedOperatorHint')
          : ownerRevoked
            ? t('pages:archonOwnerRevokedHint')
            : t('pages:archonOwnerHint')}
      </p>

      {changeOpen ? <SetOwnerModal open op={op} onClose={() => setChangeOpen(false)} /> : null}

      <Modal
        open={clearOpen}
        title={t('pages:archonOwnerClearTitle')}
        onClose={() => {
          if (!clearMut.isPending) setClearOpen(false);
        }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setClearOpen(false)} disabled={clearMut.isPending}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              data-testid="owner-clear-confirm"
              disabled={clearMut.isPending}
              onClick={() => clearMut.mutate()}
            >
              {t('clear')}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          {t('pages:archonOwnerClearBody', { aid: op.aid, owner: ownerAid ?? op.owner_synod ?? '' })}
        </p>
        {clearError ? (
          <div className={styles.errorBox} role="alert" data-testid="owner-clear-error" style={{ marginTop: 12 }}>
            {clearError}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
