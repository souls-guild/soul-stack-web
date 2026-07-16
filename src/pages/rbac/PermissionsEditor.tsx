import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { keeperApi, type PermissionResource } from '../../api/keeper';
import {
  parsePermission,
  buildPermission,
} from './permissions';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  catalog: readonly PermissionResource[];
  ariaLabel?: string;
}

// State of the scope picker for a single action.
interface ScopeState {
  key: string;
  value: string;
}

// Autocomplete values by scope key (sourced from existing APIs).
function useAutocompleteOptions(scopeKey: string): string[] {
  const incQ = useQuery({
    queryKey: ['rbac.scope-ac.incarnations'],
    queryFn: () => keeperApi.incarnations.list({ limit: 200 }),
    enabled: scopeKey === 'incarnation',
    staleTime: 60_000,
  });
  const svcQ = useQuery({
    queryKey: ['rbac.scope-ac.services'],
    queryFn: () => keeperApi.services.list(),
    enabled: scopeKey === 'service',
    staleTime: 60_000,
  });
  const soulsQ = useQuery({
    queryKey: ['rbac.scope-ac.souls'],
    queryFn: () => keeperApi.souls.list({ limit: 200 }),
    enabled: scopeKey === 'host',
    staleTime: 60_000,
  });
  // coven — no direct endpoint; collect unique covens from /v1/souls.
  const covenSoulsQ = useQuery({
    queryKey: ['rbac.scope-ac.covens'],
    queryFn: () => keeperApi.souls.list({ limit: 500 }),
    enabled: scopeKey === 'coven',
    staleTime: 60_000,
  });

  if (scopeKey === 'incarnation') {
    return (incQ.data?.items ?? []).map((i) => i.name).filter(Boolean);
  }
  if (scopeKey === 'service') {
    return (svcQ.data?.items ?? []).map((s) => s.name).filter(Boolean);
  }
  if (scopeKey === 'host') {
    return (soulsQ.data?.items ?? []).map((s) => s.sid).filter(Boolean);
  }
  if (scopeKey === 'coven') {
    const all = covenSoulsQ.data?.items ?? [];
    const uniq = new Set<string>();
    for (const s of all) {
      for (const c of s.covens ?? []) uniq.add(c);
    }
    return Array.from(uniq).sort();
  }
  return [];
}

// Scope picker for a single action. Rendered under the checkbox when checked + selector_keys exist.
function ScopePicker({
  selectorKeys,
  scope,
  onChange,
}: {
  selectorKeys: string[];
  scope: ScopeState | null;
  onChange: (next: ScopeState | null) => void;
}) {
  const { t } = useTranslation();
  const currentKey = scope?.key ?? '';
  const options = useAutocompleteOptions(currentKey);
  const datalistId = useId();

  // If no key is selected — show the key selector.
  const handleKeyChange = (k: string) => {
    if (!k) { onChange(null); return; }
    onChange({ key: k, value: scope?.value ?? '' });
  };

  const handleValueChange = (v: string) => {
    if (!currentKey) return;
    onChange({ key: currentKey, value: v });
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
        marginLeft: 22,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {t('admin:rbacScopeLabel')}
      </span>
      <select
        value={currentKey}
        onChange={(e) => handleKeyChange(e.target.value)}
        aria-label={t('admin:rbacScopeKeyAria')}
        style={{
          fontSize: 12,
          padding: '2px 6px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          cursor: 'pointer',
        }}
      >
        <option value="">{t('admin:rbacScopeNone')}</option>
        {selectorKeys.map((k) => (
          <option key={k} value={k}>
            {t(`admin:rbacScopeKey_${k}`, { defaultValue: k })}
          </option>
        ))}
      </select>
      {currentKey ? (
        <>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>=</span>
          <input
            type="text"
            list={options.length > 0 ? datalistId : undefined}
            value={scope?.value ?? ''}
            onChange={(e) => handleValueChange(e.target.value)}
            placeholder={t('admin:rbacScopeValuePlaceholder')}
            aria-label={t('admin:rbacScopeValueAria', { key: currentKey })}
            style={{
              fontSize: 12,
              padding: '2px 6px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              minWidth: 120,
              maxWidth: 220,
            }}
          />
          {options.length > 0 && (
            <datalist id={datalistId}>
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
          {!options.length && (
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              {t('admin:rbacScopeFreeText')}
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}

// Scope badge for display in the preserved-permissions list and in the catalog picker.
function ScopeBadge({ scopeKey, scopeValues }: { scopeKey: string; scopeValues: string[] }) {
  const { t } = useTranslation();
  return (
    <span
      title={`on ${scopeKey}=${scopeValues.join(',')}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 6px',
        background: 'color-mix(in srgb, var(--accent, #2563eb) 12%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--accent, #2563eb) 30%, var(--border))',
        borderRadius: 'var(--radius-pill)',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
      }}
    >
      {t(`admin:rbacScopeKey_${scopeKey}`, { defaultValue: scopeKey })}={scopeValues.join(',')}
    </span>
  );
}

// Grouped permission picker backed by the real catalog GET /v1/permissions (ADR-042):
// resource → actions, the operator checks boxes. If an action has selector_keys —
// an optional scope picker appears (key dropdown + value input).
// Full permission = `resource.action` or `resource.action on key=value`.
// Permissions from value not covered by the catalog (wildcard `*`, `incarnation.*`, legacy,
// previously saved scoped rights) are preserved as read-only chips.
export function PermissionsEditor({ value, onChange, catalog, ariaLabel }: Props) {
  const { t } = useTranslation();
  const groupId = useId();

  // scopeStates: Map base permission → current scope picker state.
  // Initialized from value: if a permission is already scoped — parse and show it.
  const [scopeStates, setScopeStates] = useState<Map<string, ScopeState | null>>(() => {
    const m = new Map<string, ScopeState | null>();
    for (const perm of value) {
      const parsed = parsePermission(perm);
      if (parsed.scopeKey && parsed.scopeValues) {
        m.set(parsed.base, { key: parsed.scopeKey, value: parsed.scopeValues.join(',') });
      }
    }
    return m;
  });

  // selected: Set of base permissions (without the scope part) — for checkboxes.
  const selected = new Set<string>();
  for (const perm of value) {
    const { base } = parsePermission(perm);
    selected.add(base);
  }

  const catalogBases = new Set<string>();
  for (const res of catalog) {
    for (const act of (res.actions ?? [])) catalogBases.add(`${res.resource}.${act.action}`);
  }

  // Permissions not covered by the catalog (including wildcard, scoped rights) — not lost on save.
  const preserved = value.filter((p) => {
    const { base } = parsePermission(p);
    return !catalogBases.has(base);
  });

  // Build the current value from selected + scopeStates.
  function buildValue(
    bases: Set<string>,
    scopes: Map<string, ScopeState | null>,
    currentPreserved: string[],
  ): string[] {
    const result: string[] = [...currentPreserved];
    for (const base of bases) {
      const scope = scopes.get(base);
      if (scope?.key && scope.value.trim()) {
        result.push(buildPermission({ base, scopeKey: scope.key, scopeValues: [scope.value.trim()] }));
      } else {
        result.push(base);
      }
    }
    return result;
  }

  function toggle(base: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(base);
    else { next.delete(base); setScopeStates((prev) => { const m = new Map(prev); m.delete(base); return m; }); }
    onChange(buildValue(next, scopeStates, preserved));
  }

  function updateScope(base: string, scope: ScopeState | null) {
    const next = new Map(scopeStates);
    next.set(base, scope);
    setScopeStates(next);
    onChange(buildValue(selected, next, preserved));
  }

  return (
    <div aria-label={ariaLabel}>
      {catalog.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('admin:rbacPermCatalogEmpty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {catalog.map((res) => (
            <fieldset
              key={res.resource}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '8px 12px 12px',
                margin: 0,
              }}
            >
              <legend
                className="mono"
                style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '0 4px' }}
              >
                {res.resource}
              </legend>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(res.actions ?? []).map((act) => {
                  const base = `${res.resource}.${act.action}`;
                  const id = `${groupId}-${base}`;
                  const isChecked = selected.has(base);
                  const hasSelectorKeys = (act.selector_keys ?? []).length > 0;
                  const currentScope = scopeStates.get(base) ?? null;

                  return (
                    <div key={base}>
                      <label
                        htmlFor={id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          id={id}
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => toggle(base, e.target.checked)}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        {base}
                        {isChecked && currentScope?.key && currentScope.value ? (
                          <ScopeBadge
                            scopeKey={currentScope.key}
                            scopeValues={[currentScope.value]}
                          />
                        ) : null}
                      </label>
                      {isChecked && hasSelectorKeys ? (
                        <ScopePicker
                          selectorKeys={act.selector_keys ?? []}
                          scope={currentScope}
                          onChange={(s) => updateScope(base, s)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {preserved.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            {t('admin:rbacPermPreserved')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {preserved.map((perm) => {
              const parsed = parsePermission(perm);
              return (
                <span
                  key={perm}
                  className="mono"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                  }}
                >
                  {parsed.base}
                  {parsed.scopeKey && parsed.scopeValues ? (
                    <ScopeBadge scopeKey={parsed.scopeKey} scopeValues={parsed.scopeValues} />
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
