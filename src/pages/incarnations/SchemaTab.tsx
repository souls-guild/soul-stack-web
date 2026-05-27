import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from '../common.module.css';

interface Props {
  serviceName: string;
  serviceVersion: string;
  stateSchemaVersion: number;
}

// Tab «Schema» — info-карточка про state_schema_version и где лежит сама схема.
// API endpoint GET /v1/services/{name}/state-schema?version=N пока не зафиксирован
// (нет в keeper.yaml); показываем инструкцию где искать.
export function SchemaTab({ serviceName, serviceVersion, stateSchemaVersion }: Props) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Layers size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        State Schema
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Информация о структуре <span className="mono">incarnation.state</span> и о
        миграциях (ADR-019).
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
        }}
      >
        <div>
          <strong>Где определяется структура state:</strong>
          <br />
          В файле <span className="mono">service.yml</span> сервиса{' '}
          <span className="mono">{serviceName}</span> на ref{' '}
          <span className="mono">{serviceVersion}</span> — поле{' '}
          <span className="mono">state_schema_version: {stateSchemaVersion}</span>.
        </div>
        <div>
          <strong>Миграции state:</strong>
          <br />
          Каталог <span className="mono">migrations/&lt;NNN&gt;_to_&lt;MMM&gt;.yml</span> в
          репозитории сервиса. DSL: плоский <span className="mono">rename</span> /
          <span className="mono"> set</span> / <span className="mono">delete</span> /
          <span className="mono"> move</span> + CEL-выражения в{' '}
          <span className="mono">set.value</span> через <span className="mono">${'{ … }'}</span>{' '}
          + структурный <span className="mono">foreach</span>. Forward-only.
        </div>
        <div>
          <strong>Upgrade на новую state_schema_version:</strong>
          <br />
          Через action «Upgrade» в шапке (вызывает{' '}
          <span className="mono">POST /v1/incarnations/{'{name}'}/upgrade</span>). Миграция
          применяется атомарно одной PG-транзакцией, snapshot per-step пишется в{' '}
          <span className="mono">state_history</span>.
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          Просмотр содержимого <span className="mono">service.yml</span> и каталога миграций
          через UI пока не реализован — открой репозиторий сервиса напрямую.
        </div>
      </div>
    </section>
  );
}
