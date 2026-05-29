import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Dot, Modal } from '../../components/primitives';
import { incarnationDot, incarnationTone } from '../../components/status';
import { useServiceRefs } from './refs';
import { EditServiceModal } from './EditServiceModal';
import { DeregisterServiceModal } from './DeregisterServiceModal';
import type { ServiceScenarioInfo } from '../../api/keeper';
import { isReservedScenario } from '../incarnations/reservedScenarios';
import styles from '../common.module.css';

type Tab = 'overview' | 'incarnations' | 'scenarios' | 'refs';

export function ServiceDetail() {
  const { t } = useTranslation();
  const { name = '' } = useParams<{ name: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [yamlScenario, setYamlScenario] = useState<ServiceScenarioInfo | null>(null);
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

  const scenarios = useQuery({
    queryKey: ['service.scenarios', name],
    queryFn: () => keeperApi.services.listScenarios(name),
    enabled: Boolean(name) && tab === 'scenarios',
    retry: false,
  });

  const refs = useServiceRefs(name, tab === 'refs');

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
          <Link to="/services">services</Link> / <span>{row.name}</span>
        </div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{row.name}</h1>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {row.git}@{row.ref}
              </span>
              {row.refresh ? <Badge tone="info">refresh: {row.refresh}</Badge> : null}
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
        <span className={styles.metaKey}>Git</span>
        <span className={styles.metaVal}>{row.git}</span>
        <span className={styles.metaKey}>Ref</span>
        <span className={styles.metaVal}>{row.ref}</span>
        <span className={styles.metaKey}>Refresh</span>
        <span className={styles.metaVal}>{row.refresh ?? '—'}</span>
        <span className={styles.metaKey}>Created by</span>
        <span className={styles.metaVal}>{row.created_by_aid ?? '—'}</span>
        <span className={styles.metaKey}>Created at</span>
        <span className={styles.metaVal}>{row.created_at}</span>
        <span className={styles.metaKey}>Updated by</span>
        <span className={styles.metaVal}>{row.updated_by_aid ?? '—'}</span>
        <span className={styles.metaKey}>Updated at</span>
        <span className={styles.metaVal}>{row.updated_at}</span>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'incarnations'}
          className={`${styles.tab} ${tab === 'incarnations' ? styles.tabActive : ''}`}
          onClick={() => setTab('incarnations')}
        >
          Incarnations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scenarios'}
          className={`${styles.tab} ${tab === 'scenarios' ? styles.tabActive : ''}`}
          onClick={() => setTab('scenarios')}
        >
          Scenarios
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'refs'}
          className={`${styles.tab} ${tab === 'refs' ? styles.tabActive : ''}`}
          onClick={() => setTab('refs')}
        >
          Refs
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
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('admin:svcIncTitle')}</h2>
          {incs.isLoading ? <div className={styles.loading}>{t('admin:svcLoading')}</div> : null}
          {incs.error ? (
            <div className={styles.errorBox}>
              {incs.error instanceof ApiError
                ? t('errors:generic', { status: incs.error.status, detail: incs.error.message })
                : String(incs.error)}
            </div>
          ) : null}
          {incs.data && incs.data.items.length === 0 ? (
            <div className={styles.empty}>
              {t('admin:svcIncEmpty')}{' '}
              <code className="mono">create</code>.
            </div>
          ) : null}
          {incs.data && incs.data.items.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Service ref</th>
                  <th>Status</th>
                  <th>Covens</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {incs.data.items.map((inc) => (
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
                    <td className="mono">{inc.covens.join(', ') || '—'}</td>
                    <td className="mono">{inc.updated_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
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
                  <th>Name</th>
                  <th>Description</th>
                  <th>Input fields</th>
                  <th>Actions</th>
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
                      {isReservedScenario(s.name) ? (
                        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                          {t('admin:svcReservedScenario')}
                        </span>
                      ) : (
                        <>
                          <Link
                            to={`/run?workload=scenario&service=${encodeURIComponent(row.name)}&scenario=${encodeURIComponent(s.name)}`}
                            aria-label={`${t('runScenario')} ${s.name}`}
                          >
                            <Button type="button" variant="primary">{t('admin:svcRunThisScenario')}</Button>
                          </Link>
                          <Link
                            to={`/incarnations/new?service=${encodeURIComponent(row.name)}`}
                          >
                            <Button type="button" variant="secondary">{t('admin:svcUseInIncarnation')}</Button>
                          </Link>
                        </>
                      )}
                      <Button type="button" variant="ghost" onClick={() => setYamlScenario(s)}>
                        {t('admin:svcView')}
                      </Button>
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
                  <th>Name</th>
                  <th>Type</th>
                  <th>Commit</th>
                  <th>Default</th>
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

      {yamlScenario ? (
        <Modal
          open={true}
          title={`scenario: ${yamlScenario.name}`}
          onClose={() => setYamlScenario(null)}
          wide
        >
          {yamlScenario.description ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
              {yamlScenario.description}
            </p>
          ) : null}
          {yamlScenario.input_schema ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
                input_schema
              </div>
              <pre
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 12,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  overflow: 'auto',
                  maxHeight: 480,
                }}
              >
                {JSON.stringify(yamlScenario.input_schema, null, 2)}
              </pre>
            </>
          ) : (
            <div className={styles.empty}>{t('admin:svcScenarioNoInputSchema')}</div>
          )}
        </Modal>
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

function scenarioInputSummary(s: ServiceScenarioInfo): string {
  // input_schema — flat-map field→property; имена полей = ключи map.
  const schema = s.input_schema;
  if (!schema || typeof schema !== 'object') return '—';
  const names = Object.keys(schema);
  if (names.length === 0) return '—';
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')}, +${names.length - 4}`;
}
