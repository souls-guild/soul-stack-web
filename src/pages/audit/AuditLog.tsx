import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import {
  keeperApi,
  type AuditEvent,
  type AuditEventSource,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import i18n from '../../i18n';
import styles from '../common.module.css';

// satisfies гарантирует, что список ⊆ AuditEventSource; tsc упадёт при добавлении нового source в backend
const SOURCES = [
  'signal',
  'api',
  'mcp',
  'keeper_internal',
  'soul_grpc',
  'background',
] as const satisfies readonly AuditEventSource[];

// Color-coding badge по source. Tone-набор фиксированный (Badge.tsx).
function sourceTone(s: AuditEventSource | string | undefined):
  'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (s) {
    case 'api':
      return 'info';
    case 'mcp':
      return 'ok';
    case 'soul_grpc':
      return 'warn';
    case 'keeper_internal':
      return 'muted';
    case 'background':
      return 'muted';
    case 'signal':
      return 'danger';
    default:
      return 'muted';
  }
}

// Маппинг dot-нотации event-типов в i18n-ключи admin-namespace.
// Точки заменяются на _ для совместимости с JSON-ключами (i18next не поддерживает
// вложенные точки в flat-namespace; graceful fallback — отсутствующий ключ → undefined).
function auditEventLabelKey(type: string): string {
  return `admin:auditEventLabel_${type.replace(/\./g, '_')}`;
}

const PAYLOAD_LIMIT_CHARS = 64_000;

// Большие/binary-подобные payload-ы рендерим обрезанными — UI не должен
// зависать на 10MB JSON-е. Truncation видна оператору, не молчаливая.
function maybeTruncatePayload(payload: unknown): { value: unknown; truncated: boolean } {
  if (payload == null) return { value: payload, truncated: false };
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return { value: { error: i18n.t('admin:auditPayloadNotSerializable') }, truncated: true };
  }
  if (text.length <= PAYLOAD_LIMIT_CHARS) {
    return { value: payload, truncated: false };
  }
  return {
    value: {
      truncated_preview: text.slice(0, PAYLOAD_LIMIT_CHARS) + '…',
      original_size_chars: text.length,
    },
    truncated: true,
  };
}

// Multi-value CSV input ("scenario.applied, push.applied") → массив без пустых.
function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// datetime-local input (`YYYY-MM-DDTHH:mm`) → RFC3339 (`...:00Z`).
// Пустая строка → undefined, чтобы не уехать в query.
function localToRfc3339(local: string): string | undefined {
  if (!local) return undefined;
  // datetime-local — naive, без TZ. Считаем UTC для предсказуемости фильтра.
  return `${local}:00Z`;
}

// Строит URL для deep-link на конкретное audit-событие по correlation_id.
// Формат: /ui/audit?correlation_id=<id>
function buildAuditCorrLink(correlationId: string): string {
  const base = window.location.origin;
  return `${base}/ui/audit?correlation_id=${encodeURIComponent(correlationId)}`;
}

function EventCard({ ev }: { ev: AuditEvent }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { value, truncated } = useMemo(() => maybeTruncatePayload(ev.payload), [ev.payload]);
  // Получаем лейбл через i18n (graceful: если ключ не найден — undefined).
  const evLabel = useMemo(() => {
    if (!ev.type) return undefined;
    const key = auditEventLabelKey(ev.type);
    const raw = t(key);
    // i18next возвращает сам ключ если перевода нет → проверяем совпадение.
    return raw !== key ? raw : undefined;
  }, [ev.type, t]);

  function handleCopyLink(e: React.MouseEvent) {
    e.stopPropagation();
    if (!ev.correlation_id) return;
    const url = buildAuditCorrLink(ev.correlation_id);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {/* silent — clipboard может быть недоступен */});
  }

  return (
    <div className={styles.timelineItem}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        aria-expanded={open}
        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <div className={styles.timelineHead}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Badge tone={sourceTone(ev.source)}>{ev.source}</Badge>
            <span className="mono">{ev.type}</span>
            {evLabel ? (
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                — {evLabel}
              </span>
            ) : null}
          </span>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>{ev.created_at}</span>
            {ev.correlation_id ? (
              <button
                type="button"
                onClick={handleCopyLink}
                title={t('admin:auditCopyLinkTitle')}
                aria-label={t('admin:auditCopyLinkAria')}
                data-testid={`audit-copy-link-${ev.id}`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: copied ? 'var(--accent)' : 'var(--text-muted)',
                  padding: '2px 4px',
                  borderRadius: 'var(--radius)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  transition: 'color 0.15s',
                }}
              >
                <Link2 size={13} />
              </button>
            ) : null}
          </span>
        </div>
        <div className={styles.timelineHead} style={{ fontSize: 12 }}>
          <span className="mono">{t('admin:auditArchonPrefix')} {ev.archon_aid ?? '—'}</span>
          <span className="mono" title="correlation_id">
            corr: {ev.correlation_id ?? '—'}
          </span>
          <span style={{ color: 'var(--text-faint)' }}>
            {open ? t('admin:auditCollapse') : t('admin:auditExpand')}
            {truncated ? ` · ${t('admin:auditTruncated')}` : ''}
          </span>
        </div>
      </div>
      {open ? (
        <div style={{ marginTop: 8 }}>
          <div className={styles.metaKey} style={{ marginBottom: 4 }}>
            id: <span className="mono">{ev.id}</span>
          </div>
          <JsonViewer value={value} emptyLabel={t('admin:auditPayloadEmpty')} />
        </div>
      ) : null}
    </div>
  );
}

export function AuditLog() {
  const { t } = useTranslation();
  // Поддерживаем deep-link `/audit?archon_aid=archon-alice` из ArchonDetail
  // («Activity»-tab открывает audit с предустановленным фильтром).
  const [searchParams, setSearchParams] = useSearchParams();

  const [typeCsv, setTypeCsv] = useState('');
  const [sources, setSources] = useState<AuditEventSource[]>([]);
  const [archonAid, setArchonAid] = useState(searchParams.get('archon_aid') ?? '');
  const [correlationId, setCorrelationId] = useState(searchParams.get('correlation_id') ?? '');
  const [startedAfter, setStartedAfter] = useState('');
  const [startedBefore, setStartedBefore] = useState('');
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const types = useMemo(() => parseCsv(typeCsv), [typeCsv]);
  const after = useMemo(() => localToRfc3339(startedAfter), [startedAfter]);
  const before = useMemo(() => localToRfc3339(startedBefore), [startedBefore]);

  const q = useQuery({
    queryKey: [
      'audit.list',
      { types, sources, archonAid, correlationId, after, before, limit, offset },
    ],
    queryFn: () =>
      keeperApi.audit.list({
        type: types.length ? types : undefined,
        source: sources.length ? sources : undefined,
        archon_aid: archonAid || undefined,
        correlation_id: correlationId || undefined,
        started_after: after,
        started_before: before,
        offset,
        limit,
      }),
  });

  function toggleSource(s: AuditEventSource) {
    setOffset(0);
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function syncArchonAid(v: string) {
    setArchonAid(v);
    setOffset(0);
    const next = new URLSearchParams(searchParams);
    if (v) next.set('archon_aid', v);
    else next.delete('archon_aid');
    setSearchParams(next, { replace: true });
  }

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Audit</h1>
          <div className={styles.crumbs}>{t('admin:auditCrumbs')}</div>
        </div>
      </div>

      <div className={styles.filters}>
        <label>
          <div className={styles.metaKey}>{t('admin:auditTypeLabel')}</div>
          <input
            type="text"
            value={typeCsv}
            onChange={(e) => { setTypeCsv(e.target.value); setOffset(0); }}
            placeholder={t('admin:auditTypePlaceholder')}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', minWidth: 280 }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Archon AID</div>
          <input
            type="text"
            value={archonAid}
            onChange={(e) => syncArchonAid(e.target.value)}
            placeholder={t('admin:auditArchonAidPlaceholder')}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', minWidth: 200 }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Correlation ID</div>
          <input
            type="text"
            value={correlationId}
            onChange={(e) => { setCorrelationId(e.target.value); setOffset(0); }}
            placeholder={t('admin:auditCorrelationPlaceholder')}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', minWidth: 220 }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>{t('admin:auditStartedAfter')}</div>
          <input
            type="datetime-local"
            value={startedAfter}
            onChange={(e) => { setStartedAfter(e.target.value); setOffset(0); }}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)' }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>{t('admin:auditStartedBefore')}</div>
          <input
            type="datetime-local"
            value={startedBefore}
            onChange={(e) => { setStartedBefore(e.target.value); setOffset(0); }}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', fontFamily: 'var(--font-mono)' }}
          />
        </label>
        <label>
          <div className={styles.metaKey}>Limit</div>
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => { setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 50))); setOffset(0); }}
            style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', width: 80 }}
          />
        </label>
      </div>

      <div className={styles.filters} aria-label="Source filter">
        <span className={styles.metaKey} style={{ alignSelf: 'center' }}>{t('admin:auditSourceLabel')}</span>
        {SOURCES.map((s) => {
          const active = sources.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleSource(s)}
              aria-pressed={active}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--radius)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))' : 'var(--surface)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {q.isLoading ? <div className={styles.loading}>{t('admin:auditLoading')}</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : null}

      {q.data && items.length === 0 ? (
        <div className={styles.empty}>{t('admin:auditEmpty')}</div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className={styles.timeline}>
            {items.map((ev) => <EventCard key={ev.id} ev={ev} />)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: offset === 0 ? 'not-allowed' : 'pointer' }}
            >
              {t('admin:auditPrev')}
            </button>
            <span>
              {t('admin:auditPageInfo', {
                page: currentPage,
                pages: pageCount,
                from: offset + 1,
                to: offset + items.length,
                total,
              })}
            </span>
            <button
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', cursor: offset + limit >= total ? 'not-allowed' : 'pointer' }}
            >
              {t('admin:auditNext')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
