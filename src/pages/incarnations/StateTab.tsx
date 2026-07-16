import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity, Server, Download } from 'lucide-react';
import { JsonKeyFilter } from '../../components/JsonKeyFilter';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { JsonViewer } from '../../components/JsonViewer';
import { Button } from '../../components/primitives';
import { keeperApi } from '../../api/keeper';
import { RedisUsersTable } from './RedisUsersTable';
import { normalizeRedisUsers } from './redisUsers.helpers';
import styles from '../common.module.css';

interface Props {
  state: Record<string, unknown> | null | undefined;
  stateSchemaVersion: number;
  incarnationName: string;
}

// Download the current runtime state as a JSON file. Blob + objectURL —
// without hitting the server (data is already in memory on the client).
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

// Tab "Runtime State" — the incarnation's current structured configuration
// (what the system knows after successful apply runs). Written by the
// scenario applier, read via `register.*` and in `state_changes`.
//
// If state.hosts (object keyed by SID) has per-host entries — a separate
// section with a table.
export function StateTab({ state, stateSchemaVersion, incarnationName }: Props) {
  const { t } = useTranslation();
  const isEmpty = !state || (typeof state === 'object' && Object.keys(state).length === 0);

  // state.hosts — convention: a scenario may write per-host state to
  // state.hosts[<sid>] = {...} (per user spec; not a required field).
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

  // NIM-74: state.redis_users — table of ACL users with a reveal eye. Discovery is loaded
  // lazily (only if the key is present in state); on 404/error — graceful, Redis users
  // render via the plain JSON filter below.
  const redisUsersRaw = state && typeof state === 'object'
    ? (state as Record<string, unknown>).redis_users
    : undefined;
  const hasRedisUsers = redisUsersRaw !== undefined && redisUsersRaw !== null;
  const revealable = useQuery({
    queryKey: ['incarnation-secrets-revealable', incarnationName],
    queryFn: () => keeperApi.incarnations.revealableSecrets(incarnationName),
    enabled: Boolean(incarnationName) && hasRedisUsers,
    retry: false,
  });
  const revealableItem = (revealable.data?.items ?? []).find((it) => it.state_path === 'redis_users');
  const showRedisUsersTable = hasRedisUsers && Boolean(revealableItem);
  const redisUsers = showRedisUsersTable ? normalizeRedisUsers(redisUsersRaw) : [];

  // The rest of state without hosts (and without redis_users when moved to the table) — to avoid duplication.
  const hiddenKeys = new Set<string>(['hosts']);
  if (showRedisUsersTable) hiddenKeys.add('redis_users');
  const stateWithoutHosts = state && typeof state === 'object'
    ? Object.fromEntries(Object.entries(state as Record<string, unknown>).filter(([k]) => !hiddenKeys.has(k)))
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

          {showRedisUsersTable && revealableItem ? (
            <RedisUsersTable
              incarnationName={incarnationName}
              secretId={revealableItem.secret_id}
              users={redisUsers}
              revealableKeys={revealableItem.keys ?? []}
            />
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
                          <KeeperSidCell sid={sid} />
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

          {restEmpty && perHost.length === 0 && !showRedisUsersTable ? (
            <div className={styles.empty}>
              {t('incarnations:stateContainsEmpty')}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
