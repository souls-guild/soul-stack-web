import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, SearchMultiSelect } from '../../components/primitives';
import { keeperApi, type SoulListEntry } from '../../api/keeper';
import { MAX_BIND_SIDS, bindOutcome, prettyBindError, validateBindSids, type BindOutcome } from './membership';
import styles from '../common.module.css';

// Bind hosts to the incarnation's membership roster (POST .../members, NIM-209).
//
// The candidate list is deliberately narrow: only `connected` souls, because the
// backend refuses anything else with a 422 ("only an onboarded, connected host
// can be bound"). Offering a disconnected host would just be a slower way to
// reach that error.
//
// Two limits are enforced here rather than left to the server: at most
// MAX_BIND_SIDS per call, and the SID pattern — both come back as an opaque
// validation problem otherwise.

interface Props {
  open: boolean;
  incarnationName: string;
  /** SIDs already on the roster — excluded from the candidate list. */
  memberSids: string[];
  onClose: () => void;
  onBound: (outcome: BindOutcome) => void;
}

export function BindMembersModal({ open, incarnationName, memberSids, onClose, onBound }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const souls = useQuery({
    queryKey: ['souls-connected-for-bind'],
    queryFn: () => keeperApi.souls.list({ status: 'connected', limit: 500 }),
    enabled: open,
  });

  const members = new Set(memberSids);
  const candidates: SoulListEntry[] = (souls.data?.items ?? []).filter((s) => !members.has(s.sid));

  const mu = useMutation({
    mutationFn: () => keeperApi.incarnations.bindMembers(incarnationName, selected),
    onSuccess: (reply) => {
      qc.invalidateQueries({ queryKey: ['incarnation-members', incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnation-telemetry', incarnationName] });
      onBound(bindOutcome(reply));
      close();
    },
    onError: (err) => setServerError(prettyBindError(err)),
  });

  function close() {
    setSelected([]);
    setFormError(null);
    setServerError(null);
    onClose();
  }

  function submit() {
    setFormError(null);
    setServerError(null);
    const check = validateBindSids(selected);
    if (!check.ok) {
      if (check.reason === 'empty') setFormError(t('incarnations:memberBindPickAtLeastOne'));
      else if (check.reason === 'tooMany') {
        setFormError(t('incarnations:memberBindTooMany', { max: MAX_BIND_SIDS, n: check.count }));
      } else setFormError(t('incarnations:memberBindBadSid', { sid: check.sid }));
      return;
    }
    mu.mutate();
  }

  return (
    <Modal
      open={open}
      title={t('forms:bindMembersTitle', { name: incarnationName })}
      onClose={mu.isPending ? () => {} : close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={mu.isPending || selected.length === 0}
            data-testid="bind-members-confirm"
          >
            {mu.isPending ? t('incarnations:memberBinding') : t('incarnations:memberBind')}
          </Button>
        </>
      }
    >
      <form noValidate>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('incarnations:memberBindDesc')}
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{t('incarnations:memberBindPickLabel')}</span>
          <SearchMultiSelect<SoulListEntry>
            items={candidates}
            loading={souls.isLoading}
            selected={selected}
            onChange={setSelected}
            getKey={(s) => s.sid}
            getLabel={(s) => s.sid}
            getSublabel={(s) => (s.covens ?? []).join(', ') || undefined}
            placeholder={t('incarnations:memberBindSearchPlaceholder')}
            emptyText={t('incarnations:memberBindNoCandidates')}
            disabled={mu.isPending}
            testidPrefix="bind-members"
          />
        </label>

        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
          {t('incarnations:memberBindScopeHint')}
        </p>

        {formError ? <div className={styles.errorBox} style={{ marginTop: 12 }}>{formError}</div> : null}
        {serverError ? (
          <div className={styles.errorBox} style={{ marginTop: 12 }} data-testid="bind-members-error">
            {serverError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
