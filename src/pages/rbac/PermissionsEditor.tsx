import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PermissionResource } from '../../api/keeper';
import {
  parsePermission,
  buildPermission,
  unionSelectorKeys,
} from './permissions';
import { ScopeBuilder } from './ScopeBuilder';
import { pruneScope } from './scopeBuilderModel';
import { parseScope, serializeScope, type ScopeNode } from './scopeExpr';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  catalog: readonly PermissionResource[];
  ariaLabel?: string;
}

// Per-base scope editor state: a parsed boolean tree (ScopeBuilder) or, when an
// existing scope string doesn't parse, a raw-string textarea fallback (graceful
// degradation — NIM-128).
type ScopeSlot = { kind: 'tree'; node: ScopeNode | null } | { kind: 'raw'; text: string };

function slotScopeString(slot: ScopeSlot | undefined): string {
  if (!slot) return '';
  if (slot.kind === 'raw') return slot.text.trim();
  return serializeScope(pruneScope(slot.node));
}

// Reads an existing scoped permission into a slot; a scope that fails to parse
// becomes a raw slot the user can still edit verbatim.
function slotFromScope(scope: string | undefined): ScopeSlot | undefined {
  if (!scope) return undefined;
  try {
    return { kind: 'tree', node: parseScope(scope) };
  } catch {
    return { kind: 'raw', text: scope };
  }
}

// Assemble the flat permission list from the current selection + scopes + preserved.
// Module-level (pure) so the editor's mutation handlers can stay referentially stable.
function buildValue(
  bases: Set<string>,
  scopes: Map<string, ScopeSlot>,
  currentPreserved: string[],
): string[] {
  const result: string[] = [...currentPreserved];
  for (const base of bases) {
    const scope = slotScopeString(scopes.get(base));
    result.push(buildPermission({ base, scope: scope || undefined }));
  }
  return result;
}

// Small mono chip showing the current scope expression next to a checked action.
function ScopeChip({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: 320,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        padding: '1px 8px',
        background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--accent) 32%, var(--border))',
        borderRadius: 'var(--radius-pill)',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {text}
    </span>
  );
}

// Raw-string fallback for a scope that couldn't be parsed into the builder.
function RawScopeFallback({
  text,
  onChange,
  onReset,
  ariaLabel,
}: {
  text: string;
  onChange: (text: string) => void;
  onReset: () => void;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        marginTop: 8,
        padding: '12px 14px',
        borderRadius: 'var(--radius)',
        border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border))',
        background: 'color-mix(in srgb, var(--warning) 7%, var(--surface))',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {t('admin:rbacScopeRawParseFail')}
      </div>
      <textarea
        rows={2}
        value={text}
        spellCheck={false}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: 8,
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          resize: 'vertical',
        }}
      />
      <button
        type="button"
        onClick={onReset}
        style={{
          marginTop: 8,
          fontSize: 12,
          padding: '4px 10px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        {t('admin:rbacScopeResetBuilder')}
      </button>
    </div>
  );
}

// --- left rail (searchable resource list) ---

// Per-resource selection summary the rail needs to draw a row. Recomputed by the
// parent only when the selection or filter actually changes (memoized), so a scope
// keystroke — which changes the permission strings but not which bases are selected
// — leaves this array referentially stable and the memoized rail skips re-render.
interface ResourceMeta {
  res: PermissionResource;
  wildcardOn: boolean;
  n: number;
  total: number;
  has: boolean;
  isActive: boolean;
}

// Memoized so editing a scope (which re-renders the parent every keystroke) does NOT
// re-render the 100+ resource catalog. Props are all primitives / referentially-stable
// (items via useMemo, handlers via useCallback) → React.memo bails on scope edits.
const ResourceRail = memo(function ResourceRail({
  search,
  onSearch,
  items,
  allResourcesWild,
  onSelectAllResources,
  onActivate,
  onToggleWildcard,
}: {
  search: string;
  onSearch: (s: string) => void;
  items: readonly ResourceMeta[];
  allResourcesWild: boolean;
  onSelectAllResources: (on: boolean) => void;
  onActivate: (resource: string) => void;
  onToggleWildcard: (res: PermissionResource, on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
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
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t('admin:rbacSearchResources')}
          aria-label={t('admin:rbacSearchResources')}
          style={{
            width: '100%',
            fontSize: 13,
            padding: '5px 8px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
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
          onChange={(e) => onSelectAllResources(e.target.checked)}
          aria-label={t('admin:rbacSelectAllResources')}
          style={{ accentColor: 'var(--accent)' }}
        />
        {t('admin:rbacSelectAllResources')}
      </label>

      <div style={{ maxHeight: 460, overflow: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12.5, color: 'var(--text-faint)' }}>
            {t('admin:rbacNoResourceMatch')}
          </div>
        ) : (
          items.map(({ res, wildcardOn, n, total, has, isActive }) => (
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
                onClick={() => onActivate(res.resource)}
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
                onClick={() => onToggleWildcard(res, !wildcardOn)}
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
          ))
        )}
      </div>
    </div>
  );
});

// Grouped permission-picker over the real catalog GET /v1/permissions (ADR-042), laid out
// as a master-detail: a searchable resource rail on the left, the selected resource's
// actions on the right, each with a boolean scope condition-builder (NIM-128). The first
// control of a resource is the action-wildcard `resource.*` ("all actions", incl. future
// ones) — when on, individual actions are HIDDEN. A full permission =
// `resource.action` | `resource.*` | `… on <scope-expr>`.
// Permissions outside the catalog (full `*`, legacy) — read-only chips.
//
// Perf (NIM-128): the left rail is a memoized child fed referentially-stable props, so
// typing in a scope builder (which re-renders this component on every keystroke) does not
// re-render the whole 100+ resource catalog. Mutation handlers read the latest state via
// a ref, so they stay stable across renders too.
export function PermissionsEditor({ value, onChange, catalog, ariaLabel }: Props) {
  const { t } = useTranslation();
  const groupId = useId();

  // scopeStates: Map base permission → current scope slot.
  const [scopeStates, setScopeStates] = useState<Map<string, ScopeSlot>>(() => {
    const m = new Map<string, ScopeSlot>();
    for (const perm of value) {
      const { base, scope } = parsePermission(perm);
      const slot = slotFromScope(scope);
      if (slot) m.set(base, slot);
    }
    return m;
  });

  const [search, setSearch] = useState('');
  const [activeResource, setActiveResource] = useState<string | null>(null);

  const { catalogBases, catalogResources } = useMemo(() => {
    const bases = new Set<string>();
    const resources = new Set<string>();
    for (const res of catalog) {
      resources.add(res.resource);
      for (const act of (res.actions ?? [])) bases.add(`${res.resource}.${act.action}`);
    }
    return { catalogBases: bases, catalogResources: resources };
  }, [catalog]);

  const isResourceWildcard = (base: string) =>
    base.endsWith('.*') && catalogResources.has(base.slice(0, -2));
  // Bare `*` = full access. Cluster-admin when unscoped, scoped super-admin when
  // paired with a scope (`* on <expr>`) — NIM-128 amendment. Adopted (editable via the
  // Full-access toggle), never a read-only preserved chip.
  const isRepresentable = (base: string) =>
    base === '*' || catalogBases.has(base) || isResourceWildcard(base);

  // A base with a single occurrence is edited via checkbox+scope; the same base with two
  // different scopes doesn't fit one slot — kept verbatim in preserved.
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

  // Latest state for the (stable) mutation handlers below. Keeping the handlers
  // referentially stable is what lets the memoized rail / builders bail on scope edits.
  const ctxRef = useRef({ selected, scopeStates, preserved, onChange });
  ctxRef.current = { selected, scopeStates, preserved, onChange };

  const toggle = useCallback((base: string, on: boolean) => {
    const { selected, scopeStates, preserved, onChange } = ctxRef.current;
    const next = new Set(selected);
    const nextScopes = new Map(scopeStates);
    if (on) {
      next.add(base);
    } else {
      next.delete(base);
      nextScopes.delete(base);
    }
    setScopeStates(nextScopes);
    onChange(buildValue(next, nextScopes, preserved));
  }, []);

  const updateScope = useCallback((base: string, slot: ScopeSlot) => {
    const { selected, scopeStates, preserved, onChange } = ctxRef.current;
    const next = new Map(scopeStates);
    next.set(base, slot);
    setScopeStates(next);
    onChange(buildValue(selected, next, preserved));
  }, []);

  // Wildcard `resource.*` — "all actions". Enabling removes the resource's individual
  // actions from the set (covered) → the result is `["resource.*"]`, not an enumeration.
  const toggleWildcard = useCallback((res: PermissionResource, on: boolean) => {
    const { selected, scopeStates, preserved, onChange } = ctxRef.current;
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
  }, []);

  // Select-all-actions of a resource without the wildcard — enumerate current actions.
  const selectAllActions = useCallback((res: PermissionResource) => {
    const { selected, scopeStates, preserved, onChange } = ctxRef.current;
    const wc = `${res.resource}.*`;
    const next = new Set(selected);
    const nextScopes = new Map(scopeStates);
    next.delete(wc);
    nextScopes.delete(wc);
    for (const act of (res.actions ?? [])) next.add(`${res.resource}.${act.action}`);
    setScopeStates(nextScopes);
    onChange(buildValue(next, nextScopes, preserved));
  }, []);

  const clearActions = useCallback((res: PermissionResource) => {
    const { selected, scopeStates, preserved, onChange } = ctxRef.current;
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
  }, []);

  // Grant every resource as a wildcard (all current + future actions of the whole catalog).
  const selectAllResources = useCallback((on: boolean) => {
    const { selected, scopeStates, preserved, onChange } = ctxRef.current;
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
  }, [catalog]);

  // Stable per-base onChange for ScopeBuilder — cached so an unrelated keystroke doesn't
  // hand every mounted builder a fresh closure (which would defeat their React.memo).
  const scopeOnChangeCache = useRef(new Map<string, (node: ScopeNode | null) => void>());
  const scopeOnChange = useCallback((base: string) => {
    const cache = scopeOnChangeCache.current;
    let fn = cache.get(base);
    if (!fn) {
      fn = (node) => updateScope(base, { kind: 'tree', node });
      cache.set(base, fn);
    }
    return fn;
  }, [updateScope]);

  // Scope editor under a checked action / wildcard: builder, or raw fallback on a
  // scope string that didn't parse.
  const scopeEditor = (base: string) => {
    const slot = scopeStates.get(base);
    if (slot?.kind === 'raw') {
      return (
        <RawScopeFallback
          text={slot.text}
          ariaLabel={t('admin:rbacScopeRawLabel', { base })}
          onChange={(text) => updateScope(base, { kind: 'raw', text })}
          onReset={() => updateScope(base, { kind: 'tree', node: null })}
        />
      );
    }
    return (
      <ScopeBuilder
        value={slot?.kind === 'tree' ? slot.node : null}
        onChange={scopeOnChange(base)}
        ariaLabel={t('admin:rbacScopeBuilderForAria', { base })}
        base={base}
      />
    );
  };

  // --- Derived view state (search + active resource) ---
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matches = (res: PermissionResource) =>
      !q
      || res.resource.toLowerCase().includes(q)
      || (res.actions ?? []).some((a) => `${res.resource}.${a.action}`.toLowerCase().includes(q));
    return catalog.filter(matches);
  }, [catalog, q]);

  const effectiveActive =
    activeResource && filtered.some((r) => r.resource === activeResource)
      ? activeResource
      : (filtered[0]?.resource ?? null);
  const activeRes = catalog.find((r) => r.resource === effectiveActive) ?? null;

  // Signature of the current selection — cheap to compute, drives the rail memo. Changing
  // a scope doesn't change which bases are selected, so this stays constant across a
  // scope keystroke and `resourceMeta` (hence the rail) stays referentially stable.
  const selectedSig = Array.from(selected).sort().join('');

  const resourceMeta = useMemo<ResourceMeta[]>(
    () =>
      filtered.map((res) => {
        const wildcardOn = selected.has(`${res.resource}.*`);
        const n = (res.actions ?? []).filter((a) => selected.has(`${res.resource}.${a.action}`)).length;
        const total = (res.actions ?? []).length;
        return { res, wildcardOn, n, total, has: wildcardOn || n > 0, isActive: res.resource === effectiveActive };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, selectedSig, effectiveActive],
  );

  const allResourcesWild =
    catalog.length > 0 && catalog.every((r) => selected.has(`${r.resource}.*`));

  // Full access `*` — cluster-admin (unscoped) or scoped super-admin (`* on <expr>`).
  const fullAccessOn = selected.has('*');

  // Distinct from "Select all resources" (N× resource.*): a single `*` grant that also
  // covers future resources. Its scope builder decides cluster-admin vs scoped admin.
  const fullAccessNode = (
    <div
      data-testid="perm-full-access"
      style={{
        marginBottom: 14,
        border: `1px solid ${fullAccessOn ? 'color-mix(in srgb, var(--accent) 42%, var(--border))' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        background: fullAccessOn
          ? 'color-mix(in srgb, var(--accent) 7%, var(--surface))'
          : 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '12px 16px',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          data-testid="perm-full-access-toggle"
          checked={fullAccessOn}
          onChange={(e) => toggle('*', e.target.checked)}
          aria-label={`${t('admin:rbacFullAccessLabel')} (*)`}
          style={{ accentColor: 'var(--accent)', marginTop: 2, flexShrink: 0 }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              className="mono"
              style={{
                fontSize: 13,
                padding: '1px 7px',
                borderRadius: 'var(--radius-pill)',
                background: 'color-mix(in srgb, var(--accent) 14%, var(--surface-2))',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))',
              }}
            >
              *
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
              {t('admin:rbacFullAccessLabel')}
            </span>
            <span
              style={{
                fontSize: 10.5,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
              }}
            >
              {t('admin:rbacFullAccessSub')}
            </span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {t('admin:rbacFullAccessHint')}
          </span>
        </span>
      </label>
      {fullAccessOn ? (
        <div style={{ padding: '0 16px 14px' }}>{scopeEditor('*')}</div>
      ) : null}
    </div>
  );

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
              {parsed.scope ? <ScopeChip text={parsed.scope} /> : null}
            </span>
          );
        })}
      </div>
    </div>
  ) : null;

  if (catalog.length === 0) {
    return (
      <div aria-label={ariaLabel}>
        {fullAccessNode}
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('admin:rbacPermCatalogEmpty')}
        </div>
        {preservedNode}
      </div>
    );
  }

  return (
    <div aria-label={ariaLabel}>
      {fullAccessNode}
      {fullAccessOn ? (
        <div
          data-testid="perm-catalog-dimmed-note"
          style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-faint)', marginBottom: 8 }}
        >
          {t('admin:rbacFullAccessCatalogDimmed')}
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(210px, 250px) 1fr',
          gap: 14,
          alignItems: 'start',
          opacity: fullAccessOn ? 0.5 : 1,
          transition: 'opacity .15s ease',
        }}
      >
        {/* LEFT RAIL — memoized: scope keystrokes don't re-render the resource catalog */}
        <ResourceRail
          search={search}
          onSearch={setSearch}
          items={resourceMeta}
          allResourcesWild={allResourcesWild}
          onSelectAllResources={selectAllResources}
          onActivate={setActiveResource}
          onToggleWildcard={toggleWildcard}
        />

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
              const shownActions = (res.actions ?? []).filter(
                (act) => !q || `${res.resource}.${act.action}`.toLowerCase().includes(q) || res.resource.toLowerCase().includes(q),
              );

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
                      {unionKeys.length > 0 ? scopeEditor(wildcardBase) : null}
                    </div>
                  ) : (
                    /* INDIVIDUAL ACTIONS */
                    <div style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {shownActions.map((act) => {
                          const base = `${res.resource}.${act.action}`;
                          const id = `${groupId}-${base}`;
                          const isChecked = selected.has(base);
                          const hasSelectorKeys = (act.selector_keys ?? []).length > 0;
                          const summary = isChecked ? slotScopeString(scopeStates.get(base)) : '';

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
                                {summary ? <ScopeChip text={summary} /> : null}
                              </label>
                              {isChecked && hasSelectorKeys ? scopeEditor(base) : null}
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
