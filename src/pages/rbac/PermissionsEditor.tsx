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

// Bulk-scope bar: массовое задание общего scope на все отмеченные права группы
// разом (поинт NIM-79). Появляется когда в resource-группе отмечено ≥2 действия
// и у ресурса есть selector_keys. Применяет выбранный key=value ко всем
// отмеченным действиям группы, поддерживающим этот ключ.
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
  // Черновик держит родитель (keyed by resource) — переживает размонтирование
  // bar-а при падении числа отмеченных <2, ввод не теряется.
  const { key, value } = draft;
  const options = useAutocompleteOptions(key);
  const datalistId = useId();

  const inputStyle: CSSProperties = {
    fontSize: 12,
    padding: '2px 6px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        marginBottom: 8,
        padding: '6px 8px',
        borderRadius: 'var(--radius)',
        background: 'var(--surface-2)',
        border: '1px dashed var(--border)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
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
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>=</span>
          <input
            type="text"
            list={options.length > 0 ? datalistId : undefined}
            value={value}
            onChange={(e) => onDraftChange({ key, value: e.target.value })}
            placeholder={t('admin:rbacScopeValuePlaceholder')}
            aria-label={t('admin:rbacBulkScopeValueAria', { key })}
            style={{ ...inputStyle, minWidth: 120, maxWidth: 220 }}
          />
          {options.length > 0 && (
            <datalist id={datalistId}>
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </>
      ) : null}
      <button
        type="button"
        onClick={() => { if (key) onApply(key, value); }}
        disabled={!key}
        style={{
          fontSize: 12,
          padding: '2px 10px',
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
          padding: '2px 10px',
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
  );
}

// Grouped permission-picker по реальному каталогу GET /v1/permissions (ADR-042):
// resource → actions, оператор отмечает чекбоксы. Первым в группе — action-wildcard
// `resource.*` («все действия», в т.ч. будущие); при нём индивидуальные чекбоксы
// глушатся (право покрывает всё). При наличии selector_keys — опциональный
// scope-пикер (key=value), для группы — bulk-scope. Полное право =
// `resource.action` | `resource.*` | `… on key=value`. Права вне каталога
// (full `*`, legacy) — read-only чипы.
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

  // Черновики bulk-scope пикеров, keyed by resource — переживают размонтирование
  // BulkScopeBar (когда отмеченных <2), чтобы не терять недоприменённый ввод.
  const [bulkDrafts, setBulkDrafts] = useState<Map<string, { key: string; value: string }>>(
    new Map(),
  );

  const catalogBases = new Set<string>();
  const catalogResources = new Set<string>();
  for (const res of catalog) {
    catalogResources.add(res.resource);
    for (const act of (res.actions ?? [])) catalogBases.add(`${res.resource}.${act.action}`);
  }

  // Право «представимо» редактором = действие каталога или action-wildcard
  // `resource.*` известного ресурса. endsWith('.*') (не split по первой точке)
  // корректен и для ресурсов с точкой в имени.
  const isResourceWildcard = (base: string) =>
    base.endsWith('.*') && catalogResources.has(base.slice(0, -2));
  const isRepresentable = (base: string) => catalogBases.has(base) || isResourceWildcard(base);

  // Сколько раз база встречается в value. База с одним вхождением редактируется
  // галкой+scope; та же база с ДВУМЯ разными scope (`incarnation.* on service=…`
  // и `on coven=…`) не влезает в единственный ScopeState — такие оставляем
  // verbatim в preserved, чтобы не потерять грант при replace-save.
  const baseCounts = new Map<string, number>();
  for (const perm of value) {
    const { base } = parsePermission(perm);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  const isAdopted = (base: string) => isRepresentable(base) && baseCounts.get(base) === 1;

  // selected: базы под управлением чекбоксов (представимы и уникальны).
  const selected = new Set<string>();
  for (const perm of value) {
    const { base } = parsePermission(perm);
    if (isAdopted(base)) selected.add(base);
  }

  // preserved: всё, что редактор не адаптировал — round-trip verbatim (full `*`,
  // legacy/unknown, дубли одной базы с разными scope). buildValue не перечисляет
  // их через selected → нет двойной эмиссии.
  const preserved = value.filter((p) => !isAdopted(parsePermission(p).base));

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

  // Wildcard `resource.*` — «все действия». Включение снимает индивидуальные
  // действия ресурса из набора (они покрыты) → результат `["resource.*"]`, а не
  // перечисление. Выключение оставляет группу пустой (переотметит оператор).
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

  // Bulk: применить общий scope key=value ко всем отмеченным действиям группы,
  // поддерживающим этот ключ. Пустое value → снять scope у затронутых.
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

  return (
    <div aria-label={ariaLabel}>
      {catalog.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('admin:rbacPermCatalogEmpty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {catalog.map((res) => {
            const wildcardBase = `${res.resource}.*`;
            const wildcardId = `${groupId}-${wildcardBase}`;
            const wildcardOn = selected.has(wildcardBase);
            const unionKeys = unionSelectorKeys(res);
            const wildcardScope = scopeStates.get(wildcardBase) ?? null;
            // catalog-drift: если сохранённый scope-ключ wildcard вне union —
            // добавить его в опции, чтобы значение осталось видимым/редактируемым.
            const wildcardKeys =
              wildcardScope?.key && !unionKeys.includes(wildcardScope.key)
                ? [...unionKeys, wildcardScope.key]
                : unionKeys;
            const selectedActions = (res.actions ?? []).filter(
              (act) => selected.has(`${res.resource}.${act.action}`),
            ).length;
            const showBulk = !wildcardOn && selectedActions >= 2 && unionKeys.length > 0;

            return (
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

              {/* Action-wildcard: все действия ресурса, включая будущие. */}
              <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
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
                    {t('admin:rbacAllActions')}
                  </span>
                  {wildcardOn && wildcardScope?.key && wildcardScope.value ? (
                    <ScopeBadge scopeKey={wildcardScope.key} scopeValues={[wildcardScope.value]} />
                  ) : null}
                </label>
                {wildcardOn && wildcardKeys.length > 0 ? (
                  <ScopePicker
                    selectorKeys={wildcardKeys}
                    scope={wildcardScope}
                    onChange={(s) => updateScope(wildcardBase, s)}
                  />
                ) : null}
              </div>

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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: wildcardOn ? 0.5 : 1 }}>
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
                          cursor: wildcardOn ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <input
                          id={id}
                          type="checkbox"
                          checked={isChecked}
                          disabled={wildcardOn}
                          title={wildcardOn ? t('admin:rbacAllActionsCovers') : undefined}
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
                      {isChecked && !wildcardOn && hasSelectorKeys ? (
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
            );
          })}
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
