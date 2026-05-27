import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keeperApi, type RoleView } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import styles from '../common.module.css';

type Tab = 'roles' | 'permissions' | 'members';

function RolesTab({ roles }: { roles: RoleView[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Builtin</th>
          <th>Description</th>
          <th>Permissions</th>
          <th>Operators</th>
        </tr>
      </thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.name}>
            <td className="mono">{r.name}</td>
            <td>{r.builtin ? <Badge tone="info">builtin</Badge> : '—'}</td>
            <td>{r.description ?? '—'}</td>
            <td className="mono">{r.permissions.length}</td>
            <td className="mono">{r.operators.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PermissionsTab({ roles }: { roles: RoleView[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
      {roles.map((r) => (
        <section key={r.name} className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span className="mono">{r.name}</span>
            {r.builtin ? (
              <span style={{ marginLeft: 8 }}>
                <Badge tone="info">builtin</Badge>
              </span>
            ) : null}
          </h2>
          {r.description ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{r.description}</div>
          ) : null}
          {r.permissions.length === 0 ? (
            <div className={styles.empty}>permission-ов нет.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {r.permissions.map((p) => (
                <code
                  key={p}
                  style={{
                    padding: '2px 8px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 12,
                  }}
                >
                  {p}
                </code>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function MembersTab({ roles }: { roles: RoleView[] }) {
  // Перестраиваем «роль → операторы» в «оператор → роли».
  const byOperator = useMemo(() => {
    const acc = new Map<string, string[]>();
    for (const r of roles) {
      for (const aid of r.operators) {
        const prev = acc.get(aid);
        if (prev) prev.push(r.name);
        else acc.set(aid, [r.name]);
      }
    }
    return Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [roles]);

  if (byOperator.length === 0) {
    return <div className={styles.empty}>Никто из Архонтов не назначен ни в одну роль.</div>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>AID</th>
          <th>Roles</th>
        </tr>
      </thead>
      <tbody>
        {byOperator.map(([aid, rs]) => (
          <tr key={aid}>
            <td className="mono">{aid}</td>
            <td>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {rs.map((rn) => (
                  <code
                    key={rn}
                    style={{
                      padding: '2px 8px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: 12,
                    }}
                  >
                    {rn}
                  </code>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RbacPage() {
  const [tab, setTab] = useState<Tab>('roles');

  const q = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
  });

  const roles = q.data?.items ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>RBAC</h1>
          <div className={styles.crumbs}>роли, permissions, назначения операторов (read-only)</div>
        </div>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'roles'}
          className={`${styles.tab} ${tab === 'roles' ? styles.tabActive : ''}`}
          onClick={() => setTab('roles')}
        >
          Roles
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'permissions'}
          className={`${styles.tab} ${tab === 'permissions' ? styles.tabActive : ''}`}
          onClick={() => setTab('permissions')}
        >
          Role permissions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'members'}
          className={`${styles.tab} ${tab === 'members' ? styles.tabActive : ''}`}
          onClick={() => setTab('members')}
        >
          Operator assignments
        </button>
      </div>

      {q.isLoading ? <div className={styles.loading}>Загружаем…</div> : null}
      {q.error ? (
        <div className={styles.errorBox}>
          {q.error instanceof ApiError ? `Ошибка ${q.error.status}: ${q.error.message}` : String(q.error)}
        </div>
      ) : null}

      {q.data && roles.length === 0 ? (
        <div className={styles.empty}>Ролей в кластере нет.</div>
      ) : null}

      {roles.length > 0 ? (
        <>
          {tab === 'roles' ? <RolesTab roles={roles} /> : null}
          {tab === 'permissions' ? <PermissionsTab roles={roles} /> : null}
          {tab === 'members' ? <MembersTab roles={roles} /> : null}
        </>
      ) : null}
    </div>
  );
}
