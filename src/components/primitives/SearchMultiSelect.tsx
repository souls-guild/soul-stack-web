import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import styles from './SearchMultiSelect.module.css';

// Универсальный typeahead multi-select с чипами. Два режима источника данных:
//  • items    — статический каталог, фильтруется на клиенте (roles).
//  • search   — async-функция, дебаунс + react-query внутри (archons, server-side).
// Выбор отдаётся как список ключей (getKey); лейблы кэшируются, чтобы чип
// корректно рисовался, даже когда элемент выпал из текущей серверной выдачи.
export interface SearchMultiSelectProps<T> {
  /** Статический каталог (client-filter). Взаимоисключимо с search. */
  items?: T[];
  /** Async серверный поиск (debounce внутри). Взаимоисключимо с items. */
  search?: (q: string) => Promise<T[]>;
  /** База кэш-ключа react-query для search-режима: итог = [...queryKey, debouncedQ]. */
  queryKey?: readonly unknown[];
  /** Гейт запроса в search-режиме (напр. открытость модалки). */
  enabled?: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSublabel?: (item: T) => string | undefined;
  placeholder?: string;
  /** Порог длины строки до запроса/фильтра (default 0). */
  minChars?: number;
  /** Внешний loading для items-режима. */
  loading?: boolean;
  emptyText: string;
  disabled?: boolean;
  testidPrefix: string;
  debounceMs?: number;
}

export function SearchMultiSelect<T>({
  items,
  search,
  queryKey,
  enabled = true,
  selected,
  onChange,
  getKey,
  getLabel,
  getSublabel,
  placeholder,
  minChars = 0,
  loading,
  emptyText,
  disabled = false,
  testidPrefix,
  debounceMs = 250,
}: SearchMultiSelectProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), debounceMs);
    return () => clearTimeout(id);
  }, [query, debounceMs]);

  const meetsMin = debounced.trim().length >= minChars;

  const serverQ = useQuery({
    queryKey: [...(queryKey ?? [testidPrefix, 'search']), debounced.trim()],
    queryFn: () => search!(debounced.trim()),
    enabled: Boolean(search) && enabled && meetsMin,
    placeholderData: keepPreviousData,
  });

  const options = useMemo<T[]>(() => {
    if (search) return meetsMin ? serverQ.data ?? [] : [];
    const base = items ?? [];
    const needle = debounced.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((it) => {
      const label = getLabel(it).toLowerCase();
      const sub = (getSublabel?.(it) ?? '').toLowerCase();
      return label.includes(needle) || sub.includes(needle);
    });
    // getKey исключён намеренно — не влияет на фильтрацию.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, serverQ.data, items, debounced, meetsMin]);

  const isLoading = search ? serverQ.isFetching && meetsMin : Boolean(loading);

  // Кэш ключ→лейбл: чип должен рисоваться, даже если элемент выпал из выдачи.
  const labelCache = useRef(new Map<string, string>());
  for (const it of options) labelCache.current.set(getKey(it), getLabel(it));
  const chipLabel = (key: string) => labelCache.current.get(key) ?? key;

  useEffect(() => {
    setActive(0);
  }, [debounced, open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(item: T) {
    const key = getKey(item);
    if (selectedSet.has(key)) onChange(selected.filter((k) => k !== key));
    else onChange([...selected, key]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // preventDefault: не даём submit-нуть родительскую форму по Enter.
      e.preventDefault();
      if (open && options[active]) toggle(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      {selected.length > 0 ? (
        <div className={styles.chips} aria-label="selected">
          {selected.map((key) => (
            <span key={key} className={styles.chip} data-testid={`${testidPrefix}-chip-${key}`}>
              <span className="mono">{chipLabel(key)}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`${t('remove')} ${chipLabel(key)}`}
                title={`${t('remove')} ${chipLabel(key)}`}
                onClick={() => onChange(selected.filter((k) => k !== key))}
                disabled={disabled}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.control}>
        <Search size={14} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.searchInput}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${testidPrefix}-listbox`}
          aria-autocomplete="list"
          data-testid={`${testidPrefix}-search`}
        />
      </div>

      {open ? (
        <div
          className={styles.dropdown}
          role="listbox"
          id={`${testidPrefix}-listbox`}
          aria-label={placeholder}
        >
          {isLoading ? (
            <div className={styles.msg}>{t('loading')}</div>
          ) : options.length === 0 ? (
            <div className={styles.msg} data-testid={`${testidPrefix}-empty`}>
              {emptyText}
            </div>
          ) : (
            options.map((it, i) => {
              const key = getKey(it);
              const isSel = selectedSet.has(key);
              const label = getLabel(it);
              const sub = getSublabel?.(it);
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  className={`${styles.option} ${i === active ? styles.optionActive : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(it)}
                  data-testid={`${testidPrefix}-option-${key}`}
                >
                  <span className={styles.optCheck}>{isSel ? <Check size={13} /> : null}</span>
                  <span className={styles.optLabel}>{label}</span>
                  {sub && sub !== label ? <span className={styles.optSub}>{sub}</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
