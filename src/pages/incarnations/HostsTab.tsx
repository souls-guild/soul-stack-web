import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { JsonViewer } from '../../components/JsonViewer';
import { MembersPanel } from './MembersPanel';
import styles from '../common.module.css';

// Hosts tab for IncarnationDetail.
//
// Data sources:
//   0. incarnation_membership — the ROSTER, with the hosts' vitals joined in
//      (MembersPanel, NIM-209/NIM-232/NIM-444). The authoritative set a run
//      resolves its targets from, and the only host relation that is editable
//      here (bind/unbind). A declared role is a Voice
//      (incarnation_choir_voices.role, NIM-330) — the Choirs tab owns it.
//      Membership and vitals used to be two stacked tables; they were always the
//      same set of hosts (GET .../telemetry resolves through the same relation,
//      NIM-124), so they are one list now.
//   1. Per-host runtime data — incarnation.state.hosts[<sid>], written by a
//      scenario. A projection: it decides nothing about where a scenario rolls.

// Per-host runtime data — convention: a scenario can write per-host state to
// incarnation.state.hosts[<sid>] = {...}. The field is optional; if the scenario
// doesn't use it, the section shows an empty state.
function extractRuntimeHosts(
  state: Record<string, unknown> | null | undefined,
): Array<{ sid: string; role: string | null; data: Record<string, unknown> }> {
  if (!state || typeof state !== 'object') return [];
  const hosts = (state as Record<string, unknown>).hosts;
  if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) return [];
  const out: Array<{ sid: string; role: string | null; data: Record<string, unknown> }> = [];
  for (const [sid, payload] of Object.entries(hosts as Record<string, unknown>)) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const data = payload as Record<string, unknown>;
      const role = typeof data.role === 'string' ? data.role : null;
      out.push({ sid, role, data });
    }
  }
  return out;
}

interface Props {
  incarnationName: string;
  state: Record<string, unknown> | null | undefined;
}

export function HostsTab({ incarnationName, state }: Props) {
  const { t } = useTranslation();
  const runtimeHosts = extractRuntimeHosts(state);

  return (
    <section className={styles.section}>
      <MembersPanel incarnationName={incarnationName} />

      <h2 className={styles.sectionTitle} style={{ marginTop: 16 }}>
        <Server size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Per-host runtime data
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:perHostRuntimeDesc')}
      </p>
      {runtimeHosts.length === 0 ? (
        <div className={styles.empty}>
          {t('incarnations:noHostsInState')}
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('common:colSid')}</th>
              <th>{t('colRole')}</th>
              <th>{t('colData')}</th>
            </tr>
          </thead>
          <tbody>
            {runtimeHosts.map((h) => (
              <tr key={h.sid}>
                <td className="mono" style={{ verticalAlign: 'top' }}>
                  <KeeperSidCell sid={h.sid} />
                </td>
                <td className="mono" style={{ verticalAlign: 'top' }}>{h.role ?? '—'}</td>
                <td>
                  <JsonViewer value={h.data} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
