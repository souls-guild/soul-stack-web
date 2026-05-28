import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import styles from '../common.module.css';

interface Props {
  serviceName: string;
  serviceVersion: string;
  stateSchemaVersion: number;
}

// Tab «Schema» — state_schema-метаданные сервиса incarnation: текущая
// state_schema_version, опциональная декларация структуры state (service.yml::
// state_schema:) и список миграций (migrations/<NNN>_to_<MMM>.yml).
//
// Источник — GET /v1/services/{name}/state-schema?ref=<serviceVersion>. Endpoint
// опционален: на 404/501 (старый Keeper или service-loader не нашёл репо) —
// graceful-деградация к инструктивному placeholder-у.

// MVP-подмножество JSON Schema: вытаскиваем плоский список top-level-полей
// (имя + type + required) для table-render. Вложенные object/array показываем
// тип как есть; глубокий рекурсивный рендер не делаем.
interface SchemaField {
  name: string;
  type: string;
  required: boolean;
}

function extractFields(schema: Record<string, unknown> | undefined): SchemaField[] | null {
  if (!schema || typeof schema !== 'object') return null;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  const requiredRaw = (schema as Record<string, unknown>).required;
  const required = new Set(
    Array.isArray(requiredRaw) ? requiredRaw.filter((r): r is string => typeof r === 'string') : [],
  );
  const out: SchemaField[] = [];
  for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
    let type = '—';
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      const t = (def as Record<string, unknown>).type;
      if (typeof t === 'string') type = t;
      else if (Array.isArray(t)) type = t.map(String).join(' | ');
    }
    out.push({ name, type, required: required.has(name) });
  }
  return out;
}

function isDegraded(err: unknown): boolean {
  // 404 (endpoint/service нет), 501 (не реализован), 502 (loader не достал репо) —
  // деградируем к placeholder-у. Прочие ошибки показываем как errorBox.
  return err instanceof ApiError && (err.status === 404 || err.status === 501 || err.status === 502);
}

export function SchemaTab({ serviceName, serviceVersion, stateSchemaVersion }: Props) {
  const q = useQuery({
    queryKey: ['service-state-schema', serviceName, serviceVersion],
    queryFn: () => keeperApi.services.getStateSchema(serviceName, serviceVersion),
    enabled: Boolean(serviceName),
    retry: false,
  });

  const fields = q.data ? extractFields(q.data.schema) : null;
  const migrations = q.data?.migrations ?? [];
  const hardError = q.error && !isDegraded(q.error);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Layers size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        State Schema
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Структура <span className="mono">incarnation.state</span> и история миграций.
      </p>

      <div className={styles.meta}>
        <span className={styles.metaKey}>Service</span>
        <span className={styles.metaVal}>
          <Link to={`/services/${encodeURIComponent(serviceName)}`}>{serviceName}</Link>
        </span>
        <span className={styles.metaKey}>Service version</span>
        <span className={styles.metaVal}>{serviceVersion}</span>
        <span className={styles.metaKey}>state_schema_version</span>
        <span className={styles.metaVal}>{stateSchemaVersion}</span>
      </div>

      {q.isLoading ? <div className={styles.loading}>Загружаем схему…</div> : null}

      {hardError ? (
        <div className={styles.errorBox}>
          Не удалось загрузить state-schema:{' '}
          {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
        </div>
      ) : null}

      {/* Структура state — если backend отдал декларацию. */}
      {q.data && fields && fields.length > 0 ? (
        <>
          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16 }}>
            Структура state (service.yml::state_schema)
          </h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Поле</th>
                <th>Тип</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name}>
                  <td className="mono">{f.name}</td>
                  <td className="mono">{f.type}</td>
                  <td className="mono">{f.required ? 'да' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {q.data && (!fields || fields.length === 0) ? (
        <div className={styles.empty}>
          Структура state не задекларирована в <span className="mono">service.yml</span>{' '}
          (<span className="mono">state_schema:</span> отсутствует). Поля state определяются
          сценариями динамически.
        </div>
      ) : null}

      {/* Миграции — если backend отдал список. */}
      {q.data ? (
        <>
          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16 }}>
            Миграции state
          </h3>
          {migrations.length === 0 ? (
            <div className={styles.empty}>
              Миграций нет — сервис на первой версии структуры state.
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Файл</th>
                </tr>
              </thead>
              <tbody>
                {migrations.map((m) => (
                  <tr key={m.path}>
                    <td className="mono">v{m.from}</td>
                    <td className="mono">v{m.to}</td>
                    <td className="mono">{m.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Грамматику миграции (<span className="mono">rename</span> /{' '}
            <span className="mono">set</span> / <span className="mono">delete</span> /{' '}
            <span className="mono">move</span> + <span className="mono">foreach</span>) смотри в
            файлах репозитория сервиса. Upgrade на новую версию — через action «Upgrade» в шапке
            (forward-only, атомарно одной PG-транзакцией, snapshot в{' '}
            <span className="mono">state_history</span>).
          </p>
        </>
      ) : null}

      {/* Graceful degradation: endpoint недоступен — инструктивный placeholder. */}
      {isDegraded(q.error) ? (
        <div
          style={{
            padding: 'var(--s-4)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            lineHeight: 1.6,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-2)',
            marginTop: 12,
          }}
        >
          <div style={{ color: 'var(--text-muted)' }}>
            Детальная state-schema по этому сервису сейчас недоступна (backend вернул{' '}
            {q.error instanceof ApiError ? q.error.status : '—'}). Структура и миграции:
          </div>
          <div>
            <strong>Структура state:</strong> поле{' '}
            <span className="mono">state_schema_version: {stateSchemaVersion}</span> и
            опциональная декларация <span className="mono">state_schema:</span> в{' '}
            <span className="mono">service.yml</span> сервиса{' '}
            <span className="mono">{serviceName}</span> на ref{' '}
            <span className="mono">{serviceVersion}</span>.
          </div>
          <div>
            <strong>Миграции:</strong> каталог{' '}
            <span className="mono">migrations/&lt;NNN&gt;_to_&lt;MMM&gt;.yml</span> в репозитории
            сервиса.
          </div>
        </div>
      ) : null}
    </section>
  );
}
