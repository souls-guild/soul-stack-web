import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, Terminal } from 'lucide-react';
import {
  keeperApi,
  type ErrandAccepted,
  type ErrandResult,
  type ErrandStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import i18n from '../../i18n';
import styles from '../common.module.css';

type Tab = 'output' | 'params' | 'events';

// satisfies: перечисление ⊆ ErrandStatus; при добавлении статуса в backend tsc потребует пересмотра.
const TERMINAL_STATUSES = [
  'success',
  'failed',
  'timed_out',
  'cancelled',
  'module_not_allowed',
] as const satisfies readonly ErrandStatus[];
const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

function statusTone(s: string | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'success':
      return 'ok';
    case 'failed':
    case 'timed_out':
    case 'module_not_allowed':
      return 'danger';
    case 'cancelled':
      return 'muted';
    case 'running':
      return 'info';
    default:
      return 'muted';
  }
}

// GET /v1/errands/{id} возвращает 200 ErrandResult (терминал) ИЛИ 202 ErrandAccepted
// (running). Различаем по полю `started_at` (есть только у ErrandResult).
function isResult(v: ErrandResult | ErrandAccepted | undefined): v is ErrandResult {
  if (!v) return false;
  return 'started_at' in v;
}

interface DerivedEvent {
  at?: string;
  kind: 'started' | 'finished';
  tone: 'ok' | 'danger' | 'info' | 'muted';
  text: string;
}

function deriveEvents(r: ErrandResult): DerivedEvent[] {
  // Backend сейчас не отдаёт по-шаговые TaskEvent-ы для одиночного Errand-а
  // (см. observations). Делаем минимальную шкалу: started → finished + кратко
  // exit/error_message.
  const events: DerivedEvent[] = [
    {
      at: r.started_at,
      kind: 'started',
      tone: 'info',
      text: i18n.t('runhistory:startedByPrefix', { aid: r.started_by_aid }),
    },
  ];
  if (r.finished_at) {
    const tone =
      r.status === 'success'
        ? 'ok'
        : r.status === 'cancelled'
          ? 'muted'
          : 'danger';
    const exitPart = r.exit_code !== undefined && r.exit_code !== null ? `, exit=${r.exit_code}` : '';
    const errPart = r.error_message ? `, ${r.error_message}` : '';
    events.push({
      at: r.finished_at,
      kind: 'finished',
      tone,
      text: `${r.status}${exitPart}${errPart}`,
    });
  }
  return events;
}

function copyToClipboard(text: string): void {
  if (navigator?.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

function StreamBlock({
  label,
  text,
  truncated,
  autoScroll,
}: {
  label: string;
  text?: string;
  truncated?: boolean;
  autoScroll?: boolean;
}) {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [text, autoScroll]);

  if (!text) {
    return (
      <div className={styles.empty} style={{ padding: 'var(--s-4)' }}>
        {t('runhistory:outputEmpty', { label })}
      </div>
    );
  }
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span>
          {label}
          {truncated ? ' · truncated' : ''}
        </span>
        <button
          type="button"
          onClick={() => copyToClipboard(text)}
          aria-label={t('runhistory:copyStream', { label })}
          title="copy"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '2px 8px',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11.5,
          }}
        >
          <Copy size={12} /> copy
        </button>
      </div>
      <pre
        ref={preRef}
        style={{
          margin: 0,
          padding: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          maxHeight: 480,
          overflow: 'auto',
          background: 'var(--surface-2)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {text}
        {truncated ? '\n[truncated at 64 KiB]' : ''}
      </pre>
    </div>
  );
}

export function ErrandDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('output');

  const q = useQuery({
    queryKey: ['errand.get', id],
    queryFn: () => keeperApi.errands.get(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as ErrandResult | ErrandAccepted | undefined;
      if (!data) return 1500;
      if (!isResult(data)) return 1500;
      return TERMINAL.has(data.status) ? false : 1500;
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

  const data = q.data;
  if (!data) return <div className={styles.empty}>{t('runhistory:errandNotFound')}</div>;

  // Заголовок и meta-блок одинаковы для running/terminal — пользуемся available-полями.
  const isFull = isResult(data);
  const result: ErrandResult | undefined = isFull ? data : undefined;
  const status = isFull ? data.status : 'running';

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/errands">errands</Link> / <span className="mono">{id}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <Terminal size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              <span className="mono" style={{ fontSize: 18 }}>
                {id}
              </span>
            </h1>
          </div>
          <div>
            <Badge tone={statusTone(status)}>{status}</Badge>
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        {result ? (
          <>
            <span className={styles.metaKey}>module</span>
            <span className={styles.metaVal}>{result.module}</span>
            <span className={styles.metaKey}>sid</span>
            <span className={styles.metaVal}>
              <KeeperSidCell sid={result.sid} />
            </span>
            <span className={styles.metaKey}>started_by</span>
            <span className={styles.metaVal}>{result.started_by_aid}</span>
            <span className={styles.metaKey}>started_at</span>
            <span className={styles.metaVal}>{result.started_at}</span>
            {result.finished_at ? (
              <>
                <span className={styles.metaKey}>finished_at</span>
                <span className={styles.metaVal}>{result.finished_at}</span>
              </>
            ) : null}
            {result.exit_code !== undefined && result.exit_code !== null ? (
              <>
                <span className={styles.metaKey}>exit_code</span>
                <span className={styles.metaVal}>{result.exit_code}</span>
              </>
            ) : null}
            {result.duration_ms !== undefined ? (
              <>
                <span className={styles.metaKey}>duration_ms</span>
                <span className={styles.metaVal}>{result.duration_ms}</span>
              </>
            ) : null}
            {result.error_message ? (
              <>
                <span className={styles.metaKey}>error</span>
                <span className={styles.metaVal} style={{ color: 'var(--danger)' }}>
                  {result.error_message}
                </span>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className={styles.metaKey}>status</span>
            <span className={styles.metaVal}>{t('runhistory:statusRunningPolling')}</span>
          </>
        )}
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'output'}
          className={`${styles.tab} ${tab === 'output' ? styles.tabActive : ''}`}
          onClick={() => setTab('output')}
        >
          Output
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'params'}
          className={`${styles.tab} ${tab === 'params' ? styles.tabActive : ''}`}
          onClick={() => setTab('params')}
        >
          Params
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'events'}
          className={`${styles.tab} ${tab === 'events' ? styles.tabActive : ''}`}
          onClick={() => setTab('events')}
        >
          Events
        </button>
      </div>

      {tab === 'output' ? (
        <section className={styles.section} aria-label="Output">
          {result ? (
            <>
              <StreamBlock
                label="stdout"
                text={result.stdout}
                truncated={result.stdout_truncated}
                autoScroll={status === 'running'}
              />
              <StreamBlock
                label="stderr"
                text={result.stderr}
                truncated={result.stderr_truncated}
                autoScroll={status === 'running'}
              />
            </>
          ) : (
            <div className={styles.empty}>{t('runhistory:errandStillRunning')}</div>
          )}
        </section>
      ) : null}

      {tab === 'params' ? (
        <section className={styles.section} aria-label="Params">
          {result?.output ? (
            <div>
              <div className={styles.metaKey} style={{ marginBottom: 6 }}>
                module output
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(result.output, null, 2)}
              </pre>
            </div>
          ) : (
            <div className={styles.empty}>
              {t('runhistory:paramsReadSafeHintPre')}<code className="mono">output</code>{t('runhistory:paramsReadSafeHintPost')}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'events' ? (
        <section className={styles.section} aria-label="Events">
          {result ? (
            <div className={styles.timeline}>
              {deriveEvents(result).map((ev, i) => (
                <div key={i} className={styles.timelineItem}>
                  <div className={styles.timelineHead}>
                    <span>
                      <Badge tone={ev.tone}>{ev.kind}</Badge>
                    </span>
                    <span>{ev.at ?? ''}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {ev.text}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>{t('runhistory:eventsAfterFinish')}</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
