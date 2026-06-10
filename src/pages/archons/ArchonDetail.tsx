import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { keeperApi, type OperatorAuthMethod } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import { RevokeArchonModal } from './RevokeArchonModal';
import { AssignRoleModal } from '../rbac/AssignRoleModal';
import { prettyRbacError } from '../rbac/errors';
import styles from '../common.module.css';

type Tab = 'info' | 'activity';

function authMethodTone(m: OperatorAuthMethod | string | undefined):
  'ok' | 'warn' | 'info' | 'muted' {
  switch (m) {
    case 'mtls':
      return 'ok';
    case 'combined':
      return 'info';
    case 'jwt':
      return 'warn';
    default:
      return 'muted';
  }
}

export function ArchonDetail() {
  const { t } = useTranslation();
  const { aid = '' } = useParams<{ aid: string }>();
  const [tab, setTab] = useState<Tab>('info');
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [revokeRoleError, setRevokeRoleError] = useState<string | null>(null);

  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['operator', aid],
    queryFn: () => keeperApi.operators.get(aid),
    enabled: Boolean(aid),
  });

  // Каталог ролей кластера — для секции «Roles» в info-табе. Membership
  // выводится из role.operators.includes(aid), та же логика, что в
  // RbacPage::MembersTab — RBAC остаётся источником правды.
  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
    enabled: Boolean(aid),
    staleTime: 30_000,
  });
  const memberRoles = (rolesQ.data?.items ?? []).filter((r) => r.operators.includes(aid));

  // Каталог Synod-групп — для секции «Синоды» в info-табе.
  const synodsQ = useQuery({
    queryKey: ['synods'],
    queryFn: () => keeperApi.synods.list(),
    enabled: Boolean(aid),
    staleTime: 30_000,
  });
  const memberSynods = (synodsQ.data?.items ?? []).filter((s) => s.operators.includes(aid));

  const revokeRoleMut = useMutation({
    mutationFn: (roleName: string) => keeperApi.roles.revokeOperator(roleName, aid),
    onSuccess: () => {
      setRevokeRoleError(null);
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
    },
    onError: (err) => setRevokeRoleError(prettyRbacError(err)),
  });

  if (q.isLoading) return <div className={styles.loading}>{t('loading')}</div>;
  if (q.error) {
    return (
      <div className={styles.errorBox}>
        {q.error instanceof ApiError
          ? t('errors:generic', { status: q.error.status, detail: q.error.message })
          : String(q.error)}
      </div>
    );
  }
  const op = q.data;
  if (!op) return <div className={styles.empty}>{t('errors:archonNotFound')}</div>;

  const revoked = Boolean(op.revoked_at);
  const hasMetadata = op.metadata && Object.keys(op.metadata).length > 0;

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/archons">archons</Link> / <span className="mono">{op.aid}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{op.display_name}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {op.aid}
              </span>
              <Badge tone={authMethodTone(op.auth_method)}>{op.auth_method}</Badge>
              {op.bootstrap_initial ? <Badge tone="info">bootstrap initial</Badge> : null}
              {revoked ? <Badge tone="danger">revoked</Badge> : <Badge tone="ok">active</Badge>}
            </div>
          </div>
          {!revoked ? (
            <Button variant="danger" data-testid="revoke-archon" onClick={() => setRevokeOpen(true)}>
              {t('revoke')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'info'}
          className={`${styles.tab} ${tab === 'info' ? styles.tabActive : ''}`}
          onClick={() => setTab('info')}
        >
          Info
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'activity'}
          className={`${styles.tab} ${tab === 'activity' ? styles.tabActive : ''}`}
          onClick={() => setTab('activity')}
        >
          Activity
        </button>
      </div>

      {tab === 'info' ? (
        <>
          <div className={styles.meta}>
            <span className={styles.metaKey}>AID</span>
            <span className={styles.metaVal}>{op.aid}</span>
            <span className={styles.metaKey}>{t('pages:archonDisplayName')}</span>
            <span className={styles.metaVal}>{op.display_name}</span>
            <span className={styles.metaKey}>{t('pages:archonAuthMethod')}</span>
            <span className={styles.metaVal}>{op.auth_method}</span>
            <span className={styles.metaKey}>Created at</span>
            <span className={styles.metaVal}>{op.created_at}</span>
            <span className={styles.metaKey}>Created by</span>
            <span className={styles.metaVal}>{op.created_by_aid ?? '— (bootstrap)'}</span>
            <span className={styles.metaKey}>Revoked at</span>
            <span className={styles.metaVal}>{op.revoked_at ?? '—'}</span>
            <span className={styles.metaKey}>Bootstrap initial</span>
            <span className={styles.metaVal}>{op.bootstrap_initial ? 'true' : 'false'}</span>
          </div>
          <section className={styles.section} aria-label="roles">
            <h2 className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Roles</span>
              <span style={{ flex: 1 }} />
              {!revoked ? (
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="assign-role-btn"
                  onClick={() => setAssignOpen(true)}
                >
                  {t('assignRole')}
                </Button>
              ) : null}
            </h2>
            {revokeRoleError ? (
              <div className={styles.errorBox} role="alert" style={{ marginBottom: 8 }}>
                {revokeRoleError}
              </div>
            ) : null}
            {rolesQ.isLoading ? (
              <div className={styles.loading}>{t('loading')}</div>
            ) : memberRoles.length === 0 ? (
              <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>
                {t('pages:archonNoRoles')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {memberRoles.map((r) => (
                  <span
                    key={r.name}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 6px 2px 8px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-pill)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    {r.name}
                    {r.builtin ? <Badge tone="info">builtin</Badge> : null}
                    <button
                      type="button"
                      aria-label={t('pages:archonRevokeRoleAria', { role: r.name })}
                      title={t('pages:archonRevokeRoleAria', { role: r.name })}
                      disabled={revokeRoleMut.isPending}
                      onClick={() => {
                        setRevokeRoleError(null);
                        if (window.confirm(t('pages:archonRevokeRoleConfirm', { role: r.name, aid }))) {
                          revokeRoleMut.mutate(r.name);
                        }
                      }}
                      style={{
                        border: 0,
                        background: 'transparent',
                        cursor: revokeRoleMut.isPending ? 'not-allowed' : 'pointer',
                        color: 'var(--text-muted)',
                        padding: 0,
                        display: 'inline-flex',
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
          <section className={styles.section} aria-label="synods">
            <h2 className={styles.sectionTitle}>{t('pages:archonSynods')}</h2>
            {synodsQ.isLoading ? (
              <div className={styles.loading}>{t('loading')}</div>
            ) : memberSynods.length === 0 ? (
              <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>
                {t('pages:archonNoSynods')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {memberSynods.map((s) => (
                  <Link
                    key={s.name}
                    to={`/synods/${encodeURIComponent(s.name)}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-pill)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    {s.name}
                    {s.builtin ? <Badge tone="info">builtin</Badge> : null}
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section className={styles.section} aria-label="metadata">
            <h2 className={styles.sectionTitle}>Metadata</h2>
            {hasMetadata ? (
              <JsonViewer value={op.metadata} />
            ) : (
              <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>{t('pages:metadataEmpty')}</div>
            )}
          </section>
        </>
      ) : null}

      <RevokeArchonModal
        aid={op.aid}
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
      />

      <AssignRoleModal
        open={assignOpen}
        aid={op.aid}
        roles={rolesQ.data?.items ?? []}
        onClose={() => setAssignOpen(false)}
      />

      {tab === 'activity' ? (
        <section className={styles.section} aria-label="activity">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {t('pages:archonActivityHint')}
          </p>
          <div>
            <Link
              to={`/audit?archon_aid=${encodeURIComponent(op.aid)}`}
              style={{
                display: 'inline-block',
                padding: '8px 14px',
                background: 'var(--accent)',
                color: 'var(--accent-on)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                fontSize: 13,
              }}
            >
              Открыть Audit ↗
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
