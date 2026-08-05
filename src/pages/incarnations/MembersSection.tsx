import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink } from 'lucide-react';
import { Badge, Button, Dot } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { soulDot, soulTone } from '../../components/status';
import { keeperApi, type SoulStatus } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { BindMembersModal } from './BindMembersModal';
import { UnbindMemberModal } from './UnbindMemberModal';
import { bindSummary, prettyUnbindError, type BindOutcome } from './membership';
import styles from '../common.module.css';

// The incarnation's membership roster (NIM-232 over the NIM-209 endpoints).
//
// This is the AUTHORITATIVE answer to "which hosts does this incarnation have":
// the `incarnation_membership` relation, which is what a run resolves its
// targets from. It is not the same thing as the neighbouring section: the
// utilization panel is this same member set joined with host vitals, so it
// degrades to nothing without the telemetry permission. Membership is the
// relation — the roster survives however a scenario chose to populate it.
//
// Two things about the reply drive this component:
//   - the roster is NARROWED to the caller's soul scope, so an empty/short list
//     is a legitimate answer, not a bug — the empty state says so;
//   - `bound_by_aid` is optional (a scenario-written row has no operator), so it
//     renders as "—" rather than "bound by undefined".
const MEMBERS_KEY = 'incarnation-members';

interface Props {
  incarnationName: string;
}

export function MembersSection({ incarnationName }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();
  const [bindOpen, setBindOpen] = useState(false);
  const [unbindSid, setUnbindSid] = useState<string | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const [lastBind, setLastBind] = useState<BindOutcome | null>(null);

  // Buttons follow the RIGHT, not the server's answer: unbind is destructive and
  // has a permission of its own, so an operator without it must not see a
  // control that would only fail. hasPermission is optimistic while the
  // permission set loads (see the hook) — that is deliberate, it keeps the
  // buttons from flickering in on every page open.
  const canBind = hasPermission('incarnation.bind-member');
  const canUnbind = hasPermission('incarnation.unbind-member');

  const members = useQuery({
    queryKey: [MEMBERS_KEY, incarnationName],
    queryFn: () => keeperApi.incarnations.members(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
  });

  const unbindMu = useMutation({
    mutationFn: (sid: string) => keeperApi.incarnations.unbindMember(incarnationName, sid),
    onSuccess: () => {
      setUnbindError(null);
      setUnbindSid(null);
      setLastBind(null);
      qc.invalidateQueries({ queryKey: [MEMBERS_KEY, incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnation-telemetry', incarnationName] });
    },
    onError: (err) => setUnbindError(prettyUnbindError(err)),
  });

  const listStatus = members.error instanceof ApiError ? members.error.status : null;
  // 403 on the roster itself — the caller may not read this incarnation. Soft
  // degrade with an explanation instead of a red box: nothing is broken.
  const listForbidden = listStatus === 403;
  const items = members.data?.items ?? [];
  const memberSids = items.map((m) => m.sid);

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
          {t('incarnations:membersTitle')}
        </h2>
        {canBind ? (
          <Button type="button" variant="secondary" onClick={() => setBindOpen(true)} data-testid="bind-members-open">
            <Link2 size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('incarnations:memberBind')}
          </Button>
        ) : null}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:membersDesc')}
      </p>

      {lastBind ? (
        <div
          style={{
            padding: 'var(--s-3) var(--s-4)',
            background: 'color-mix(in srgb, var(--success) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--success) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}
          data-testid="bind-members-summary"
        >
          {bindSummary(lastBind)}
        </div>
      ) : null}

      {unbindError ? (
        <div className={styles.errorBox} data-testid="members-unbind-error">{unbindError}</div>
      ) : null}

      {members.isLoading ? (
        <div className={styles.loading}>{t('loading')}</div>
      ) : listForbidden ? (
        <div className={styles.empty} data-testid="members-forbidden">
          {t('incarnations:membersForbidden')}
        </div>
      ) : members.error ? (
        <div className={styles.errorBox}>
          {members.error instanceof ApiError
            ? t('errors:generic', { status: members.error.status, detail: members.error.message })
            : String(members.error)}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty} data-testid="members-empty">
          {t('incarnations:membersEmpty')}
        </div>
      ) : (
        <table className={styles.table} data-testid="members-table">
          <thead>
            <tr>
              <th>{t('common:colSid')}</th>
              <th>{t('common:colStatus')}</th>
              <th>{t('incarnations:colBoundAt')}</th>
              <th>{t('incarnations:colBoundBy')}</th>
              {canUnbind ? <th style={{ width: 1 }} /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.sid}>
                <td className="mono">
                  <KeeperSidCell sid={m.sid} />
                </td>
                <td>
                  <Dot kind={soulDot(m.status as SoulStatus)} />{' '}
                  <Badge tone={soulTone(m.status as SoulStatus)}>{m.status}</Badge>
                </td>
                <td className="mono">{formatBoundAt(m.bound_at)}</td>
                <td className="mono">{m.bound_by_aid ?? '—'}</td>
                {canUnbind ? (
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setUnbindError(null);
                        setUnbindSid(m.sid);
                      }}
                      aria-label={t('incarnations:memberUnbindAria', { sid: m.sid })}
                      title={t('incarnations:memberUnbind')}
                      data-testid={`unbind-member-${m.sid}`}
                    >
                      <Unlink size={14} />
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <BindMembersModal
        open={bindOpen}
        incarnationName={incarnationName}
        memberSids={memberSids}
        onClose={() => setBindOpen(false)}
        onBound={(outcome) => setLastBind(outcome)}
      />

      <UnbindMemberModal
        sid={unbindSid}
        incarnationName={incarnationName}
        pending={unbindMu.isPending}
        error={unbindError}
        onClose={() => {
          setUnbindSid(null);
          setUnbindError(null);
        }}
        onConfirm={(sid) => unbindMu.mutate(sid)}
      />
    </>
  );
}

// bound_at is RFC 3339 from the wire; an unparsable value is shown as-is rather
// than as "Invalid Date".
function formatBoundAt(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}
