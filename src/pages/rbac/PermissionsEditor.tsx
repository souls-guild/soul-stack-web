import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { PermissionResource } from '../../api/keeper';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  catalog: readonly PermissionResource[];
  ariaLabel?: string;
}

// Grouped permission-picker по реальному каталогу GET /v1/permissions (ADR-042):
// resource → actions, оператор отмечает чекбоксы. Полное право = `resource.action`
// (напр. soul.list, incarnation.run) — раньше тут был free-text input с хардкод-
// списком, из-за чего слался несуществующий soul.read → unknown_permission.
// Права из value, которых нет в каталоге (wildcard `*`, `incarnation.*`, legacy),
// сохраняются read-only чипами, чтобы replace-семантика PATCH их не теряла.
export function PermissionsEditor({ value, onChange, catalog, ariaLabel }: Props) {
  const { t } = useTranslation();
  const groupId = useId();

  const selected = new Set(value);
  const catalogPerms = new Set<string>();
  for (const res of catalog) {
    for (const act of res.actions) catalogPerms.add(`${res.resource}.${act.action}`);
  }
  // Права, которые каталог не покрывает (включая wildcard) — не теряем при save.
  const preserved = value.filter((p) => !catalogPerms.has(p));

  function toggle(perm: string, on: boolean) {
    if (on) {
      if (!selected.has(perm)) onChange([...value, perm]);
    } else {
      onChange(value.filter((p) => p !== perm));
    }
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                {res.actions.map((act) => {
                  const perm = `${res.resource}.${act.action}`;
                  const id = `${groupId}-${perm}`;
                  return (
                    <label
                      key={perm}
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
                        checked={selected.has(perm)}
                        onChange={(e) => toggle(perm, e.target.checked)}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      {perm}
                    </label>
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
            {preserved.map((perm) => (
              <span
                key={perm}
                className="mono"
                style={{
                  padding: '2px 8px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  fontSize: 12,
                }}
              >
                {perm}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
