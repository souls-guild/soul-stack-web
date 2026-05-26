import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge, Dot } from '../../components/primitives';
import { soulDot, soulTone } from '../../components/status';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

// MVP: openapi.yaml (`GET /v1/souls/{sid}`) пока не выставлено — permission
// soul.get отсутствует. Поэтому detail-страница подтягивает запись из
// list-результата (фильтр по sid) и показывает плейсхолдер для Soulprint.
// При появлении soul.get / soulprint-endpoint обновим.

export function SoulDetail() {
  const { sid = '' } = useParams<{ sid: string }>();

  // sid не является фильтр-параметром openapi; берём страницу побольше и
  // ищём локально. Достаточно для pilot, замена — отдельный endpoint.
  const q = useQuery({
    queryKey: ['souls-find', sid],
    queryFn: () => keeperApi.souls.list({ limit: 500 }),
    enabled: Boolean(sid),
  });

  if (q.isLoading) return <div className={styles.loading}>Загружаем…</div>;
  if (q.error) {
    return (
      <div className={styles.errorBox}>
        {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
      </div>
    );
  }

  const row = q.data?.items.find((item) => item.sid === sid);
  if (!row) {
    return (
      <div className={styles.empty}>
        Soul <code className="mono">{sid}</code> не найдена в первых 500 записях. Endpoint <code className="mono">GET /v1/souls/{'{sid}'}</code> ещё не выставлен (см. TODO в README).
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/souls">souls</Link> / <span>{row.sid}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{row.sid}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <Dot kind={soulDot(row.status)} />
              <Badge tone={soulTone(row.status)}>{row.status}</Badge>
              <Badge tone="muted">{row.transport}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.metaKey}>Covens</span>
        <span className={styles.metaVal}>{row.covens?.join(', ') || '—'}</span>
        <span className={styles.metaKey}>Last seen</span>
        <span className={styles.metaVal}>{row.last_seen_at ?? '—'}</span>
        <span className={styles.metaKey}>Last seen by KID</span>
        <span className={styles.metaVal}>{row.last_seen_by_kid ?? '—'}</span>
        <span className={styles.metaKey}>Registered</span>
        <span className={styles.metaVal}>{row.registered_at}</span>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Soulprint</h2>
        <div className={styles.empty}>
          Soulprint endpoint в MVP openapi.yaml не выставлен. Будет подключён, когда появится <code className="mono">GET /v1/souls/{'{sid}'}/soulprint</code> (typed_facts по ADR-018).
        </div>
      </section>
    </div>
  );
}
