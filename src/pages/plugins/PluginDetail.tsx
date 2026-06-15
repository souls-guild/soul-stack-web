import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, CheckCircle2, XCircle, Copy, Info } from 'lucide-react';
import { keeperApi, type PluginSigilView, type AuditEvent } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { isSigilDisabled } from './sigilUtils';
import { Badge, Button } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import styles from '../common.module.css';

type Tab = 'overview' | 'audit' | 'kinds';

// Plugin-kind title (structural — имена контрактов) + i18n-ключ summary.
const KIND_INFO: Record<string, { title: string; summaryKey: string }> = {
  mod: { title: 'soul_module / soul_beacon', summaryKey: 'admin:pluginKindModSummary' },
  cloud: { title: 'cloud_driver', summaryKey: 'admin:pluginKindCloudSummary' },
  ssh: { title: 'ssh_provider', summaryKey: 'admin:pluginKindSshSummary' },
};

export function PluginDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { namespace = '', name = '', ref = '' } = useParams<{
    namespace: string;
    name: string;
    ref: string;
  }>();
  const [tab, setTab] = useState<Tab>('overview');

  // GET /v1/plugins/sigils/{ns}/{name}/{ref} в API нет — lookup из list-а.
  const list = useQuery({
    queryKey: ['plugins.sigils.list'],
    queryFn: () => keeperApi.plugins.sigils.list(),
  });

  const row: PluginSigilView | undefined = useMemo(() => {
    return (list.data?.items ?? []).find(
      (it) => it.namespace === namespace && it.name === name && it.ref === ref,
    );
  }, [list.data, namespace, name, ref]);

  // Audit-история допуска/ревокации по correlation_id невозможна (id не отдаётся).
  // Фильтруем по type=plugin.sigil.allowed / plugin.sigil.revoked и ищем event-ы,
  // где payload содержит соответствующий (ns, name, ref).
  const audit = useQuery({
    queryKey: ['plugins.sigil.audit', namespace, name, ref],
    queryFn: () =>
      keeperApi.audit.list({
        type: ['plugin.sigil.allowed', 'plugin.sigil.revoked'],
        limit: 200,
      }),
    enabled: tab === 'audit' && Boolean(namespace && name && ref),
  });

  const matched = useMemo<AuditEvent[]>(() => {
    if (!audit.data) return [];
    return (audit.data?.items ?? []).filter((ev) => {
      const p = ev.payload as Record<string, unknown> | undefined;
      if (!p) return false;
      return p.namespace === namespace && p.name === name && p.ref === ref;
    });
  }, [audit.data, namespace, name, ref]);

  const revokeMut = useMutation({
    mutationFn: () => keeperApi.plugins.sigils.revoke(namespace, name, ref),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugins.sigils.list'] });
      // После revoke страница продолжит работать (revoked_at появится),
      // navigate возвращает к списку, чтобы оператор увидел обновление.
      navigate('/plugins');
    },
  });

  if (list.isLoading) return <div className={styles.loading}>{t('admin:pluginLoading')}</div>;
  if (list.error) {
    if (isSigilDisabled(list.error)) {
      return (
        <div className={styles.page}>
          <div className={styles.crumbs}>
            <Link to="/plugins">plugins</Link>
          </div>
          <div
            style={{
              padding: 'var(--s-4)',
              background: 'color-mix(in srgb, var(--text-muted) 6%, var(--surface))',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <strong style={{ fontSize: 15 }}>{t('admin:pluginSigilDisabledTitle')}</strong>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {t('admin:pluginSigilDisabledBody')}
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.errorBox}>
        {list.error instanceof ApiError
          ? t('errors:generic', { status: list.error.status, detail: list.error.message })
          : String(list.error)}
      </div>
    );
  }
  if (!row) {
    return (
      <div className={styles.page}>
        <div className={styles.crumbs}>
          <Link to="/plugins">plugins</Link> /{' '}
          <span className="mono">
            {namespace}/{name}@{ref}
          </span>
        </div>
        <div className={styles.empty}>
          {t('admin:pluginNotFound')} <code className="mono">{namespace}/{name}@{ref}</code> {t('admin:pluginNotFound2')}{' '}
          <code className="mono">POST /v1/plugins/sigils</code>.
        </div>
      </div>
    );
  }

  const revoked = Boolean(row.revoked_at);

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/plugins">plugins</Link> /{' '}
          <span className="mono">
            {row.namespace}/{row.name}@{row.ref}
          </span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Award size={22} /> {row.name}
            </h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <Badge tone="info">{row.namespace}</Badge>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                @{row.ref}
              </span>
              {revoked ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <XCircle size={14} color="var(--danger)" />
                  <Badge tone="danger">revoked</Badge>
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={14} color="var(--ok, #2e7d32)" />
                  <Badge tone="ok">active</Badge>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="danger"
              disabled={revoked || revokeMut.isPending}
              onClick={() => {
                const ok = window.confirm(
                  t('pages:revokeSigilConfirm', { sigil: `${row.namespace}/${row.name}@${row.ref}` }),
                );
                if (ok) revokeMut.mutate();
              }}
              title={revoked ? t('revokeDisabled') : t('pages:revokeSigilTitle')}
            >
              {revokeMut.isPending ? t('revoking') : t('revoke')}
            </Button>
          </div>
        </div>
      </div>

      {revokeMut.error ? (
        <div className={styles.errorBox}>
          {revokeMut.error instanceof ApiError
            ? t('errors:generic', { status: revokeMut.error.status, detail: revokeMut.error.message })
            : String(revokeMut.error)}
        </div>
      ) : null}

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'audit'}
          className={`${styles.tab} ${tab === 'audit' ? styles.tabActive : ''}`}
          onClick={() => setTab('audit')}
        >
          Audit history
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'kinds'}
          className={`${styles.tab} ${tab === 'kinds' ? styles.tabActive : ''}`}
          onClick={() => setTab('kinds')}
        >
          Plugin kinds
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          <div className={styles.meta}>
            <span className={styles.metaKey}>Namespace</span>
            <span className={styles.metaVal}>{row.namespace}</span>
            <span className={styles.metaKey}>Name</span>
            <span className={styles.metaVal}>{row.name}</span>
            <span className={styles.metaKey}>Ref</span>
            <span className={styles.metaVal}>{row.ref}</span>
            <span className={styles.metaKey}>Allowed at</span>
            <span className={styles.metaVal}>{row.allowed_at}</span>
            <span className={styles.metaKey}>Allowed by</span>
            <span className={styles.metaVal}>
              <Link to={`/archons/${encodeURIComponent(row.allowed_by_aid)}`}>{row.allowed_by_aid}</Link>
            </span>
            <span className={styles.metaKey}>Revoked at</span>
            <span className={styles.metaVal}>{row.revoked_at ?? '—'}</span>
          </div>

          <section className={styles.section} aria-label="sha256">
            <h2 className={styles.sectionTitle}>{t('admin:pluginSha256Title')}</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              {t('admin:pluginSha256Prose')}
            </p>
            <Sha256Block sha256={row.sha256} />
          </section>
        </>
      ) : null}

      {tab === 'audit' ? (
        <section className={styles.section} aria-label="audit history">
          <h2 className={styles.sectionTitle}>{t('admin:pluginAuditTitle')}</h2>
          {audit.isLoading ? <div className={styles.loading}>{t('admin:pluginLoading')}</div> : null}
          {audit.error ? (
            <div className={styles.errorBox}>
              {audit.error instanceof ApiError
                ? t('errors:generic', { status: audit.error.status, detail: audit.error.message })
                : String(audit.error)}
            </div>
          ) : null}
          {audit.data && matched.length === 0 ? (
            <div className={styles.empty} style={{ padding: 'var(--s-3)' }}>
              {t('admin:pluginAuditEmpty')} <code className="mono">plugin.sigil.allowed</code> /{' '}
              <code className="mono">plugin.sigil.revoked</code> {t('admin:pluginAuditEmpty2')}
            </div>
          ) : null}
          {matched.length > 0 ? (
            <div className={styles.timeline}>
              {matched.map((ev) => (
                <div key={ev.id} className={styles.timelineItem}>
                  <div className={styles.timelineHead}>
                    <span>
                      <Badge tone={ev.type === 'plugin.sigil.revoked' ? 'danger' : 'ok'}>
                        {ev.type}
                      </Badge>{' '}
                      <span className="mono" style={{ marginLeft: 8 }}>
                        {ev.archon_aid ?? '—'}
                      </span>
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{ev.created_at}</span>
                  </div>
                  <JsonViewer value={ev.payload} />
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'kinds' ? (
        <section className={styles.section} aria-label="plugin kinds">
          <h2 className={styles.sectionTitle}>
            <Info size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            {t('admin:pluginKindsTitle')}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {t('admin:pluginKindsProse')}
          </p>
          <ul style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18 }}>
            {Object.entries(KIND_INFO).map(([ns, info]) => (
              <li key={ns}>
                <code className="mono">
                  <Badge tone={ns === row.namespace ? 'info' : 'muted'}>{ns}</Badge>
                </code>{' '}
                — <strong>{info.title}</strong>. {t(info.summaryKey)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Sha256Block({ sha256 }: { sha256: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        wordBreak: 'break-all',
      }}
    >
      <span style={{ flex: 1 }}>{sha256}</span>
      <Button
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(sha256);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        title={t('admin:pluginSha256Copy')}
      >
        <Copy size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />
        {copied ? t('copied') : t('copy')}
      </Button>
    </div>
  );
}
