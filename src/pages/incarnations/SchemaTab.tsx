import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { extractFields, isSchemaDegraded } from './stateSchema';
import styles from '../common.module.css';

interface Props {
  serviceName: string;
  serviceVersion: string;
  stateSchemaVersion: number;
}

// Tab "Schema" — state_schema metadata for the incarnation's service: current
// state_schema_version, an optional declaration of the state structure (service.yml::
// state_schema:), and a list of migrations (migrations/<NNN>_to_<MMM>.yml).
//
// Source — GET /v1/services/{name}/state-schema?ref=<serviceVersion>. The endpoint
// is optional: on 404/501 (old Keeper or service-loader didn't find the repo) —
// graceful degradation to an instructive placeholder.

export function SchemaTab({ serviceName, serviceVersion, stateSchemaVersion }: Props) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['service-state-schema', serviceName, serviceVersion],
    queryFn: () => keeperApi.services.getStateSchema(serviceName, serviceVersion),
    enabled: Boolean(serviceName),
    retry: false,
  });

  const fields = q.data ? extractFields(q.data.schema) : null;
  const migrations = q.data?.migrations ?? [];
  const hardError = q.error && !isSchemaDegraded(q.error);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Layers size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        State Schema
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:schemaCrumbsHint')}
      </p>

      <div className={styles.meta}>
        <span className={styles.metaKey}>{t('incarnations:colService')}</span>
        <span className={styles.metaVal}>
          <Link to={`/services/${encodeURIComponent(serviceName)}`}>{serviceName}</Link>
        </span>
        <span className={styles.metaKey}>{t('common:colServiceVersion')}</span>
        <span className={styles.metaVal}>{serviceVersion}</span>
        <span className={styles.metaKey}>state_schema_version</span>
        <span className={styles.metaVal}>{stateSchemaVersion}</span>
      </div>

      {q.isLoading ? <div className={styles.loading}>{t('incarnations:loadSchema')}</div> : null}

      {hardError ? (
        <div className={styles.errorBox}>
          {t('incarnations:schemaLoadFailed')}{' '}
          {q.error instanceof ApiError ? t('errors:generic', { status: q.error.status, detail: q.error.message }) : String(q.error)}
        </div>
      ) : null}

      {/* State structure — if the backend returned a declaration. */}
      {q.data && fields && fields.length > 0 ? (
        <>
          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16 }}>
            {t('incarnations:schemaStructTitle')}
          </h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('incarnations:colField')}</th>
                <th>{t('incarnations:colType')}</th>
                <th>{t('colRequired')}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name}>
                  <td className="mono">{f.name}</td>
                  <td className="mono">{f.type}</td>
                  <td className="mono">{f.required ? t('incarnations:yesShort') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {q.data && (!fields || fields.length === 0) ? (
        <div className={styles.empty}>
          {t('incarnations:schemaNotDeclared')}
        </div>
      ) : null}

      {/* Migrations — if the backend returned a list. */}
      {q.data ? (
        <>
          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16 }}>
            {t('incarnations:schemaMigrationsTitle')}
          </h3>
          {migrations.length === 0 ? (
            <div className={styles.empty}>
              {t('incarnations:migrationsEmpty')}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('colFrom')}</th>
                  <th>{t('colTo')}</th>
                  <th>{t('incarnations:colFile')}</th>
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
            {t('incarnations:migrationGrammarHint')}
          </p>
        </>
      ) : null}

      {/* Graceful degradation: endpoint unavailable — instructive placeholder. */}
      {isSchemaDegraded(q.error) ? (
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
            {t('incarnations:schemaDegradedLead', { status: q.error instanceof ApiError ? q.error.status : '—' })}
          </div>
          <div>
            <strong>{t('incarnations:schemaDegradedStruct')}</strong>{' '}
            {t('incarnations:schemaDegradedStructHint', {
              version: stateSchemaVersion,
              service: serviceName,
              ref: serviceVersion,
            })}
          </div>
          <div>
            <strong>{t('incarnations:schemaDegradedMigrations')}</strong>{' '}
            {t('incarnations:schemaDegradedMigrationsHint')}
          </div>
        </div>
      ) : null}
    </section>
  );
}
