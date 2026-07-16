import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { keeperApi, type PushApplyView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Input } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import styles from '../common.module.css';

const TERMINAL: ReadonlySet<string> = new Set(['success', 'partial_failed', 'failed', 'cancelled']);

function statusTone(s: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success': return 'ok';
    case 'partial_failed': return 'warn';
    case 'failed': return 'danger';
    case 'cancelled': return 'muted';
    case 'pending':
    case 'running': return 'info';
    default: return 'muted';
  }
}

interface HostSummary {
  sid: string;
  status: string;
  error?: string;
}

function readHosts(summary: PushApplyView['summary'] | undefined): HostSummary[] | null {
  if (!summary || typeof summary !== 'object') return null;
  const hosts = (summary as { hosts?: unknown }).hosts;
  if (!Array.isArray(hosts)) return null;
  return hosts.filter((h): h is HostSummary => !!h && typeof h === 'object' && typeof (h as HostSummary).sid === 'string');
}

export function PushApply() {
  const { t } = useTranslation();
  const [inventoryRaw, setInventoryRaw] = useState('');
  const [destiny, setDestiny] = useState('');
  const [sshProvider, setSshProvider] = useState('');
  const [inputRaw, setInputRaw] = useState('{}');
  const [cleanup, setCleanup] = useState(false);
  const [applyId, setApplyId] = useState<string | null>(null);

  const inventory = useMemo(
    () => inventoryRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    [inventoryRaw],
  );

  // Parse input — once, otherwise it would re-run on every keystroke.
  const inputParsed = useMemo<{ ok: true; value: Record<string, unknown> } | { ok: false; err: string }>(() => {
    const trimmed = inputRaw.trim();
    if (!trimmed) return { ok: true, value: {} };
    try {
      const v = JSON.parse(trimmed);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, err: t('runhistory:pushInputMustBeObject') };
      }
      return { ok: true, value: v as Record<string, unknown> };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : 'invalid JSON' };
    }
  }, [inputRaw, t]);

  const submit = useMutation({
    mutationFn: () => {
      if (!inputParsed.ok) throw new Error(inputParsed.err);
      return keeperApi.push.apply({
        inventory,
        destiny,
        input: inputParsed.value,
        ssh_provider: sshProvider || undefined,
        cleanup_stale_versions: cleanup,
      });
    },
    onSuccess: (reply) => {
      setApplyId(reply.apply_id);
    },
  });

  // Poll GET /v1/push/{apply_id} until terminal.
  const poll = useQuery({
    queryKey: ['push.get', applyId],
    queryFn: () => keeperApi.push.get(applyId!),
    enabled: !!applyId,
    refetchInterval: (q) => {
      const data = q.state.data as PushApplyView | undefined;
      if (!data) return 2000;
      return TERMINAL.has(data.status ?? '') ? false : 2000;
    },
  });

  // Reset apply_id when submitting a new run.
  useEffect(() => {
    if (submit.isPending) setApplyId(null);
  }, [submit.isPending]);

  const view = poll.data;
  const hosts = view ? readHosts(view.summary) : null;
  const submitDisabled =
    inventory.length === 0 || !destiny || !inputParsed.ok || submit.isPending;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Push apply</h1>
          <div className={styles.crumbs}>{t('runhistory:pushApplyCrumbs')}</div>
        </div>
      </div>

      <div className={styles.deprecationBanner} role="note" aria-label="Deprecation notice">
        {t('runhistory:deprecationBannerBefore')}
        <Link to="/run?workload=push">{t('runhistory:runWizardLink')}</Link>
        {t('runhistory:deprecationPushAfter')}
      </div>

      <section className={styles.section} aria-label={t('runhistory:pushParamsSectionAria')}>
        <div className={styles.filters}>
          <Input
            label="Destiny ref"
            value={destiny}
            onChange={(e) => setDestiny(e.target.value)}
            placeholder="redis-cluster@v2.0.0"
            mono
            hint={t('runhistory:pushDestinyHint')}
          />
          <Input
            label="SSH provider"
            value={sshProvider}
            onChange={(e) => setSshProvider(e.target.value)}
            placeholder="default"
            mono
            hint={t('runhistory:pushSshHint')}
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>{t('runhistory:pushCleanupLabel')}</span>
            <input
              type="checkbox"
              checked={cleanup}
              onChange={(e) => setCleanup(e.target.checked)}
              style={{ width: 20, height: 20 }}
              aria-label="cleanup_stale_versions"
            />
          </label>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={styles.metaKey}>{t('runhistory:pushInventoryLabel')}</span>
          <textarea
            value={inventoryRaw}
            onChange={(e) => setInventoryRaw(e.target.value)}
            rows={4}
            placeholder="host01.example.com&#10;host02.example.com"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              padding: 8,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              resize: 'vertical',
            }}
          />
          <span className={styles.metaKey}>{t('runhistory:pushHostsCount', { count: inventory.length })}</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={styles.metaKey}>{t('runhistory:inputJsonLabel')}</span>
          <textarea
            value={inputRaw}
            onChange={(e) => setInputRaw(e.target.value)}
            rows={6}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              padding: 8,
              background: 'var(--surface)',
              border: `1px solid ${inputParsed.ok ? 'var(--border)' : 'var(--danger)'}`,
              borderRadius: 'var(--radius)',
              resize: 'vertical',
            }}
          />
          {!inputParsed.ok ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{inputParsed.err}</span>
          ) : null}
        </label>
        <div>
          <Button variant="primary" disabled={submitDisabled} onClick={() => submit.mutate()}>
            {submit.isPending ? t('sending') : t('pushApply')}
          </Button>
        </div>
        {submit.error ? (
          <div className={styles.errorBox}>
            {submit.error instanceof ApiError
              ? t('errors:generic', { status: submit.error.status, detail: submit.error.message })
              : String(submit.error)}
          </div>
        ) : null}
      </section>

      {applyId ? (
        <section className={styles.section} aria-label="Run state">
          <h2 className={styles.sectionTitle}>{t('runhistory:pushRunStateTitle')} <span className="mono">{applyId}</span></h2>
          {poll.isLoading ? <div className={styles.loading}>{t('runhistory:pushRunStateRequesting')}</div> : null}
          {poll.error ? (
            <div className={styles.errorBox}>
              {poll.error instanceof ApiError
                ? t('errors:generic', { status: poll.error.status, detail: poll.error.message })
                : String(poll.error)}
            </div>
          ) : null}
          {view ? (
            <>
              <div className={styles.meta}>
                <span className={styles.metaKey}>status</span>
                <span><Badge tone={statusTone(view.status)}>{view.status}</Badge></span>
                <span className={styles.metaKey}>destiny</span>
                <span className={styles.metaVal}>{view.destiny_ref}</span>
                <span className={styles.metaKey}>started_at</span>
                <span className={styles.metaVal}>{view.started_at}</span>
                {view.finished_at ? (
                  <>
                    <span className={styles.metaKey}>finished_at</span>
                    <span className={styles.metaVal}>{view.finished_at}</span>
                  </>
                ) : null}
                {view.started_by_aid ? (
                  <>
                    <span className={styles.metaKey}>by</span>
                    <span className={styles.metaVal}>{view.started_by_aid}</span>
                  </>
                ) : null}
              </div>
              {hosts ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>SID</th>
                      <th>Status</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hosts.map((h) => (
                      <tr key={h.sid}>
                        <td className="mono">{h.sid}</td>
                        <td><Badge tone={statusTone(h.status)}>{h.status}</Badge></td>
                        <td className="mono">{h.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <JsonViewer value={view.summary} emptyLabel={t('runhistory:pushSummaryAfterTerminal')} />
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
