import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { Badge, Dot } from '../../components/primitives';
import { JsonViewer } from '../../components/JsonViewer';
import { keeperApi, type SoulListEntry } from '../../api/keeper';
import { soulDot, soulTone } from '../../components/status';
import styles from '../common.module.css';

// Hosts-вкладка для IncarnationDetail.
//
// Источники данных:
//   1. incarnation.spec.hosts[] — declared-список оператора (ADR-008). Сейчас:
//      - GET /v1/incarnations/{name} возвращает spec как opaque jsonb (Record<string,unknown>);
//      - POST /v1/incarnations НЕ принимает spec.hosts (только name/service/covens/input);
//      - PATCH/PUT endpoint-а для spec нет.
//      Поэтому вкладка отображает spec.hosts[] read-only, если оператор как-то его
//      туда положил (например, через service-уровневый scenario create input).
//   2. Connected souls — derived view: souls с coven=incarnation.name (см. ADR-008,
//      incarnation.name — корневая Coven-метка).
//
// BACKLOG: spec.hosts editing требует backend endpoint вида
//   PUT /v1/incarnations/{name}/hosts  (или PATCH /v1/incarnations/{name} с body.spec.hosts).
// До появления этого endpoint-а Add/Remove Host UI не реализован — кнопки сейчас
// бы вели в никуда.

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
}

export function HostsTab({ incarnationName, spec, state }: Props) {
  const declared = extractDeclaredHosts(spec);
  const runtimeHosts = extractRuntimeHosts(state);

  // Connected souls — фильтруем souls по coven=incarnation.name.
  // Это derived view, не authoritative-список; реальное соответствие проверяется
  // probe-сценарием (ADR-008).
  const connected = useQuery({
    queryKey: ['incarnation-souls', incarnationName],
    queryFn: () => keeperApi.souls.list({ coven: [incarnationName], limit: 200 }),
    enabled: Boolean(incarnationName),
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Declared hosts (spec.hosts)</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Декларированный список хостов из <code className="mono">incarnation.spec.hosts[]</code>.
        Read-only: API сейчас не предоставляет endpoint для редактирования
        <code className="mono"> spec.hosts</code> после создания incarnation.
      </p>

      {declared === null || declared.length === 0 ? (
        <div className={styles.empty}>
          <code className="mono">spec.hosts</code> не задан. Volatile-роль определяется
          probe-шагом в сценарии (<code className="mono">core.exec.run</code> + <code className="mono">register:</code>{' '}
          + <code className="mono">where:</code>).
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SID</th>
              <th>Role</th>
              <th>Coven</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className={styles.sectionTitle} style={{ marginTop: 16 }}>
        Connected souls
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Souls с <code className="mono">coven = {incarnationName}</code>. Соответствие с
        реальностью (declared ↔ connected) можно проверить через probe-scenario; это
        derived view, не authoritative.
      </p>

      {connected.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
      {connected.error ? (
        <div className={styles.errorBox}>
          Не удалось загрузить souls: {String(connected.error)}
        </div>
      ) : null}
      {connected.data && connected.data.items.length === 0 ? (
        <div className={styles.empty}>
          На coven <code className="mono">{incarnationName}</code> нет привязанных souls.
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
        Per-host подсекция <code className="mono">incarnation.state.hosts[&lt;sid&gt;]</code> —
        convention: scenario записывает per-host state в эту секцию (role, pid, users
        и т.д.). Если scenario не использует convention — секция будет пустой.
      </p>
      {runtimeHosts.length === 0 ? (
        <div className={styles.empty}>
          В <code className="mono">state.hosts</code> нет данных — либо не было apply,
          либо scenario не пишет per-host state.
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
