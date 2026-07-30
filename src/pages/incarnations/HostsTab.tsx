import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, Trash2 } from 'lucide-react';
import { Button } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { JsonViewer } from '../../components/JsonViewer';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { AddHostModal } from './AddHostModal';
import { RemoveHostModal } from './RemoveHostModal';
import { HostUtilizationPanel } from './HostUtilizationPanel';
import { MembersSection } from './MembersSection';
import styles from '../common.module.css';

// Hosts tab for IncarnationDetail.
//
// Data sources:
//   0. incarnation_membership — the ROSTER (MembersSection, NIM-209/NIM-232).
//      The authoritative set a run resolves its targets from, and the only one of
//      the four that is editable as a relation (bind/unbind). It leads the tab
//      for that reason: the sections below it are a declaration and two
//      projections, none of which decide where a scenario actually rolls.
//   1. incarnation.spec.hosts[] — the operator's declared list (ADR-008). Editing
//      via PATCH /v1/incarnations/{name}/hosts (mode=append/remove). Add host —
//      the AddHostModal (select SID from the souls registry + opt. role); Remove —
//      a per-row button. spec arrives as opaque jsonb (Record<string,unknown>),
//      hosts[] is extracted manually (extractDeclaredHosts).
//   2. Connected souls ⋈ utilization — the HostUtilizationPanel owns this unified section:
//      souls with coven=incarnation.name (derived view, ADR-008) left-joined with host vitals.

interface DeclaredHost {
  sid: string;
  role?: string;
  coven?: string;
}

function extractDeclaredHosts(spec: Record<string, unknown> | null | undefined): DeclaredHost[] | null {
  if (!spec || typeof spec !== 'object') return null;
  const raw = (spec as Record<string, unknown>).hosts;
  if (!Array.isArray(raw)) return null;
  const out: DeclaredHost[] = [];
  for (const h of raw) {
    if (h && typeof h === 'object') {
      const obj = h as Record<string, unknown>;
      const sid = typeof obj.sid === 'string' ? obj.sid : null;
      if (!sid) continue;
      out.push({
        sid,
        role: typeof obj.role === 'string' ? obj.role : undefined,
        coven: typeof obj.coven === 'string' ? obj.coven : undefined,
      });
    }
  }
  return out;
}

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
  spec: Record<string, unknown> | null | undefined;
  state: Record<string, unknown> | null | undefined;
  // Incarnation status: editing spec.hosts is blocked while destroying/destroy_failed
  // (backend returns 409). UI hides the buttons preemptively.
  status?: string;
}

export function HostsTab({ incarnationName, spec, state, status }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const declared = extractDeclaredHosts(spec);
  const runtimeHosts = extractRuntimeHosts(state);
  const [addOpen, setAddOpen] = useState(false);
  // sid of the host selected for removal; null -> the confirmation modal is closed.
  const [removeSid, setRemoveSid] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Editing spec.hosts is unavailable during destroy — backend returns 409. Hide the UI preemptively.
  const editingBlocked = status === 'destroying' || status === 'destroy_failed';

  const removeMu = useMutation({
    mutationFn: (sid: string) =>
      keeperApi.incarnations.updateHosts(incarnationName, {
        mode: 'remove',
        hosts: [{ sid }],
      }),
    onSuccess: () => {
      setRemoveError(null);
      setRemoveSid(null);
      qc.invalidateQueries({ queryKey: ['incarnation', incarnationName] });
      qc.invalidateQueries({ queryKey: ['incarnation-souls', incarnationName] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 409) setRemoveError(t('incarnations:removeBlocked409'));
        else if (err.status === 404) setRemoveError(t('incarnations:incarnationNotFound'));
        else setRemoveError(t('errors:generic', { status: err.status, detail: err.message }));
      } else {
        setRemoveError(String(err));
      }
    },
  });

  const declaredSids = declared?.map((h) => h.sid) ?? [];

  return (
    <section className={styles.section}>
      <MembersSection incarnationName={incarnationName} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 16,
        }}
      >
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
          Declared hosts (spec.hosts)
        </h2>
        {editingBlocked ? null : (
          <Button type="button" variant="secondary" onClick={() => setAddOpen(true)}>
            <Plus size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('addHost')}
          </Button>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:declaredHostsDesc')}
      </p>

      {declared === null || declared.length === 0 ? (
        <div className={styles.empty}>
          {t('incarnations:specHostsNotSet')} {t('incarnations:addHostHint')}
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('common:colSid')}</th>
              <th>{t('colRole')}</th>
              <th>{t('common:colCoven')}</th>
              {editingBlocked ? null : <th style={{ width: 1 }} />}
            </tr>
          </thead>
          <tbody>
            {declared.map((h) => (
              <tr key={h.sid}>
                <td className="mono">
                  <KeeperSidCell sid={h.sid} />
                </td>
                <td className="mono">{h.role ?? '—'}</td>
                <td className="mono">{h.coven ?? '—'}</td>
                {editingBlocked ? null : (
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setRemoveError(null);
                        setRemoveSid(h.sid);
                      }}
                      aria-label={`Remove host ${h.sid}`}
                      title={t('pages:removeFromDeclared')}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AddHostModal
        open={addOpen}
        incarnationName={incarnationName}
        existingSids={declaredSids}
        onClose={() => setAddOpen(false)}
      />

      <RemoveHostModal
        sid={removeSid}
        incarnationName={incarnationName}
        pending={removeMu.isPending}
        error={removeError}
        onClose={() => {
          setRemoveSid(null);
          setRemoveError(null);
        }}
        onConfirm={(sid) => removeMu.mutate(sid)}
      />

      <HostUtilizationPanel incarnationName={incarnationName} />

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
