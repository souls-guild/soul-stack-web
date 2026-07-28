import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RoleView } from '../../api/keeper';

// Blast radius of editing a role that others derive from (ADR-078). Both directions
// travel: narrowing this role's scope narrows every child, WIDENING it widens them — a
// child that stored only a delta has no say in it. Revoking a permission leaves the
// child's row in place but resolves it away, so the child silently grants less.
//
// Which is why the children are listed before the editor, not after: the operator sees
// what a save reaches.

export function DerivedChildrenPanel({ children }: { children: readonly RoleView[] }) {
  const { t } = useTranslation();
  if (children.length === 0) return null;

  return (
    <div
      data-testid="derived-children-panel"
      style={{
        marginBottom: 14,
        padding: '13px 15px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid color-mix(in srgb, var(--warning, #b07f00) 34%, var(--border))',
        background: 'color-mix(in srgb, var(--warning, #b07f00) 6%, var(--surface))',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
        {t('admin:rbacChildrenTitle', { count: children.length })}
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {t('admin:rbacChildrenProse')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children.map((c) => (
          <div
            key={c.name}
            data-testid={`derived-child-${c.name}`}
            style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 }}
          >
            <Link to={`/rbac/roles/${encodeURIComponent(c.name)}/edit`} className="mono" style={{ fontSize: 12.5 }}>
              {c.name}
            </Link>
            <span style={{ color: 'var(--text-faint)' }}>
              {c.default_scope
                ? t('admin:rbacChildrenOwn', { scope: c.default_scope })
                : t('admin:rbacChildrenOwnNone')}
            </span>
            <span style={{ flex: 1 }} />
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }}>
              {c.effective_scope || t('admin:rbacCeilingPanelScopeUnrestricted')}
            </code>
            <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {t('admin:rbacParentRowPerms', { count: (c.effective_permissions ?? []).length })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
