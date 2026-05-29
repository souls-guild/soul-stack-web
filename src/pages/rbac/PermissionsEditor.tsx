import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { validatePermission } from './schemas';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  catalog: readonly string[];
  placeholder?: string;
  ariaLabel?: string;
}

// Permission-input: input с <datalist> autocomplete + chips удалённого
// permission. Enter / запятая / пробел добавляет токен. Catalog — список
// известных permissions для подсказки (buildPermissionCatalog).
export function PermissionsEditor({ value, onChange, catalog, placeholder, ariaLabel }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const listId = useId();

  function tryAdd(raw: string) {
    const token = raw.trim();
    if (!token) return false;
    if (value.includes(token)) {
      setErr(t('admin:rbacPermDuplicate'));
      return false;
    }
    const reasonKey = validatePermission(token);
    if (reasonKey) {
      setErr(t(reasonKey));
      return false;
    }
    onChange([...value, token]);
    setErr(null);
    return true;
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (draft.trim()) {
        e.preventDefault();
        if (tryAdd(draft)) setDraft('');
      }
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div>
      <div
        aria-label={ariaLabel}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: 6,
          border: `1px solid ${err ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          minHeight: 38,
          alignItems: 'center',
        }}
      >
        {value.map((perm) => (
          <span
            key={perm}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px 2px 8px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            {perm}
            <button
              type="button"
              aria-label={t('admin:rbacPermRemoveAria', { perm })}
              onClick={() => onChange(value.filter((p) => p !== perm))}
              style={{
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 0,
                display: 'inline-flex',
              }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          type="text"
          list={listId}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onKeyDown={onKey}
          onBlur={() => { if (draft.trim()) { if (tryAdd(draft)) setDraft(''); } }}
          placeholder={value.length === 0 ? placeholder : ''}
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 160,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            padding: '4px 6px',
          }}
        />
        <datalist id={listId}>
          {catalog
            .filter((p) => !value.includes(p))
            .map((p) => <option key={p} value={p} />)}
        </datalist>
      </div>
      {err ? (
        <span style={{ color: 'var(--danger)', fontSize: 12, display: 'block', marginTop: 4 }}>
          {err}
        </span>
      ) : null}
    </div>
  );
}
