import styles from '../common.module.css';

// AuditLog — placeholder для будущего GET /v1/audit.
//
// На момент iteration 2 endpoint не выставлен в OpenAPI (`/v1/audit` отсутствует
// в keeper.yaml). UI рендерит заглушку с описанием планируемой формы, чтобы
// слот в Sidebar/Routes уже жил и был виден оператору.
// При появлении endpoint-а здесь будет: фильтры (event_type, archon_aid, sid,
// started_after/before), pagination, раскрывающиеся карточки payload через
// JsonViewer, color-coding по source.
export function AuditLog() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Audit</h1>
          <div className={styles.crumbs}>трейл операторских действий</div>
        </div>
      </div>

      <div className={styles.empty}>
        <p style={{ margin: 0, marginBottom: 12, fontSize: 14 }}>
          Audit-endpoint <code className="mono">GET /v1/audit</code> ещё не выставлен в OpenAPI.
        </p>
        <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 12.5 }}>
          TODO: ждём core-repo. Планируемые фильтры: event_type · archon_aid · sid ·
          incarnation_name · started_after/before. Каждый event — раскрывающаяся карточка
          с JSON-payload и color-coding по source (api / mcp / soul_grpc / keeper_internal / reaper_lease).
        </p>
      </div>
    </div>
  );
}
