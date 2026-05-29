import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Search, Check } from 'lucide-react';
import { keeperApi } from '../../api/keeper';
import type { ModuleCatalogItem } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/primitives';
import styles from './ModulePicker.module.css';
import wizard from './WizardSteps.module.css';

// Searchable combobox над каталогом модулей (GET /v1/modules). Заменяет
// free-text «custom module» в Run→Command. Фильтр по name + description.
// На выбор отдаёт полную запись каталога — caller сам разруливает state-суффикс
// и params-форму. На 404/501 (старый Keeper без endpoint-а) — graceful fallback:
// поле деградирует к free-text (callback onUnavailable).

interface Props {
  // Текущее выбранное имя модуля (без state-суффикса), напр. `core.cmd`.
  value: string;
  onSelect: (item: ModuleCatalogItem) => void;
  // Фильтр каталога: только errand-safe модули (Run→Command whitelist).
  errandSafe?: boolean;
  // Вызывается, когда endpoint недоступен (404/501) — caller включает free-text.
  onUnavailable?: () => void;
}

function isOptionalMiss(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

export function ModulePicker({ value, onSelect, errandSafe, onUnavailable }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const catalogQ = useQuery({
    queryKey: ['modules.catalog', errandSafe ?? false],
    queryFn: () => keeperApi.modules.list({ errand_safe: errandSafe }),
    retry: false,
  });

  const unavailable = catalogQ.error ? isOptionalMiss(catalogQ.error) : false;
  useEffect(() => {
    if (unavailable) onUnavailable?.();
  }, [unavailable, onUnavailable]);

  const items = useMemo<ModuleCatalogItem[]>(() => catalogQ.data?.items ?? [], [catalogQ.data]);
  const selected = useMemo(() => items.find((m) => m.name === value), [items, value]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.description ?? '').toLowerCase().includes(needle),
    );
  }, [items, query]);

  // Закрытие dropdown по клику вне.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (catalogQ.error && !unavailable) {
    return (
      <div className={wizard.warn} role="alert">
        {catalogQ.error instanceof ApiError
          ? t('run:moduleCatalogError', { status: catalogQ.error.status })
          : String(catalogQ.error)}
      </div>
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.control}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Module search"
        data-testid="module-picker-control"
      >
        <Search size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        {selected ? (
          <span className={styles.selectedRow}>
            <span className="mono">{selected.name}</span>
            <Badge tone={selected.kind === 'core' ? 'muted' : 'info'}>{selected.kind}</Badge>
            {selected.description ? (
              <span className={styles.selectedDesc}>{selected.description}</span>
            ) : null}
          </span>
        ) : (
          <span className={styles.placeholder}>
            {catalogQ.isLoading ? t('loading') : t('run:moduleSearchPlaceholder')}
          </span>
        )}
      </button>

      {open ? (
        <div className={styles.dropdown} role="listbox" aria-label="Module catalog">
          <input
            type="text"
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('run:moduleSearchInputPlaceholder')}
            aria-label="Module search query"
            autoFocus
            data-testid="module-picker-search"
          />
          <div className={styles.options}>
            {filtered.length === 0 ? (
              <div className={styles.empty}>
                {items.length === 0 ? t('run:moduleCatalogEmpty') : t('run:moduleSearchNoMatch')}
              </div>
            ) : (
              filtered.map((m) => {
                const active = m.name === value;
                return (
                  <button
                    key={m.name}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`${styles.option} ${active ? styles.optionActive : ''}`}
                    onClick={() => {
                      onSelect(m);
                      setOpen(false);
                      setQuery('');
                    }}
                    data-testid={`module-option-${m.name}`}
                  >
                    <span className={styles.optIcon}>{active ? <Check size={13} /> : null}</span>
                    <span className="mono">{m.name}</span>
                    <Badge tone={m.kind === 'core' ? 'muted' : 'info'}>{m.kind}</Badge>
                    {m.description ? (
                      <span className={styles.optDesc}>{m.description}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
