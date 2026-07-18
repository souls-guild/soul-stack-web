import { useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { keeperApi, type PermissionResource } from '../../api/keeper';
import {
  parsePermission,
  buildPermission,
  unionSelectorKeys,
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

// Per-key accent for the scope pickers (visual specialization by selector type).
function scopeColor(key: string): string {
  return `var(--scope-${key}, var(--accent))`;
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

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '5px 8px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
};

// Clickable value chip (autocomplete option) — fills the scope value. Coloured by type.
function valueChip(selected: boolean, color: string): CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    padding: '3px 10px',
    borderRadius: 'var(--radius-pill)',
    border: `1px solid ${selected ? color : 'var(--border)'}`,
    background: selected ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--surface)',
    color: selected ? 'var(--text)' : 'var(--text-muted)',
    cursor: 'pointer',
  };
}

// Spacious, type-specialized scope picker. Rendered under a checked action (or the
// wildcard) when selector_keys exist. Key = <select>; value = free-text input plus
// clickable autocomplete chips coloured by the selector type.
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
  const color = currentKey ? scopeColor(currentKey) : 'var(--accent)';

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
        marginTop: 8,
        marginLeft: 26,
        padding: '12px 14px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        borderLeft: currentKey ? `3px solid ${color}` : '1px solid var(--border)',
        background: 'var(--surface-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          {t('admin:rbacScopeLabel')}
        </span>
        <select
          value={currentKey}
          onChange={(e) => handleKeyChange(e.target.value)}
          aria-label={t('admin:rbacScopeKeyAria')}
          style={{ ...inputStyle, cursor: 'pointer' }}
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
            <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>=</span>
            <input
              type="text"
              list={options.length > 0 ? datalistId : undefined}
              value={scope?.value ?? ''}
              onChange={(e) => handleValueChange(e.target.value)}
              placeholder={t('admin:rbacScopeValuePlaceholder')}
              aria-label={t('admin:rbacScopeValueAria', { key: currentKey })}
              style={{ ...inputStyle, minWidth: 160, maxWidth: 260, flex: 1 }}
            />
          </>
        ) : null}
      </div>

      {currentKey && options.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {options.slice(0, 16).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => handleValueChange(o)}
              style={valueChip(o === scope?.value, color)}
            >
              {o}
            </button>
          ))}
          <datalist id={datalistId}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
      ) : null}

      {currentKey && !options.length ? (
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 8 }}>
          {t('admin:rbacScopeFreeText')}
        </div>
      ) : null}
    </div>
  );
}

// Scope badge for display next to a checked action and in the preserved-permissions list.
function ScopeBadge({ scopeKey, scopeValues }: { scopeKey: string; scopeValues: string[] }) {
  const { t } = useTranslation();
  const color = scopeColor(scopeKey);
  return (
    <span
      title={`on ${scopeKey}=${scopeValues.join(',')}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 6px',
        background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
        border: `1px solid color-mix(in srgb, ${color} 34%, var(--border))`,
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

// Bulk-scope bar: sets a shared scope on all checked permissions of the resource at once
// (NIM-79). Appears when ≥2 actions are checked and the resource has selector_keys.
function BulkScopeBar({
  selectorKeys,
  draft,
  onDraftChange,
  onApply,
  onClear,
}: {
  selectorKeys: string[];
  draft: { key: string; value: string };
  onDraftChange: (next: { key: string; value: string }) => void;
  onApply: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { key, value } = draft;
  const options = useAutocompleteOptions(key);
  const datalistId = useId();
  const color = key ? scopeColor(key) : 'var(--accent)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        marginBottom: 10,
        padding: '10px 12px',
        borderRadius: 'var(--radius)',
        background: 'var(--surface-2)',
        border: '1px dashed var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          {t('admin:rbacBulkScopeLabel')}
        </span>
        <select
          value={key}
          onChange={(e) => onDraftChange({ key: e.target.value, value })}
          aria-label={t('admin:rbacBulkScopeKeyAria')}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="">{t('admin:rbacScopeNone')}</option>
          {selectorKeys.map((k) => (
            <option key={k} value={k}>
              {t(`admin:rbacScopeKey_${k}`, { defaultValue: k })}
            </option>
          ))}
        </select>
        {key ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>=</span>
            <input
              type="text"
              list={options.length > 0 ? datalistId : undefined}
              value={value}
              onChange={(e) => onDraftChange({ key, value: e.target.value })}
              placeholder={t('admin:rbacScopeValuePlaceholder')}
              aria-label={t('admin:rbacBulkScopeValueAria', { key })}
              style={{ ...inputStyle, minWidth: 160, maxWidth: 260, flex: 1 }}
            />
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => { if (key) onApply(key, value); }}
          disabled={!key}
          style={{
            fontSize: 12,
            padding: '4px 12px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--accent)',
            background: 'transparent',
            color: key ? 'var(--accent)' : 'var(--text-faint)',
            cursor: key ? 'pointer' : 'not-allowed',
          }}
        >
          {t('admin:rbacBulkApply')}
        </button>
        <button
          type="button"
          onClick={() => { onDraftChange({ key: '', value: '' }); onClear(); }}
          style={{
            fontSize: 12,
            padding: '4px 12px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          {t('admin:rbacBulkClear')}
        </button>
      </div>
      {key && options.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.slice(0, 16).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onDraftChange({ key, value: o })}
              style={valueChip(o === value, color)}
            >
              {o}
            </button>
          ))}
          <datalist id={datalistId}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
      ) : null}
    </div>
  );
}

// Grouped permission-picker over the real catalog GET /v1/permissions (ADR-042), laid out
// as a master-detail: a searchable resource rail on the left, the selected resource's
// actions on the right with a spacious, type-specialized scope editor. The first control
// of a resource is the action-wildcard `resource.*` ("all actions", incl. future ones) —
// when it is on, the individual actions are HIDDEN (the wildcard covers everything now and
// in future updates). A full permission = `resource.action` | `resource.*` | `… on key=value`.
// Permissions outside the catalog (full `*`, legacy) — read-only chips.
export function PermissionsEditor({ value, onChange, catalog, ariaLabel }: Props) {
  const { t } = useTranslation();
  const groupId = useId();

  // scopeStates: Map base permission → current scope picker state.
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

  // Drafts of the bulk-scope pickers, keyed by resource — survive the bar unmounting.
  const [bulkDrafts, setBulkDrafts] = useState<Map<string, { key: string; value: string }>>(
    new Map(),
  );

  const [search, setSearch] = useState('');
  const [activeResource, setActiveResource] = useState<string | null>(null);

  const catalogBases = new Set<string>();
  const catalogResources = new Set<string>();
  for (const res of catalog) {
    catalogResources.add(res.resource);
    for (const act of (res.actions ?? [])) catalogBases.add(`${res.resource}.${act.action}`);
  }

  const isResourceWildcard = (base: string) =>
    base.endsWith('.*') && catalogResources.has(base.slice(0, -2));
  const isRepresentable = (base: string) => catalogBases.has(base) || isResourceWildcard(base);

  // A base with a single occurrence is edited via checkbox+scope; the same base with two
  // different scopes doesn't fit a single ScopeState — kept verbatim in preserved.
  const baseCounts = new Map<string, number>();
  for (const perm of value) {
    const { base } = parsePermission(perm);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  const isAdopted = (base: string) => isRepresentable(base) && baseCounts.get(base) === 1;

  const selected = new Set<string>();
  for (const perm of value) {
    const { base } = parsePermission(perm);
    if (isAdopted(base)) selected.add(base);
  }

  // preserved: everything the editor didn't adopt — round-tripped verbatim.
  const preserved = value.filter((p) => !isAdopted(parsePermission(p).base));

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

  // Wildcard `resource.*` — "all actions". Enabling removes the resource's individual
  // actions from the set (covered) → the result is `["resource.*"]`, not an enumeration.
  function toggleWildcard(res: PermissionResource, on: boolean) {
    const wc = `${res.resource}.*`;
    const next = new Set(selected);
    const nextScopes = new Map(scopeStates);
    if (on) {
      next.add(wc);
      for (const act of (res.actions ?? [])) {
        const b = `${res.resource}.${act.action}`;
        next.delete(b);
        nextScopes.delete(b);
      }
    } else {
      next.delete(wc);
      nextScopes.delete(wc);
    }
    setScopeStates(nextScopes);
    onChange(buildValue(next, nextScopes, preserved));
  }

  // Select-all-actions of a resource without the wildcard — enumerate current actions
  // (does NOT cover future ones; that's what the wildcard is for).
  function selectAllActions(res: PermissionResource) {
    const wc = `${res.resource}.*`;
    const next = new Set(selected);
    const nextScopes = new Map(scopeStates);
    next.delete(wc);
    nextScopes.delete(wc);
    for (const act of (res.actions ?? [])) next.add(`${res.resource}.${act.action}`);
    setScopeStates(nextScopes);
    onChange(buildValue(next, nextScopes, preserved));
  }

  function clearActions(res: PermissionResource) {
    const next = new Set(selected);
    const nextScopes = new Map(scopeStates);
    next.delete(`${res.resource}.*`);
    nextScopes.delete(`${res.resource}.*`);
    for (const act of (res.actions ?? [])) {
      const b = `${res.resource}.${act.action}`;
      next.delete(b);
      nextScopes.delete(b);
    }
    setScopeStates(nextScopes);
    onChange(buildValue(next, nextScopes, preserved));
  }

  // Grant every resource as a wildcard (all current + future actions of the whole catalog).
  function selectAllResources(on: boolean) {
    const next = new Set(selected);
    const nextScopes = new Map(scopeStates);
    for (const res of catalog) {
      const wc = `${res.resource}.*`;
      if (on) {
        next.add(wc);
        for (const act of (res.actions ?? [])) {
          const b = `${res.resource}.${act.action}`;
          next.delete(b);
          nextScopes.delete(b);
        }
      } else {
        next.delete(wc);
        nextScopes.delete(wc);
      }
    }
    setScopeStates(nextScopes);
    onChange(buildValue(next, nextScopes, preserved));
  }

  function applyBulkScope(res: PermissionResource, key: string, value: string) {
    const next = new Map(scopeStates);
    const v = value.trim();
    for (const act of (res.actions ?? [])) {
      const b = `${res.resource}.${act.action}`;
      if (!selected.has(b)) continue;
      if (!(act.selector_keys ?? []).includes(key)) continue;
      next.set(b, v ? { key, value: v } : null);
    }
    setScopeStates(next);
    onChange(buildValue(selected, next, preserved));
  }

  function clearBulkScope(res: PermissionResource) {
    const next = new Map(scopeStates);
    for (const act of (res.actions ?? [])) next.delete(`${res.resource}.${act.action}`);
    setScopeStates(next);
    onChange(buildValue(selected, next, preserved));
  }

  // --- Derived view state (search + active resource) ---
  const q = search.trim().toLowerCase();
  const matches = (res: PermissionResource) =>
    !q
    || res.resource.toLowerCase().includes(q)
    || (res.actions ?? []).some((a) => `${res.resource}.${a.action}`.toLowerCase().includes(q));
  const filtered = catalog.filter(matches);

  const effectiveActive =
    activeResource && filtered.some((r) => r.resource === activeResource)
      ? activeResource
      : (filtered[0]?.resource ?? null);
  const activeRes = catalog.find((r) => r.resource === effectiveActive) ?? null;

  const resourceCount = (res: PermissionResource) => {
    const wildcardOn = selected.has(`${res.resource}.*`);
    const n = (res.actions ?? []).filter((a) => selected.has(`${res.resource}.${a.action}`)).length;
    return { wildcardOn, n, total: (res.actions ?? []).length, has: wildcardOn || n > 0 };
  };

  const allResourcesWild =
    catalog.length > 0 && catalog.every((r) => selected.has(`${r.resource}.*`));

  const preservedNode = preserved.length > 0 ? (
    <div style={{ marginTop: 14 }}>
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
  ) : null;

  if (catalog.length === 0) {
    return (
      <div aria-label={ariaLabel}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('admin:rbacPermCatalogEmpty')}
        </div>
        {preservedNode}
      </div>
    );
  }

  return (
    <div aria-label={ariaLabel}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(210px, 250px) 1fr',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* LEFT RAIL — search + resource list */}
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            background: 'var(--surface)',
          }}
        >
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin:rbacSearchResources')}
              aria-label={t('admin:rbacSearchResources')}
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
              fontSize: 12.5,
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={allResourcesWild}
              onChange={(e) => selectAllResources(e.target.checked)}
              aria-label={t('admin:rbacSelectAllResources')}
              style={{ accentColor: 'var(--accent)' }}
            />
            {t('admin:rbacSelectAllResources')}
          </label>

          <div style={{ maxHeight: 460, overflow: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12.5, color: 'var(--text-faint)' }}>
                {t('admin:rbacNoResourceMatch')}
              </div>
            ) : (
              filtered.map((res) => {
                const { wildcardOn, n, total, has } = resourceCount(res);
                const isActive = res.resource === effectiveActive;
                return (
                  <div
                    key={res.resource}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 12px',
                      borderBottom: '1px solid var(--border)',
                      background: isActive ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : 'transparent',
                      boxShadow: isActive ? 'inset 3px 0 0 var(--accent)' : 'none',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: has ? 'var(--accent)' : 'var(--border-strong)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setActiveResource(res.resource)}
                      aria-label={t('admin:rbacSelectResourceAria', { resource: res.resource })}
                      aria-pressed={isActive}
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        border: 0,
                        background: 'transparent',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        color: 'var(--text)',
                        padding: 0,
                      }}
                    >
                      {res.resource}
                    </button>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: has ? 'var(--accent)' : 'var(--text-faint)',
                      }}
                    >
                      {wildcardOn ? t('admin:rbacCountAll') : `${n}/${total}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleWildcard(res, !wildcardOn)}
                      aria-label={t('admin:rbacToggleAllAria', { resource: res.resource })}
                      aria-pressed={wildcardOn}
                      style={{
                        fontSize: 10.5,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-pill)',
                        border: `1px solid ${wildcardOn ? 'var(--accent)' : 'var(--border)'}`,
                        background: wildcardOn ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface)',
                        color: wildcardOn ? 'var(--accent)' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {t('admin:rbacAllPill')}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL — actions of the active resource */}
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            background: 'var(--surface)',
            minHeight: 200,
          }}
        >
          {activeRes ? (
            (() => {
              const res = activeRes;
              const wildcardBase = `${res.resource}.*`;
              const wildcardId = `${groupId}-${wildcardBase}`;
              const wildcardOn = selected.has(wildcardBase);
              const unionKeys = unionSelectorKeys(res);
              const wildcardScope = scopeStates.get(wildcardBase) ?? null;
              const wildcardKeys =
                wildcardScope?.key && !unionKeys.includes(wildcardScope.key)
                  ? [...unionKeys, wildcardScope.key]
                  : unionKeys;
              const shownActions = (res.actions ?? []).filter(
                (act) => !q || `${res.resource}.${act.action}`.toLowerCase().includes(q) || res.resource.toLowerCase().includes(q),
              );
              const selectedActions = (res.actions ?? []).filter(
                (act) => selected.has(`${res.resource}.${act.action}`),
              ).length;
              const showBulk = !wildcardOn && selectedActions >= 2 && unionKeys.length > 0;

              return (
                <>
                  {/* header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '13px 16px',
                      borderBottom: '1px solid var(--border)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="mono" style={{ fontSize: 15 }}>{res.resource}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                      {t('admin:rbacActionCount', { count: (res.actions ?? []).length })}
                    </span>
                    {unionKeys.length > 0 ? (
                      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                        {unionKeys.map((k) => (
                          <span
                            key={k}
                            style={{
                              fontSize: 10.5,
                              fontFamily: 'var(--font-mono)',
                              padding: '2px 8px',
                              borderRadius: 'var(--radius-pill)',
                              border: `1px solid color-mix(in srgb, ${scopeColor(k)} 40%, var(--border))`,
                              color: scopeColor(k),
                            }}
                          >
                            {t(`admin:rbacScopeKey_${k}`, { defaultValue: k })}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* all-bar */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 16px',
                      background: 'var(--surface-2)',
                      borderBottom: '1px solid var(--border)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <label
                      htmlFor={wildcardId}
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
                        id={wildcardId}
                        type="checkbox"
                        checked={wildcardOn}
                        onChange={(e) => toggleWildcard(res, e.target.checked)}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      {wildcardBase}
                      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('admin:rbacAllActionsFuture')}
                      </span>
                    </label>
                    {!wildcardOn ? (
                      <>
                        <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
                        <button
                          type="button"
                          onClick={() => selectAllActions(res)}
                          style={{
                            fontSize: 12,
                            padding: '4px 10px',
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--text)',
                            cursor: 'pointer',
                          }}
                        >
                          {t('admin:rbacSelectAllActions')}
                        </button>
                        <button
                          type="button"
                          onClick={() => clearActions(res)}
                          style={{
                            fontSize: 12,
                            padding: '4px 10px',
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          {t('admin:rbacClearActions')}
                        </button>
                      </>
                    ) : null}
                  </div>

                  {wildcardOn ? (
                    /* WILDCARD ACTIVE — individual actions are hidden (covered incl. future) */
                    <div style={{ padding: '18px 16px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12,
                          padding: '14px 16px',
                          borderRadius: 'var(--radius)',
                          background: 'color-mix(in srgb, var(--accent) 7%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--accent) 26%, var(--border))',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div className="mono" style={{ fontSize: 14, marginBottom: 4 }}>{wildcardBase}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            {t('admin:rbacWildcardActiveProse', { resource: res.resource })}
                          </div>
                          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                            {(res.actions ?? []).map((act) => (
                              <span
                                key={act.action}
                                className="mono"
                                style={{
                                  fontSize: 11,
                                  padding: '2px 8px',
                                  borderRadius: 'var(--radius-pill)',
                                  background: 'var(--surface-2)',
                                  border: '1px solid var(--border)',
                                  color: 'var(--text-faint)',
                                }}
                              >
                                {act.action}
                              </span>
                            ))}
                            <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                              {t('admin:rbacWildcardFuture')}
                            </span>
                          </div>
                        </div>
                      </div>
                      {wildcardKeys.length > 0 ? (
                        <ScopePicker
                          selectorKeys={wildcardKeys}
                          scope={wildcardScope}
                          onChange={(s) => updateScope(wildcardBase, s)}
                        />
                      ) : null}
                    </div>
                  ) : (
                    /* INDIVIDUAL ACTIONS */
                    <div style={{ padding: '12px 16px' }}>
                      {showBulk ? (
                        <BulkScopeBar
                          selectorKeys={unionKeys}
                          draft={bulkDrafts.get(res.resource) ?? { key: '', value: '' }}
                          onDraftChange={(d) =>
                            setBulkDrafts((prev) => new Map(prev).set(res.resource, d))
                          }
                          onApply={(k, v) => applyBulkScope(res, k, v)}
                          onClear={() => clearBulkScope(res)}
                        />
                      ) : null}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {shownActions.map((act) => {
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
                                  gap: 8,
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
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
              {t('admin:rbacNoResourceMatch')}
            </div>
          )}
        </div>
      </div>

      {preservedNode}
    </div>
  );
}
