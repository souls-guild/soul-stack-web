import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { RoleView, SynodView } from '../../api/keeper';
import { tokenStore } from '../../api/tokenStore';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { heldRoleNames } from './roleCeiling';

// "Derive from" picker (ADR-078). Picking ONE role makes it the parent: it becomes the
// ceiling and the new role can never exceed it. Deliberately one role and not the union
// of everything the caller holds — the union is wider than any single role.
//
// A searchable list rather than a <select>: a real cluster has dozens of roles, and the
// choice needs the facts that decide it (scope, size, own derivation) visible per row.
//
// The list is ONLY the roles the caller actually holds — directly or through a Synod.
// Roles they don't hold are not offered at all: the server refuses a parent whose rights
// the caller doesn't cover, so listing them would only be an invitation to a 403. A caller
// with a bare `*` holds every role, so for them the whole catalog is the held set.

interface Props {
  roles: readonly RoleView[];
  synods?: readonly SynodView[];
  /** Parent role name; '' before a choice is made. */
  value: string;
  onChange: (next: string) => void;
  /** The role being edited — it can never be its own parent. */
  excludeName?: string;
  /** Catalog unavailable (403 role.list / network) → the field degrades to a note. */
  unavailable?: boolean;
}

const MAX_ROWS = 9;

export function ParentRoleSelect({ roles, synods, value, onChange, excludeName, unavailable }: Props) {
  const { t } = useTranslation();
  const { ceilingFor } = useMyPermissions();
  // A caller with a bare `*` covers every role's rights, so every role is derivable.
  const holdsEverything = ceilingFor('*')?.unrestricted === true;
  // From the JWT rather than AuthContext: the field is also rendered inside forms that
  // tests mount standalone, and the AID doesn't change without a re-login.
  const myAid = tokenStore.identity()?.aid;

  const [search, setSearch] = useState('');

  const held = useMemo(() => {
    const candidates = roles.filter((r) => r.name !== excludeName);
    if (holdsEverything || !myAid) return candidates;
    const names = heldRoleNames(roles, synods, myAid);
    return candidates.filter((r) => names.has(r.name));
  }, [roles, synods, excludeName, holdsEverything, myAid]);

  const q = search.trim().toLowerCase();
  const shown = held.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
  );

  if (unavailable) {
    return (
      <div data-testid="parent-role-unavailable" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        {t('admin:rbacParentCatalogUnavailable')}
      </div>
    );
  }

  const row = (r: RoleView) => {
    const active = value === r.name;
    return (
      <button
        key={r.name}
        type="button"
        role="radio"
        aria-checked={active}
        data-testid={`parent-role-option-${r.name}`}
        onClick={() => onChange(r.name)}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          // The field sits in a narrow column: the row wraps rather than forcing the
          // list to scroll sideways, which would hide the scope the choice depends on.
          flexWrap: 'wrap',
          gap: 8,
          rowGap: 2,
          width: '100%',
          textAlign: 'left',
          padding: '7px 11px',
          border: 0,
          borderBottom: '1px solid var(--border)',
          background: active ? 'color-mix(in srgb, var(--accent) 11%, transparent)' : 'transparent',
          boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
          cursor: 'pointer',
          color: 'var(--text)',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.name}</span>
        {r.builtin ? <Tag>{t('admin:rbacParentTagBuiltin')}</Tag> : null}
        {r.parent_role ? <Tag>{t('admin:rbacDerivedFrom', { name: r.parent_role })}</Tag> : null}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>
          {t('admin:rbacParentRowPerms', { count: (r.effective_permissions ?? []).length })}
          {r.effective_scope ? ` · ${r.effective_scope}` : ` · ${t('admin:rbacParentRowNoScope')}`}
        </span>
      </button>
    );
  };

  return (
    <div data-testid="parent-role-select" role="radiogroup" aria-label={t('admin:rbacParentAria')}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>{t('admin:rbacParentLabel')}</div>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--surface)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <Search size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            type="text"
            data-testid="parent-role-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin:rbacParentSearch')}
            aria-label={t('admin:rbacParentSearch')}
            style={{
              flex: 1,
              fontSize: 13,
              border: 0,
              background: 'transparent',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ maxHeight: MAX_ROWS * 34, overflowY: 'auto', overflowX: 'hidden' }}>
          {shown.map(row)}
          {shown.length === 0 ? (
            <div
              data-testid="parent-role-empty"
              style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-faint)' }}
            >
              {q ? t('admin:rbacParentNoMatch') : t('admin:rbacParentNoneHeld')}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6 }}>
        {value ? t('admin:rbacParentDerivedHint', { name: value }) : t('admin:rbacParentRequiredHint')}
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border)',
        color: 'var(--text-faint)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
