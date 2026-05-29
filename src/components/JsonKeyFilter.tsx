import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './JsonKeyFilter.module.css';

interface Props {
  value: unknown;
  emptyLabel?: string;
  // Если top-level — объект, рендерим как разворачиваемый list ключей с фильтром.
  // Иначе (массив, скаляр, null) — фолбэк на pretty-JSON одним блоком.
}

interface Entry {
  key: string;
  raw: unknown;
  preview: string;
  kind: string;
}

function describe(v: unknown): { preview: string; kind: string } {
  if (v === null) return { preview: 'null', kind: 'null' };
  if (typeof v === 'boolean') return { preview: String(v), kind: 'bool' };
  if (typeof v === 'number') return { preview: String(v), kind: 'number' };
  if (typeof v === 'string') {
    const s = v.length > 60 ? `${v.slice(0, 60)}…` : v;
    return { preview: `"${s}"`, kind: 'string' };
  }
  if (Array.isArray(v)) return { preview: `array[${v.length}]`, kind: 'array' };
  if (typeof v === 'object') {
    const n = Object.keys(v as object).length;
    return { preview: `object{${n}}`, kind: 'object' };
  }
  return { preview: String(v), kind: typeof v };
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className={styles.entryKeyHi}>{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

export function JsonKeyFilter({ value, emptyLabel }: Props) {
  const { t } = useTranslation();
  const resolvedEmpty = emptyLabel ?? t('incarnations:jsonEmpty');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const entries: Entry[] = useMemo(() => {
    if (!isPlainObject) return [];
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => {
        const raw = obj[k];
        const { preview, kind } = describe(raw);
        return { key: k, raw, preview, kind };
      });
  }, [value, isPlainObject]);

  const filtered = useMemo(() => {
    if (!q.trim()) return entries;
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => e.key.toLowerCase().includes(needle));
  }, [entries, q]);

  if (value === null || value === undefined) {
    return <div className={styles.empty}>{resolvedEmpty}</div>;
  }
  if (isPlainObject && entries.length === 0) {
    return <div className={styles.empty}>{resolvedEmpty}</div>;
  }
  if (!isPlainObject) {
    // Массив или скаляр — рендерим как обычный JSON-блок.
    return (
      <div className={styles.entry}>
        <pre>{stringify(value)}</pre>
      </div>
    );
  }

  const toggle = (k: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.searchRow}>
        <input
          type="text"
          placeholder={t('incarnations:filterByKeys')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={styles.searchInput}
          aria-label={t('incarnations:filterByKeysAria')}
        />
        <span className={styles.counter}>
          {filtered.length} / {entries.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className={styles.empty}>{t('incarnations:filterNothing', { q })}</div>
      ) : (
        <div className={styles.list}>
          {filtered.map((e) => {
            const isOpen = open.has(e.key);
            return (
              <div key={e.key} className={styles.entry}>
                <div
                  className={styles.entryHead}
                  onClick={() => toggle(e.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      toggle(e.key);
                    }
                  }}
                  aria-expanded={isOpen}
                >
                  <span className={styles.entryKey}>
                    <span aria-hidden="true" style={{ marginRight: 4, color: 'var(--text-faint)' }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <span>{highlight(e.key, q)}</span>
                  </span>
                  <span className={styles.entryMeta}>
                    {e.kind} · {e.preview}
                  </span>
                </div>
                {isOpen ? (
                  <div className={styles.entryBody}>
                    <pre>{stringify(e.raw)}</pre>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
