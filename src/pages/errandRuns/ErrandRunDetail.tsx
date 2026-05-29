import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Terminal, Ban } from 'lucide-react';
import {
  keeperApi,
  type ErrandRunView,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button } from '../../components/primitives';
import { errandRunStatusTone, ERRAND_RUN_TERMINAL } from './status';
import styles from '../common.module.css';

interface SseEvent {
  at: string;
  type: string;
  text: string;
}

export function ErrandRunDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([]);
  const [sseFailed, setSseFailed] = useState(false);

  const q = useQuery({
    queryKey: ['errandRun.get', id],
    queryFn: () => keeperApi.errandRuns.get(id),
    enabled: Boolean(id),
    // Polling 3s до терминала. Если SSE работает — он будет дополнительно сам инвалидировать.
    refetchInterval: (query) => {
      const data = query.state.data as ErrandRunView | undefined;
      if (!data) return 3000;
      return ERRAND_RUN_TERMINAL.has(data.status) ? false : 3000;
    },
  });

  // SSE-stream. Если не открылся за 3 сек / закрылся с ошибкой — деградация на polling.
  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    try {
      es = keeperApi.errandRuns.events(id);
    } catch {
      setSseFailed(true);
      return;
    }
    const opened = setTimeout(() => {
      if (es && es.readyState !== EventSource.OPEN) {
        setSseFailed(true);
        es.close();
      }
    }, 3000);
    es.onopen = () => {
      setSseFailed(false);
    };
    es.onmessage = (ev) => {
      // Backend SSE-формат TBD; ожидаем JSON `{type, ...}` либо строку.
      let parsed: { type?: string; at?: string; sid?: string; status?: string } = {};
      try {
        parsed = JSON.parse(ev.data) as typeof parsed;
      } catch {
        parsed = { type: 'raw' };
      }
      setSseEvents((prev) => [
        ...prev,
        {
          at: parsed.at ?? new Date().toISOString(),
          type: parsed.type ?? 'event',
          text: parsed.sid
            ? `${parsed.sid} → ${parsed.status ?? '?'}`
            : (ev.data ?? ''),
        },
      ]);
      // Любой event инвалидирует кеш detail-а — подтянем свежую summary.
      qc.invalidateQueries({ queryKey: ['errandRun.get', id] });
    };
    es.onerror = () => {
      setSseFailed(true);
      if (es) es.close();
    };
    return () => {
      clearTimeout(opened);
      if (es) es.close();
    };
  }, [id, qc]);

  const cancelMu = useMutation({
    mutationFn: () => keeperApi.errandRuns.cancel(id),
    onSuccess: () => {
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ['errandRun.get', id] });
    },
  });

  if (q.isLoading && !q.data) return <div className={styles.loading}>{t('loading')}</div>;
  if (q.error) {
    return (
      <div className={styles.errorBox}>
        {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
      </div>
    );
  }
  const view = q.data;
  if (!view) return <div className={styles.empty}>{t('runhistory:errandRunNotFound')}</div>;

  const isRunning = !ERRAND_RUN_TERMINAL.has(view.status);
  const total = view.summary?.counts?.total ?? view.scope_size;
  const done = view.current_done ?? view.summary?.counts?.success ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const hosts = view.summary?.hosts ?? [];

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/errand-runs">errand runs</Link> /{' '}
          <span className="mono">{view.errand_run_id}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <Terminal size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              <span className="mono" style={{ fontSize: 18 }}>{view.errand_run_id}</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Badge tone={errandRunStatusTone(view.status)}>{view.status}</Badge>
            {isRunning ? (
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(true)}>
                <Ban size={14} /> {t('cancelShort')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <section className={styles.section} aria-label="Errand run meta">
        <div className={styles.meta}>
          <span className={styles.metaKey}>module</span>
          <span className={styles.metaVal}>{view.module}</span>
          <span className={styles.metaKey}>scope_size</span>
          <span className={styles.metaVal}>{view.scope_size}</span>
          <span className={styles.metaKey}>concurrency</span>
          <span className={styles.metaVal}>{view.concurrency}</span>
          <span className={styles.metaKey}>on_failure</span>
          <span className={styles.metaVal}>{view.on_failure}</span>
          {view.started_by_aid ? (
            <>
              <span className={styles.metaKey}>started_by</span>
              <span className={styles.metaVal}>{view.started_by_aid}</span>
            </>
          ) : null}
          <span className={styles.metaKey}>started_at</span>
          <span className={styles.metaVal}>{view.started_at}</span>
          {view.finished_at ? (
            <>
              <span className={styles.metaKey}>finished_at</span>
              <span className={styles.metaVal}>{view.finished_at}</span>
            </>
          ) : null}
        </div>
      </section>

      <section className={styles.section} aria-label="Progress">
        <h2 className={styles.sectionTitle}>Progress</h2>
        <div
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Progress"
          style={{
            position: 'relative',
            height: 16,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: 'var(--accent)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div className={styles.metaKey}>
          {t('runhistory:progressDoneOf', {
            done,
            total,
            pct,
            mode: sseFailed ? 'polling' : 'SSE',
          })}
        </div>
      </section>

      <section className={styles.section} aria-label="Per-host Errand summary">
        <h2 className={styles.sectionTitle}>Per-host</h2>
        {hosts.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SID</th>
                <th>Status</th>
                <th>Errand ID</th>
                <th>Error code</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={h.sid}>
                  <td className="mono">{h.sid}</td>
                  <td>
                    <Badge tone={errandRunStatusTone(h.status)}>{h.status}</Badge>
                  </td>
                  <td className="mono">
                    {h.errand_id ? (
                      <Link to={`/errands/${encodeURIComponent(h.errand_id)}`}>
                        {h.errand_id.slice(0, 10)}…
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="mono">{h.error_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className={styles.empty}>
            {isRunning
              ? t('runhistory:perHostAfterDone')
              : t('runhistory:perHostEmptySummary')}
          </div>
        )}
      </section>

      {sseEvents.length > 0 ? (
        <section className={styles.section} aria-label="Live events">
          <h2 className={styles.sectionTitle}>Events</h2>
          <div
            style={{
              maxHeight: 240,
              overflow: 'auto',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            {sseEvents.map((e, i) => (
              <div key={i}>
                <span style={{ color: 'var(--text-faint)' }}>{e.at}</span>{' '}
                <span style={{ color: 'var(--text-muted)' }}>[{e.type}]</span> {e.text}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {cancelOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancel Errand run"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 20,
              maxWidth: 480,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 500 }}>{t('pages:cancelErrandRunTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('pages:cancelErrandRunHint')} <span className="mono">{view.errand_run_id}</span>
            </div>
            {cancelMu.error ? (
              <div className={styles.errorBox}>
                {cancelMu.error instanceof ApiError
                  ? t('errors:generic', { status: cancelMu.error.status, detail: cancelMu.error.message })
                  : String(cancelMu.error)}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>
                {t('close')}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => cancelMu.mutate()}
                disabled={cancelMu.isPending}
              >
                {cancelMu.isPending ? t('cancelling') : t('cancel2')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
