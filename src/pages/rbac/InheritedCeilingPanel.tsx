import { useTranslation } from 'react-i18next';
import type { RoleView } from '../../api/keeper';
import { parsePermission } from './permissions';
import { derivationChain } from './roleCeiling';

// Read-only ceiling of a derived role (ADR-078): what the chosen parent hands down and
// what the new role can never exceed. Everything here comes RESOLVED from the catalog
// (effective_permissions / effective_scope) — the UI never walks parent_role to compute
// rights, so it cannot disagree with the enforcer.

interface Props {
  parent: RoleView;
  /** Full catalog — used only to render the parent's own derivation chain. */
  roles: readonly RoleView[];
}

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-pill)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  color: 'var(--text-muted)',
} as const;

export function InheritedCeilingPanel({ parent, roles }: Props) {
  const { t } = useTranslation();
  const perms = parent.effective_permissions ?? [];
  const scope = parent.effective_scope?.trim() ?? '';
  const chain = derivationChain(roles, parent.name);

  return (
    <div
      data-testid="inherited-ceiling-panel"
      style={{
        padding: '13px 15px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))',
        background: 'color-mix(in srgb, var(--accent) 5%, var(--surface))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('admin:rbacCeilingPanelTitle', { name: parent.name })}</span>
        {chain.length > 1 ? (
          <span data-testid="inherited-chain" className="mono" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
            {chain.join(' → ')}
          </span>
        ) : null}
      </div>
      <p style={{ margin: '0 0 11px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {t('admin:rbacCeilingPanelProse', { name: parent.name })}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
            {t('admin:rbacCeilingPanelScope')}
          </div>
          {scope ? (
            <code data-testid="inherited-scope" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>
              {scope}
            </code>
          ) : (
            <span data-testid="inherited-scope-unrestricted" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('admin:rbacCeilingPanelScopeUnrestricted')}
            </span>
          )}
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
            {t('admin:rbacCeilingPanelPerms', { count: perms.length })}
          </div>
          {perms.length === 0 ? (
            <span data-testid="inherited-perms-empty" style={{ fontSize: 12.5, color: 'var(--warning, #b07f00)' }}>
              {t('admin:rbacCeilingPanelPermsEmpty', { name: parent.name })}
            </span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {perms.map((perm) => {
                const parsed = parsePermission(perm);
                return (
                  <span key={perm} title={perm} style={chipStyle}>
                    {parsed.base}
                    {parsed.scope ? (
                      <span style={{ color: 'var(--text-faint)' }}>{` on ${parsed.scope}`}</span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
