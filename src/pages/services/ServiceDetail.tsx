import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Layers } from 'lucide-react';
import { keeperApi, type ServiceScenarioInfo, type ServiceDependency, type ServiceDependenciesReply, type IncarnationListReply, type ServiceStateSchemaReply } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Dot } from '../../components/primitives';
import { incarnationDot, incarnationTone } from '../../components/status';
import { useServiceRefs } from './refs';
import { EditServiceModal } from './EditServiceModal';
import { DeregisterServiceModal } from './DeregisterServiceModal';
import { runnableScenarios } from '../incarnations/reservedScenarios';
import { extractFields, isSchemaDegraded, type SchemaField } from '../incarnations/stateSchema';
import styles from '../common.module.css';

type Tab = 'overview' | 'incarnations' | 'scenarios' | 'refs' | 'schema' | 'dependencies';

export function ServiceDetail() {
  const { t } = useTranslation();
  const { name = '' } = useParams<{ name: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [deregisterOpen, setDeregisterOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['service', name],
    queryFn: () => keeperApi.services.get(name),
    enabled: Boolean(name),
  });

  const incs = useQuery({
    queryKey: ['service.incarnations', name],
    queryFn: () => keeperApi.incarnations.list({ service: name, limit: 200 }),
    enabled: Boolean(name) && tab === 'incarnations',
  });

  const stateSchema = useQuery({
    queryKey: ['service-state-schema-inc', name],
    queryFn: () => keeperApi.services.getStateSchema(name),
    enabled: Boolean(name) && tab === 'incarnations',
    retry: false,
  });

  const scenarios = useQuery({
    queryKey: ['service.scenarios', name],
    queryFn: () => keeperApi.services.listScenarios(name),
    enabled: Boolean(name) && tab === 'scenarios',
    retry: false,
  });

  const refs = useServiceRefs(name, tab === 'refs');

  const deps = useQuery({
    queryKey: ['service.dependencies', name],
    queryFn: () => keeperApi.services.getDependencies(name),
    enabled: Boolean(name) && tab === 'dependencies',
    retry: false,
  });

  if (detail.isLoading) return <div className={styles.loading}>{t('admin:svcLoading')}</div>;
  if (detail.error) {
    return (
      <div className={styles.errorBox}>
        {detail.error instanceof ApiError
          ? t('errors:generic', { status: detail.error.status, detail: detail.error.message })
          : String(detail.error)}
      </div>
    );
  }
  const row = detail.data;
  if (!row) return <div className={styles.empty}>{t('admin:svcNotFound')}</div>;

  const scenarioUnavailable = scenarios.error instanceof ApiError &&
    (scenarios.error.status === 404 || scenarios.error.status === 501 || scenarios.error.status >= 500);

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.crumbs}>
          <Link to="/services">{t('admin:svcDetailCrumbParent')}</Link> / <span>{row.name}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{row.name}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <GitRefInline git={row.git} gitRef={row.ref} />
              {row.refresh ? (
                <Badge tone="info">{t('admin:svcRefreshOn', { interval: row.refresh })}</Badge>
              ) : (
                <Badge tone="muted">{t('admin:svcRefreshOff')}</Badge>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
              {t('edit')}
            </Button>
            <Button type="button" variant="danger" onClick={() => setDeregisterOpen(true)}>
              {t('deregister')}
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        <span className={styles.metaKey}>{t('admin:svcMetaGit')}</span>
        <span className={styles.metaVal}>
          <GitUrl git={row.git} />
        </span>
        <span className={styles.metaKey}>{t('admin:svcMetaRef')}</span>
        <span className={styles.metaVal} data-testid="svc-ref">
          <span className="mono">{row.ref}</span>
        </span>
        <span className={styles.metaKey}>{t('admin:svcMetaRefresh')}</span>
        <span className={styles.metaVal}>
          {row.refresh ? (
            <Badge tone="info">{t('admin:svcRefreshOn', { interval: row.refresh })}</Badge>
          ) : (
            <Badge tone="muted">{t('admin:svcRefreshOff')}</Badge>
          )}
        </span>
        <span className={styles.metaKey}>{t('admin:svcMetaCreated')}</span>
        <span className={styles.metaVal} data-testid="svc-created">
          <span className="mono">{row.created_at}</span>
          {row.created_by_aid ? (
            <span style={{ color: 'var(--text-muted)' }}>
              {' · '}
              <Link
                to={`/archons/${encodeURIComponent(row.created_by_aid)}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {row.created_by_aid}
              </Link>
            </span>
          ) : null}
        </span>
        <span className={styles.metaKey}>{t('admin:svcMetaUpdated')}</span>
        <span className={styles.metaVal} data-testid="svc-updated">
          <span className="mono">{row.updated_at}</span>
          {row.updated_by_aid ? (
            <span style={{ color: 'var(--text-muted)' }}>
              {' · '}
              <Link
                to={`/archons/${encodeURIComponent(row.updated_by_aid)}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                {row.updated_by_aid}
              </Link>
            </span>
          ) : null}
        </span>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
          onClick={() => setTab('overview')}
        >
          {t('admin:svcTabOverview')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'incarnations'}
          className={`${styles.tab} ${tab === 'incarnations' ? styles.tabActive : ''}`}
          onClick={() => setTab('incarnations')}
        >
          {t('admin:svcTabIncarnations')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scenarios'}
          className={`${styles.tab} ${tab === 'scenarios' ? styles.tabActive : ''}`}
          onClick={() => setTab('scenarios')}
        >
          {t('admin:svcTabScenarios')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'refs'}
          className={`${styles.tab} ${tab === 'refs' ? styles.tabActive : ''}`}
          onClick={() => setTab('refs')}
        >
          {t('admin:svcTabRefs')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'schema'}
          className={`${styles.tab} ${tab === 'schema' ? styles.tabActive : ''}`}
          onClick={() => setTab('schema')}
        >
          {t('admin:svcTabSchema')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'dependencies'}
          className={`${styles.tab} ${tab === 'dependencies' ? styles.tabActive : ''}`}
          onClick={() => setTab('dependencies')}
        >
          {t('admin:svcDepsTitle')}
        </button>
      </div>

      {tab === 'overview' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('admin:svcSectionTitle')}</h2>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('admin:svcOverviewProse')} <span className="mono">{row.git}</span> {t('admin:svcOverviewProse2')}
            <span className="mono"> {row.ref}</span> {t('admin:svcOverviewProse3')} <span className="mono">scenario/</span>
            {t('admin:svcOverviewProse4')} <span className="mono">Scenarios</span>{t('admin:svcOverviewProse5')}{' '}
            <span className="mono">Refs</span>.
          </div>
        </section>
      ) : null}

      {tab === 'incarnations' ? (
        <IncarnationsTab
          incs={incs}
          stateSchema={stateSchema}
        />
      ) : null}

      {tab === 'scenarios' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('admin:svcScenariosTitle')}</h2>
          {scenarios.isLoading ? <div className={styles.loading}>{t('admin:svcLoading')}</div> : null}
          {scenarioUnavailable ? (
            <div className={styles.empty}>
              {t('admin:svcScenariosUnavailable')}{' '}
              <code className="mono">GET /v1/services/{row.name}/scenarios</code> {t('admin:svcScenariosUnavailable2')}{' '}
              {(scenarios.error as ApiError).status}{t('admin:svcScenariosUnavailable3')}{' '}
              <Link to="/run?workload=scenario">Run Wizard</Link>.
            </div>
          ) : null}
          {scenarios.error && !scenarioUnavailable ? (
            <div className={styles.errorBox}>
              {scenarios.error instanceof ApiError
                ? t('errors:generic', { status: scenarios.error.status, detail: scenarios.error.message })
                : String(scenarios.error)}
            </div>
          ) : null}
          {scenarios.data && (scenarios.data.scenarios?.length ?? 0) === 0 ? (
            <div className={styles.empty}>{t('admin:svcScenariosEmpty')}</div>
          ) : null}
          {scenarios.data && (scenarios.data.scenarios?.length ?? 0) > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('admin:svcScenColName')}</th>
                  <th>{t('admin:svcScenColDescription')}</th>
                  <th>{t('admin:svcScenColInputFields')}</th>
                  <th>{t('admin:svcScenColActions')}</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.data.scenarios.map((s) => (
                  <tr key={s.name}>
                    <td className="mono">{s.name}</td>
                    <td>{s.description ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {scenarioInputSummary(s)}
                    </td>
                    <td style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {!runnableScenarios([s]).length ? (
                        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                          {t('admin:svcReservedScenario')}
                        </span>
                      ) : (
                        <Link
                          to={`/run?workload=scenario&service=${encodeURIComponent(row.name)}&scenario=${encodeURIComponent(s.name)}`}
                          aria-label={`${t('runScenario')} ${s.name}`}
                        >
                          <Button type="button" variant="primary">{t('admin:svcRunThisScenario')}</Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {tab === 'refs' ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('admin:svcRefsTitle')}</h2>
          {refs.loading ? <div className={styles.loading}>{t('admin:svcLoading')}</div> : null}
          {refs.unavailable ? (
            <div className={styles.empty}>
              {t('admin:svcRefsUnavailable')}{' '}
              <code className="mono">GET /v1/services/{row.name}/refs</code> {t('admin:svcRefsUnavailable2')}{' '}
              <span className="mono">{row.ref}</span> {t('admin:svcRefsUnavailable3')}
            </div>
          ) : null}
          {refs.error ? <div className={styles.errorBox}>{refs.error}</div> : null}
          {!refs.loading && !refs.unavailable && !refs.error ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('admin:svcRefsColName')}</th>
                  <th>{t('admin:svcRefsColType')}</th>
                  <th>{t('admin:svcRefsColCommit')}</th>
                  <th>{t('admin:svcRefsColDefault')}</th>
                </tr>
              </thead>
              <tbody>
                {refs.tags.map((r) => (
                  <tr key={`tag/${r.name}`}>
                    <td className="mono">{r.name}</td>
                    <td>
                      <Badge tone="info">tag</Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.commit ?? '—'}
                    </td>
                    <td>{r.is_default ? <Badge tone="ok">default</Badge> : '—'}</td>
                  </tr>
                ))}
                {refs.branches.map((r) => (
                  <tr key={`branch/${r.name}`}>
                    <td className="mono">{r.name}</td>
                    <td>
                      <Badge tone="muted">branch</Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.commit ?? '—'}
                    </td>
                    <td>{r.is_default ? <Badge tone="ok">default</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {!refs.loading && !refs.unavailable && refs.tags.length === 0 && refs.branches.length === 0 ? (
            <div className={styles.empty}>{t('admin:svcRefsEmpty')}</div>
          ) : null}
        </section>
      ) : null}

      {tab === 'schema' ? <ServiceSchemaTab name={row.name} serviceRef={row.ref} /> : null}

      {tab === 'dependencies' ? (
        <ServiceDepsTab deps={deps} />
      ) : null}

      {editOpen ? (
        <EditServiceModal open={editOpen} service={row} onClose={() => setEditOpen(false)} />
      ) : null}
      {deregisterOpen ? (
        <DeregisterServiceModal open={deregisterOpen} service={row} onClose={() => setDeregisterOpen(false)} />
      ) : null}
    </div>
  );
}

// Clickable web URL of the git repo — only for http(s) sources. git:// / ssh /
// file:// cannot be opened as a link by the browser -> return null (renders as mono text).
// The `.git` suffix is stripped for a clean repo-href (most hosts redirect anyway).
function gitWebUrl(git: string | undefined): string | null {
  if (!git) return null;
  if (!/^https?:\/\//i.test(git)) return null;
  return git.replace(/\.git$/i, '');
}

// Header form git@ref. git is clickable if http(s).
function GitRefInline({ git, gitRef }: { git: string; gitRef: string }) {
  const href = gitWebUrl(git);
  return (
    <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" data-testid="svc-git-link">
          {git}
          <ExternalLink size={11} style={{ verticalAlign: '-1px', marginLeft: 3 }} />
        </a>
      ) : (
        git
      )}
      @{gitRef}
    </span>
  );
}

function GitUrl({ git }: { git: string }) {
  const href = gitWebUrl(git);
  if (!href) return <span className="mono">{git}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="mono" data-testid="svc-git-link-meta">
      {git}
      <ExternalLink size={11} style={{ verticalAlign: '-1px', marginLeft: 4 }} />
    </a>
  );
}

// Returns scalar fields (string/integer) from the SchemaField list — go into columns.
// Composite fields (object/array) — a separate group for compact display.
function partitionFields(fields: SchemaField[]): {
  scalar: SchemaField[];
  composite: SchemaField[];
} {
  const scalar: SchemaField[] = [];
  const composite: SchemaField[] = [];
  for (const f of fields) {
    if (f.type === 'string' || f.type === 'integer' || f.type === 'number' || f.type === 'boolean') {
      scalar.push(f);
    } else {
      composite.push(f);
    }
  }
  return { scalar, composite };
}

// Formats a composite field value for compact display in a cell.
function compositeCell(val: unknown): string {
  if (val === undefined || val === null) return '—';
  if (Array.isArray(val)) return val.length === 0 ? '—' : `${val.length} items`;
  if (typeof val === 'object') {
    const keys = Object.keys(val as object).length;
    return keys === 0 ? '—' : `{${keys} keys}`;
  }
  return String(val);
}

// Formats a scalar value; null/undefined -> "-".
function scalarCell(val: unknown): string {
  if (val === undefined || val === null) return '—';
  return String(val);
}

// MAX_SCALAR_COLS — how many state columns before horizontal scroll kicks in.
const MAX_SCALAR_COLS = 6;

type IncarnationsTabProps = {
  incs: ReturnType<typeof useQuery<IncarnationListReply>>;
  stateSchema: ReturnType<typeof useQuery<ServiceStateSchemaReply>>;
};

function IncarnationsTab({ incs, stateSchema }: IncarnationsTabProps) {
  const { t } = useTranslation();

  // Compute columns from state_schema (graceful: if schema unavailable — only base columns).
  const allFields = stateSchema.data
    ? extractFields(stateSchema.data.schema as Record<string, unknown> | undefined)
    : null;
  const { scalar: scalarFields, composite: compositeFields } = allFields
    ? partitionFields(allFields)
    : { scalar: [], composite: [] };

  // Show horizontal scroll when there are more than MAX_SCALAR_COLS scalar columns.
  const needsScroll = scalarFields.length > MAX_SCALAR_COLS;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('admin:svcIncTitle')}</h2>
      {(incs.isLoading || stateSchema.isLoading) ? (
        <div className={styles.loading}>{t('admin:svcLoading')}</div>
      ) : null}
      {incs.error ? (
        <div className={styles.errorBox}>
          {incs.error instanceof ApiError
            ? t('errors:generic', { status: incs.error.status, detail: incs.error.message })
            : String(incs.error)}
        </div>
      ) : null}
      {incs.data && (incs.data.items ?? []).length === 0 ? (
        <div className={styles.empty}>
          {t('admin:svcIncEmpty')}{' '}
          <code className="mono">create</code>.
        </div>
      ) : null}
      {incs.data && (incs.data.items ?? []).length > 0 ? (
        <div style={needsScroll ? { overflowX: 'auto' } : undefined}>
          <table className={styles.table} data-testid="svc-inc-table">
            <thead>
              <tr>
                <th>{t('admin:svcIncColName')}</th>
                <th>{t('admin:svcIncColRef')}</th>
                <th>{t('admin:svcIncColStatus')}</th>
                <th>{t('admin:svcIncColCovens')}</th>
                {scalarFields.map((f) => (
                  <th key={f.name} className="mono">{f.name}</th>
                ))}
                {compositeFields.length > 0 ? (
                  <th>{t('admin:svcIncColState')}</th>
                ) : null}
                <th>{t('admin:svcIncColUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {(incs.data.items ?? []).map((inc) => (
                <tr key={inc.name}>
                  <td>
                    <Link to={`/incarnations/${encodeURIComponent(inc.name)}`}>{inc.name}</Link>
                  </td>
                  <td className="mono">{inc.service_version}</td>
                  <td>
                    <span className={styles.statusCell}>
                      <Dot kind={incarnationDot(inc.status)} title={inc.status} />
                      <Badge tone={incarnationTone(inc.status)}>{inc.status}</Badge>
                    </span>
                  </td>
                  <td className="mono">{(inc.covens ?? []).join(', ') || '—'}</td>
                  {scalarFields.map((f) => (
                    <td key={f.name} className="mono">
                      {scalarCell((inc.state as Record<string, unknown> | undefined)?.[f.name])}
                    </td>
                  ))}
                  {compositeFields.length > 0 ? (
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {compositeFields.map((f) => (
                        <span key={f.name} style={{ display: 'block' }}>
                          {f.name}: {compositeCell((inc.state as Record<string, unknown> | undefined)?.[f.name])}
                        </span>
                      ))}
                    </td>
                  ) : null}
                  <td className="mono">{inc.updated_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// Schema tab for the service (not incarnation) — state_schema metadata on the
// service ref: state_schema_version + optional state structure declaration + migration list.
// Reuses extractFields/isSchemaDegraded from incarnations/SchemaTab.
// Source — GET /v1/services/{name}/state-schema?ref=<service.ref>; graceful on 404/501/502.
function ServiceSchemaTab({ name, serviceRef }: { name: string; serviceRef: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['service-state-schema', name, serviceRef],
    queryFn: () => keeperApi.services.getStateSchema(name, serviceRef),
    enabled: Boolean(name),
    retry: false,
  });

  const fields = q.data ? extractFields(q.data.schema as Record<string, unknown> | undefined) : null;
  const migrations = q.data?.migrations ?? [];
  const hardError = q.error && !isSchemaDegraded(q.error);

  return (
    <section className={styles.section} data-testid="svc-schema-section">
      <h2 className={styles.sectionTitle}>
        <Layers size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        {t('admin:svcSchemaTitle')}
      </h2>

      {q.isLoading ? <div className={styles.loading}>{t('admin:svcLoading')}</div> : null}

      {q.data ? (
        <div className={styles.meta}>
          <span className={styles.metaKey}>Ref</span>
          <span className={styles.metaVal}>
            <span className="mono">{q.data.ref ?? serviceRef}</span>
          </span>
          <span className={styles.metaKey}>state_schema_version</span>
          <span className={styles.metaVal}>
            <span className="mono">{q.data.state_schema_version ?? '—'}</span>
          </span>
        </div>
      ) : null}

      {hardError ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError
            ? t('errors:generic', { status: q.error.status, detail: q.error.message })
            : String(q.error)}
        </div>
      ) : null}

      {q.data && fields && fields.length > 0 ? (
        <>
          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16 }}>
            {t('admin:svcSchemaStructTitle')}
          </h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('admin:svcSchemaColField')}</th>
                <th>{t('admin:svcSchemaColType')}</th>
                <th>{t('admin:svcSchemaColRequired')}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name}>
                  <td className="mono">{f.name}</td>
                  <td className="mono">{f.type}</td>
                  <td className="mono">{f.required ? t('admin:svcYesShort') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {q.data && (!fields || fields.length === 0) ? (
        <div className={styles.empty}>{t('admin:svcSchemaNotDeclared')}</div>
      ) : null}

      {q.data ? (
        <>
          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16 }}>
            {t('admin:svcSchemaMigrationsTitle')}
          </h3>
          {migrations.length === 0 ? (
            <div className={styles.empty}>{t('admin:svcSchemaMigrationsEmpty')}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('admin:svcSchemaMigColFrom')}</th>
                  <th>{t('admin:svcSchemaMigColTo')}</th>
                  <th>{t('admin:svcSchemaMigColFile')}</th>
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
        </>
      ) : null}

      {isSchemaDegraded(q.error) ? (
        <div className={styles.empty} data-testid="svc-schema-degraded">
          {t('admin:svcSchemaUnavailable', {
            status: q.error instanceof ApiError ? q.error.status : '—',
          })}
        </div>
      ) : null}
    </section>
  );
}

function DepTable({ items, emptyKey }: { items: ServiceDependency[]; emptyKey: string }) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return <div className={styles.empty}>{t(emptyKey)}</div>;
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('admin:svcDepsColName')}</th>
          <th>{t('admin:svcDepsColRef')}</th>
          <th>{t('admin:svcDepsColGit')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((dep) => (
          <tr key={dep.name}>
            <td className="mono">{dep.name}</td>
            <td className="mono">{dep.ref}</td>
            <td className="mono">{dep.git ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ServiceDepsTab({
  deps,
}: {
  deps: ReturnType<typeof useQuery<ServiceDependenciesReply>>;
}) {
  const { t } = useTranslation();
  const depsUnavailable =
    deps.error instanceof ApiError &&
    (deps.error.status === 404 || deps.error.status === 501 || deps.error.status >= 500);

  return (
    <section className={styles.section} data-testid="svc-deps-section">
      <h2 className={styles.sectionTitle}>{t('admin:svcDepsTitle')}</h2>

      {deps.isLoading ? <div className={styles.loading}>{t('admin:svcLoading')}</div> : null}

      {depsUnavailable ? (
        <div className={styles.empty}>
          {t('admin:svcDepsUnavailable', {
            status: deps.error instanceof ApiError ? deps.error.status : '—',
          })}
        </div>
      ) : null}

      {deps.error && !depsUnavailable ? (
        <div className={styles.errorBox}>
          {deps.error instanceof ApiError
            ? t('errors:generic', { status: deps.error.status, detail: deps.error.message })
            : String(deps.error)}
        </div>
      ) : null}

      {deps.data ? (
        <>
          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 0 }}>
            {t('admin:svcDepsDestinySection')}
          </h3>
          <DepTable
            items={deps.data.destiny ?? []}
            emptyKey="admin:svcDepsDestinyEmpty"
          />

          <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16 }}>
            {t('admin:svcDepsModulesSection')}
          </h3>
          <DepTable
            items={deps.data.modules ?? []}
            emptyKey="admin:svcDepsModulesEmpty"
          />
        </>
      ) : null}
    </section>
  );
}

function scenarioInputSummary(s: ServiceScenarioInfo): string {
  // input_schema — flat-map field->property; field names = map keys.
  const schema = s.input_schema;
  if (!schema || typeof schema !== 'object') return '—';
  const names = Object.keys(schema);
  if (names.length === 0) return '—';
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')}, +${names.length - 4}`;
}
