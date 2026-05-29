import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  // Опциональный валидатор: вернёт текст ошибки, либо null если ок.
  validate?: (token: string) => string | null;
  ariaLabel?: string;
}

// Tags-input: Enter / запятая / пробел добавляет токен, Backspace в пустом — удаляет последний.
export function ChipsInput({ value, onChange, placeholder, validate, ariaLabel }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function tryAdd(raw: string) {
    const tok = raw.trim();
    if (!tok) return false;
    if (value.includes(tok)) {
      setErr(t('incarnations:chipExists'));
      return false;
    }
    if (validate) {
      const reason = validate(tok);
      if (reason) {
        setErr(reason);
        return false;
      }
    }
    onChange([...value, tok]);
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
        {value.map((tag) => (
          <span
            key={tag}
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
            {tag}
            <button
              type="button"
              aria-label={t('incarnations:chipRemove', { tag })}
              onClick={() => onChange(value.filter((x) => x !== tag))}
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
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onKeyDown={onKey}
          onBlur={() => { if (draft.trim()) { if (tryAdd(draft)) setDraft(''); } }}
          placeholder={value.length === 0 ? placeholder : ''}
          style={{
            flex: 1,
            minWidth: 120,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            padding: '4px 6px',
          }}
        />
      </div>
      {err ? (
        <span style={{ color: 'var(--danger)', fontSize: 12, display: 'block', marginTop: 4 }}>
          {err}
        </span>
      ) : null}
    </div>
  );
}
