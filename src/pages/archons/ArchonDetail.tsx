import { Link, useParams } from 'react-router-dom';
import styles from '../common.module.css';

// ArchonDetail — placeholder, пока нет GET /v1/operators/{aid} в OpenAPI.
// При появлении endpoint-а: профиль (display_name / auth_method / created_at /
// created_by_aid / revoked_at) + permissions + ссылка на audit с фильтром archon_aid.
export function ArchonDetail() {
  const { aid } = useParams<{ aid: string }>();
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.crumbs}>
            <Link to="/archons">archons</Link> / <span className="mono">{aid}</span>
          </div>
          <h1 className={styles.title}>{aid}</h1>
        </div>
      </div>
      <div className={styles.empty}>
        Endpoint <code className="mono">GET /v1/operators/{'{aid}'}</code> ещё не выставлен.
        Профиль появится после core-repo update.
      </div>
    </div>
  );
}
