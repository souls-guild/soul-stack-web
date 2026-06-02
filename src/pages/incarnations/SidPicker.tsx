// SidPicker — autocomplete-поле для выбора SID(ов) с дебаунсом и form-prep.
// ADR-045 S4: format:sid (single) / type:array+format:sid (multi).
//
// Если incarnationContext не задан (свободный Command без incarnation) —
// деградирует в text-input без автокомплита (graceful fallback, не падает).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keeperApi } from '../../api/keeper';
import type { ModuleFormPrepRequest, ModuleInputSource } from '../../api/keeper';

export interface SidPickerProps {
  /** Текущее значение. Single: строка. Multi: JSON-массив строк в сыром виде. */
  value: string | undefined;
  onChange: (v: string) => void;
  /** source из ModuleParam — описывает, откуда брать SID-ы (incarnation_hosts/choir). */
  source?: ModuleInputSource;
  /** Имя incarnation из контекста wizard (для incarnation_hosts source). */
  incarnationContext?: string;
  /** Имя choir (если source.choir задан и нужен choir-контекст). */
  choirName?: string;
  /** Имя модуля (нужно для form-prep URL). */
  moduleName: string;
  multi?: boolean;
  required?: boolean;
  missing?: boolean;
  disabled?: boolean;
}

const DEBOUNCE_MS = 300;

export function SidPicker({
  value,
  onChange,
  source,
  incarnationContext,
  choirName,
  moduleName,
  multi = false,
  missing = false,
  disabled = false,
}: SidPickerProps) {
  const { t } = useTranslation('run');
  const [prefix, setPrefix] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Текущий multi-список: парсим из raw-JSON-массива.
  const multiValues: string[] = multi ? parseMulti(value) : [];

  // source задаёт привязку к инкарнации/choir — единый источник истины для обеих веток ниже.
  const hasSource = Boolean(source?.incarnation_hosts || source?.choir);

  // Есть ли у нас контекст для form-prep.
  const hasContext = Boolean(incarnationContext && hasSource);

  // Строим body source для form-prep.
  function buildFormPrepSource(): ModuleFormPrepRequest['source'] {
    if (source?.choir && incarnationContext && choirName) {
      return { choir: { incarnation: incarnationContext, name: choirName } };
    }
    // incarnation_hosts — имя инкарнации строкой.
    return { incarnation_hosts: incarnationContext ?? '' };
  }

  useEffect(() => {
    if (!hasContext || !open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      keeperApi.modules
        .formPrep(moduleName, { source: buildFormPrepSource(), prefix: prefix || undefined })
        .then((r) => {
          setSuggestions(r.sids ?? []);
          setTruncated(r.truncated ?? false);
        })
        .catch(() => {
          setSuggestions([]);
          setTruncated(false);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, open, hasContext, incarnationContext, moduleName]);

  // Закрыть dropdown при клике вне.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const baseStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    border: `1px solid ${missing ? 'var(--danger)' : 'var(--border)'}`,
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  };

  // Source задан, но нет incarnationContext (свободный command-прогон).
  // Text-ввод здесь бесполезен — backend не сможет резолвить произвольный SID
  // для source:choir/incarnation_hosts без привязки к инкарнации.
  // Показываем понятное пояснение вместо вводимого поля.
  if (!hasContext && hasSource) {
    const hintKey = source?.choir
      ? 'sidPickerNoContextChoir'
      : 'sidPickerNoContextIncarnationHosts';
    return (
      <div
        data-testid="sid-picker-no-context"
        style={{
          padding: '8px 10px',
          borderRadius: 'var(--radius)',
          border: `1px solid ${missing ? 'var(--danger)' : 'var(--border)'}`,
          background: 'var(--surface-raised)',
          fontSize: 13,
          color: 'var(--text-muted)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {t(hintKey)}
      </div>
    );
  }

  // Нет source (обычное поле sid без source) — легитимный text-ввод.
  if (!hasContext) {
    return (
      <div>
        <input
          type="text"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('sidPickerFallbackHint')}
          disabled={disabled}
          style={baseStyle}
        />
      </div>
    );
  }

  function selectSid(sid: string) {
    if (multi) {
      const next = multiValues.includes(sid) ? multiValues : [...multiValues, sid];
      onChange(JSON.stringify(next));
    } else {
      onChange(sid);
      setOpen(false);
    }
    setPrefix('');
  }

  function removeSid(sid: string) {
    const next = multiValues.filter((s) => s !== sid);
    onChange(JSON.stringify(next));
  }

  if (multi) {
    return (
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {multiValues.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {multiValues.map((sid) => (
              <span
                key={sid}
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '2px 8px',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {sid}
                <button
                  type="button"
                  aria-label={t('sidPickerRemove')}
                  onClick={() => removeSid(sid)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={prefix}
            onChange={(e) => { setPrefix(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={t('sidPickerPlaceholder')}
            disabled={disabled}
            style={{ ...baseStyle, border: `1px solid ${missing && multiValues.length === 0 ? 'var(--danger)' : 'var(--border)'}` }}
          />
          <SuggestionDropdown
            open={open}
            loading={loading}
            suggestions={suggestions}
            truncated={truncated}
            selected={multiValues}
            onSelect={selectSid}
            t={t}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={open ? prefix : (value ?? '')}
        onChange={(e) => { setPrefix(e.target.value); setOpen(true); }}
        onFocus={() => { setPrefix(value ?? ''); setOpen(true); }}
        onBlur={() => {
          // Небольшая задержка, чтобы успел сработать клик по пункту.
          setTimeout(() => setOpen(false), 150);
        }}
        placeholder={t('sidPickerPlaceholder')}
        disabled={disabled}
        style={baseStyle}
        data-testid="sid-picker-input"
      />
      <SuggestionDropdown
        open={open}
        loading={loading}
        suggestions={suggestions}
        truncated={truncated}
        selected={value ? [value] : []}
        onSelect={selectSid}
        t={t}
      />
    </div>
  );
}

function SuggestionDropdown({
  open,
  loading,
  suggestions,
  truncated,
  selected,
  onSelect,
  t,
}: {
  open: boolean;
  loading: boolean;
  suggestions: string[];
  truncated: boolean;
  selected: string[];
  onSelect: (s: string) => void;
  t: (key: string) => string;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        zIndex: 100,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        maxHeight: 200,
        overflowY: 'auto',
      }}
    >
      {loading ? (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          {t('sidPickerLoading')}
        </div>
      ) : suggestions.length === 0 ? (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-faint)' }}>
          {t('sidPickerNoResults')}
        </div>
      ) : (
        suggestions.map((sid) => (
          <div
            key={sid}
            onMouseDown={(e) => { e.preventDefault(); onSelect(sid); }}
            style={{
              padding: '7px 12px',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              background: selected.includes(sid) ? 'var(--surface-raised)' : undefined,
              color: 'var(--text)',
            }}
            data-testid={`sid-option-${sid}`}
          >
            {sid}
          </div>
        ))
      )}
      {truncated ? (
        <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--border)' }}>
          {t('sidPickerTruncated')}
        </div>
      ) : null}
    </div>
  );
}

function parseMulti(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // noop
  }
  return [];
}
