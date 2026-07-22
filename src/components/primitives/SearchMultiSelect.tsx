import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import styles from './SearchMultiSelect.module.css';

// Generic typeahead multi-select with chips. Two data-source modes:
//  - items    - static catalog, filtered client-side (roles).
//  - search   - async function, debounce + react-query inside (archons, server-side).
// Selection is emitted as a list of keys (getKey); labels are cached so a chip
// still renders correctly even when the item drops out of the current server result.
export interface SearchMultiSelectProps<T> {
  /** Static catalog (client-filter). Mutually exclusive with search. */
  items?: T[];
  /** Async server search (debounce inside). Mutually exclusive with items. */
  search?: (q: string) => Promise<T[]>;
  /** Base react-query cache key for search mode: final = [...queryKey, debouncedQ]. */
  queryKey?: readonly unknown[];
  /** Query gate in search mode (e.g. whether the modal is open). */
  enabled?: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSublabel?: (item: T) => string | undefined;
  placeholder?: string;
  /** Minimum string length before request/filter (default 0). */
  minChars?: number;
  /** External loading flag for items-mode. */
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
    // getKey deliberately excluded - it doesn't affect filtering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, serverQ.data, items, debounced, meetsMin]);

  const isLoading = search ? serverQ.isFetching && meetsMin : Boolean(loading);

  // Key->label cache: a chip must still render even if the item drops out of the result.
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
      // preventDefault: don't let Enter submit the parent form.
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
