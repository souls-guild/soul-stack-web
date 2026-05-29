import { useTranslation } from 'react-i18next';
import { Activity, Server, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { JsonKeyFilter } from '../../components/JsonKeyFilter';
import { JsonViewer } from '../../components/JsonViewer';
import { Button } from '../../components/primitives';
import styles from '../common.module.css';

interface Props {
  state: Record<string, unknown> | null | undefined;
  stateSchemaVersion: number;
  incarnationName: string;
}

// Скачивание текущего runtime-state как JSON-файла. Blob + objectURL —
// без обращения к серверу (данные уже в памяти у клиента).
function downloadStateJson(name: string, state: Record<string, unknown>, version: number): void {
  const payload = { incarnation: name, state_schema_version: version, state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-state.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Tab «Runtime State» — текущая структурированная конфигурация incarnation
// (что система знает после успешных apply-прогонов). Записывается
// scenario-applier-ом, читается через `register.*` и в `state_changes`.
//
// Если в state.hosts (object keyed by SID) есть per-host записи — отдельная
// секция с таблицей.
export function StateTab({ state, stateSchemaVersion, incarnationName }: Props) {
  const { t } = useTranslation();
  const isEmpty = !state || (typeof state === 'object' && Object.keys(state).length === 0);

  // state.hosts — convention: scenario может писать per-host state в
  // state.hosts[<sid>] = {...} (см. ТЗ от пользователя; не обязательное поле).
  const hostsRaw = state && typeof state === 'object'
    ? (state as Record<string, unknown>).hosts
    : null;
  const perHost: Array<[string, Record<string, unknown>]> = [];
  if (hostsRaw && typeof hostsRaw === 'object' && !Array.isArray(hostsRaw)) {
    for (const [sid, payload] of Object.entries(hostsRaw as Record<string, unknown>)) {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        perHost.push([sid, payload as Record<string, unknown>]);
      }
    }
  }

  // Остаток state без hosts — чтобы не дублировать.
  const stateWithoutHosts = state && typeof state === 'object'
    ? Object.fromEntries(Object.entries(state as Record<string, unknown>).filter(([k]) => k !== 'hosts'))
    : null;
  const restEmpty = !stateWithoutHosts || Object.keys(stateWithoutHosts).length === 0;

  return (
    <section className={styles.section}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 className={styles.sectionTitle}>
          <Activity size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Runtime State
        </h2>
        {!isEmpty && state ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => downloadStateJson(incarnationName, state, stateSchemaVersion)}
            data-testid="state-download-json"
          >
            <Download size={14} /> {t('incarnations:stateDownloadJson')}
          </Button>
        ) : null}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:stateSourceLead')} state_schema_version:{' '}
        <span className="mono">{stateSchemaVersion}</span> {t('incarnations:stateSourceTail')}
      </p>
      {isEmpty ? (
        <div className={styles.empty}>
          {t('incarnations:stateEmpty')}
        </div>
      ) : (
        <>
          {!restEmpty ? (
            <>
              <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 8 }}>
                Top-level fields
              </h3>
              <JsonKeyFilter value={stateWithoutHosts} emptyLabel={t('incarnations:noTopLevelFields')} />
            </>
          ) : null}

          {perHost.length > 0 ? (
            <>
              <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 8 }}>
                <Server size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                Per-host data ({perHost.length})
              </h3>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
                {t('incarnations:perHostDataDesc')}{' '}
                <span className="mono">state.hosts[&lt;sid&gt;]</span>.
              </p>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>SID</th>
                    <th>Role</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {perHost.map(([sid, data]) => {
                    const role = typeof data.role === 'string' ? data.role : null;
                    return (
                      <tr key={sid}>
                        <td className="mono">
                          <Link to={`/souls/${encodeURIComponent(sid)}`}>{sid}</Link>
                        </td>
                        <td className="mono">{role ?? '—'}</td>
                        <td>
                          <JsonViewer value={data} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}

          {restEmpty && perHost.length === 0 ? (
            <div className={styles.empty}>
              {t('incarnations:stateContainsEmpty')}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
