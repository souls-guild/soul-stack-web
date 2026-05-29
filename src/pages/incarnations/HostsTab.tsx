import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Plus, Server, Trash2 } from 'lucide-react';
import { Badge, Button, Dot } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import { keeperApi, type SoulListEntry } from '../../api/keeper';
import { soulDot, soulTone } from '../../components/status';
import { ApiError } from '../../api/client';
import { AddHostModal } from './AddHostModal';
import styles from '../common.module.css';

// Hosts-вкладка для IncarnationDetail.
//
// Источники данных:
//   1. incarnation.spec.hosts[] — declared-список оператора (ADR-008). Editing
//      через PATCH /v1/incarnations/{name}/hosts (mode=append/remove). Add host —
//      модалка AddHostModal (select SID из реестра souls + опц. role); Remove —
//      per-row кнопка. spec приходит как opaque jsonb (Record<string,unknown>),
//      hosts[] извлекаем руками (extractDeclaredHosts).
//   2. Connected souls — derived view: souls с coven=incarnation.name (см. ADR-008,
//      incarnation.name — корневая Coven-метка).

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

// Per-host runtime data — convention: scenario может писать per-host state в
// incarnation.state.hosts[<sid>] = {...}. Поле не обязательное; если scenario
// его не использует — секция показывает empty state.
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
  // Статус incarnation: editing spec.hosts заблокировано при destroying/destroy_failed
  // (backend вернёт 409). UI прячет кнопки заранее.
  status?: string;
}

export function HostsTab({ incarnationName, spec, state, status }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const declared = extractDeclaredHosts(spec);
  const runtimeHosts = extractRuntimeHosts(state);
  const [addOpen, setAddOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Editing spec.hosts недоступно при сносе — backend вернёт 409. Прячем UI заранее.
  const editingBlocked = status === 'destroying' || status === 'destroy_failed';

  // Connected souls — фильтруем souls по coven=incarnation.name.
  // Это derived view, не authoritative-список; реальное соответствие проверяется
  // probe-сценарием (ADR-008).
  const connected = useQuery({
    queryKey: ['incarnation-souls', incarnationName],
    queryFn: () => keeperApi.souls.list({ coven: [incarnationName], limit: 200 }),
    enabled: Boolean(incarnationName),
  });

  const removeMu = useMutation({
    mutationFn: (sid: string) =>
      keeperApi.incarnations.updateHosts(incarnationName, {
        mode: 'remove',
        hosts: [{ sid }],
      }),
    onSuccess: () => {
      setRemoveError(null);
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
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

      {removeError ? <div className={styles.errorBox}>{removeError}</div> : null}

      {declared === null || declared.length === 0 ? (
        <div className={styles.empty}>
          {t('incarnations:specHostsNotSet')} {t('incarnations:addHostHint')}
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SID</th>
              <th>Role</th>
              <th>Coven</th>
              {editingBlocked ? null : <th style={{ width: 1 }} />}
            </tr>
          </thead>
          <tbody>
            {declared.map((h) => (
              <tr key={h.sid}>
                <td className="mono">
                  <Link to={`/souls/${encodeURIComponent(h.sid)}`}>{h.sid}</Link>
                </td>
                <td className="mono">{h.role ?? '—'}</td>
                <td className="mono">{h.coven ?? '—'}</td>
                {editingBlocked ? null : (
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeMu.mutate(h.sid)}
                      disabled={removeMu.isPending && removeMu.variables === h.sid}
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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 16,
          gap: 12,
        }}
      >
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
          Connected souls
        </h2>
        <Link
          to={`/run?workload=command&target_coven=${encodeURIComponent(incarnationName)}`}
          aria-label={t('incarnations:runCommandOnHosts')}
        >
          <Button type="button" variant="primary">
            <Play size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('incarnations:runCommandOnHosts')}
          </Button>
        </Link>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Souls <code className="mono">coven = {incarnationName}</code>. {t('incarnations:connectedSoulsDesc')}
      </p>

      {connected.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
      {connected.error ? (
        <div className={styles.errorBox}>
          {t('incarnations:hostsLoadFailed', { detail: String(connected.error) })}
        </div>
      ) : null}
      {connected.data && connected.data.items.length === 0 ? (
        <div className={styles.empty}>
          {t('incarnations:noConnectedSouls', { name: incarnationName })}
        </div>
      ) : null}
      {connected.data && connected.data.items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SID</th>
              <th>Status</th>
              <th>Covens</th>
              <th>Transport</th>
            </tr>
          </thead>
          <tbody>
            {connected.data.items.map((s: SoulListEntry) => (
              <tr key={s.sid}>
                <td className="mono">
                  <Link to={`/souls/${encodeURIComponent(s.sid)}`}>{s.sid}</Link>
                </td>
                <td>
                  <span className={styles.statusCell}>
                    <Dot kind={soulDot(s.status)} />
                    <Badge tone={soulTone(s.status)}>{s.status}</Badge>
                  </span>
                </td>
                <td className="mono">{(s.covens ?? []).join(', ') || '—'}</td>
                <td className="mono">{s.transport ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

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
              <th>SID</th>
              <th>Role</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {runtimeHosts.map((h) => (
              <tr key={h.sid}>
                <td className="mono" style={{ verticalAlign: 'top' }}>
                  <Link to={`/souls/${encodeURIComponent(h.sid)}`}>{h.sid}</Link>
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
