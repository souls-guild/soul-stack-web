import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import styles from '../common.module.css';

// Placeholder. ТЗ упоминает /v1/oracle/fires, но в openapi spec endpoint
// отсутствует — экран остаётся пустым до его появления (ADR-030 / Oracle).
// Эквивалент сейчас — фильтр audit-log по type=decree.fired.
export function OracleFiresList() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Oracle fires</h1>
          <div className={styles.crumbs}>
            История срабатываний Decree-ов (ADR-030)
          </div>
        </div>
      </div>

      <div className={styles.empty}>
        <Zap size={32} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
        <p style={{ margin: '12px 0 8px' }}>
          Endpoint <code className="mono">GET /v1/oracle/fires</code> ещё не выставлен в openapi.
        </p>
        <p style={{ margin: 0, fontSize: 12.5 }}>
          Временно: смотрите <Link to="/audit">Audit Log</Link> с фильтром{' '}
          <code className="mono">type=decree.fired</code>.
        </p>
      </div>
    </div>
  );
}
