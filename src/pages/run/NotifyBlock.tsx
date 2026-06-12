/**
 * Блок «Уведомления о прогоне» для Step 4 RunWizard (разовые notify[]).
 * Каждый элемент — VoyageNotify (herald + on + only_failures/only_changes + annotations + projection).
 * Разовые правила живут только для этого прогона; постоянные — Tidings (/notifications).
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import type { VoyageNotify, VoyageNotifyOn } from '../../api/keeper';
import { Button } from '../../components/primitives';
import styles from './WizardSteps.module.css';

// Значение по умолчанию для нового notify-элемента.
const DEFAULT_NOTIFY: VoyageNotify = {
  herald: '',
  on: [],
  only_failures: false,
  only_changes: false,
  annotations: undefined,
  projection: [],
};

const ON_OPTIONS: VoyageNotifyOn[] = ['completed', 'failed', 'partial'];

interface KeyValue {
  key: string;
  value: string;
}

// Вспомогательный редактор key-value для annotations.
function KVEditor({
  pairs,
  onChange,
}: {
  pairs: KeyValue[];
  onChange: (next: KeyValue[]) => void;
}) {
  const { t } = useTranslation();
  function updateKey(i: number, k: string) {
    const n = pairs.map((p, idx) => (idx === i ? { ...p, key: k } : p));
    onChange(n);
  }
  function updateVal(i: number, v: string) {
    const n = pairs.map((p, idx) => (idx === i ? { ...p, value: v } : p));
    onChange(n);
  }
  function remove(i: number) {
    onChange(pairs.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...pairs, { key: '', value: '' }]);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={p.key}
            onChange={(e) => updateKey(i, e.target.value)}
            placeholder="key"
            aria-label={`annotation key ${i}`}
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          />
          <span style={{ color: 'var(--text-muted)' }}>=</span>
          <input
            type="text"
            value={p.value}
            onChange={(e) => updateVal(i, e.target.value)}
            placeholder="value"
            aria-label={`annotation value ${i}`}
            style={{
              flex: 2,
              padding: '4px 8px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => remove(i)}
            aria-label={`remove annotation ${i}`}
            style={{ padding: '2px 6px' }}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={add}
        data-testid="notify-annotation-add"
        style={{ alignSelf: 'flex-start', fontSize: 12, padding: '2px 8px' }}
      >
        <Plus size={12} /> {t('run:notifyAnnotationAddBtn')}
      </Button>
    </div>
  );
}

// Вспомогательный редактор списка строк (projection paths).
function ProjectionEditor({
  paths,
  onChange,
}: {
  paths: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  function update(i: number, v: string) {
    const n = paths.map((p, idx) => (idx === i ? v : p));
    onChange(n);
  }
  function remove(i: number) {
    onChange(paths.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...paths, '']);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {paths.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={p}
            onChange={(e) => update(i, e.target.value)}
            placeholder={t('run:notifyProjectionPlaceholder')}
            aria-label={`projection path ${i}`}
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => remove(i)}
            aria-label={`remove projection path ${i}`}
            style={{ padding: '2px 6px' }}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={add}
        data-testid="notify-projection-add"
        style={{ alignSelf: 'flex-start', fontSize: 12, padding: '2px 8px' }}
      >
        <Plus size={12} /> {t('run:notifyProjectionAddBtn')}
      </Button>
    </div>
  );
}

// Конвертация VoyageNotify.annotations (Record<string,unknown> | undefined) ↔ KeyValue[].
function annotationsToKV(ann: Record<string, unknown> | undefined): KeyValue[] {
  if (!ann) return [];
  return Object.entries(ann).map(([key, value]) => ({ key, value: String(value) }));
}
function kvToAnnotations(pairs: KeyValue[]): Record<string, string> | undefined {
  const valid = pairs.filter((p) => p.key.trim());
  if (!valid.length) return undefined;
  return Object.fromEntries(valid.map((p) => [p.key.trim(), p.value]));
}

// Один notify-элемент (collapsed/expanded редактор).
function NotifyItem({
  index,
  value,
  onChange,
  onRemove,
  heraldItems,
}: {
  index: number;
  value: VoyageNotify;
  onChange: (next: VoyageNotify) => void;
  onRemove: () => void;
  heraldItems: Array<{ name: string }>;
}) {
  const { t } = useTranslation();

  // Локальный state для пар ключ-значение аннотаций.
  // Нельзя вычислять из value.annotations при каждом рендере:
  // kvToAnnotations отбрасывает пустые ключи → новая строка исчезает сразу после добавления.
  const [kvPairs, setKvPairs] = useState<KeyValue[]>(() =>
    annotationsToKV(value.annotations as Record<string, unknown> | undefined),
  );

  // Синхронизируем локальный state при внешней смене value.annotations
  // (например, при сбросе формы), но не при каждом onChange от самого редактора.
  const annotationsKey = JSON.stringify(value.annotations);
  useEffect(() => {
    setKvPairs(annotationsToKV(value.annotations as Record<string, unknown> | undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsKey]);

  function toggleOn(opt: VoyageNotifyOn) {
    const cur = value.on ?? [];
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
    onChange({ ...value, on: next });
  }

  function onKVChange(pairs: KeyValue[]) {
    setKvPairs(pairs);
    onChange({ ...value, annotations: kvToAnnotations(pairs) });
  }

  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div
      data-testid={`notify-item-${index}`}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Herald select */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className={styles.fieldLabel} style={{ minWidth: 90 }}>
          {t('run:notifyHeraldLabel')}
        </span>
        {heraldItems.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('run:notifyNoHeralds')}{' '}
            <Link to="/notifications" style={{ fontSize: 12 }}>
              {t('run:notifyCreateHeraldLink')}
            </Link>
          </span>
        ) : (
          <select
            value={value.herald}
            onChange={(e) => onChange({ ...value, herald: e.target.value })}
            required
            data-testid={`notify-herald-select-${index}`}
            style={{
              flex: 1,
              padding: '5px 8px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              fontSize: 13,
            }}
          >
            <option value="">{t('run:notifyHeraldPlaceholder')}</option>
            {heraldItems.map((h) => (
              <option key={h.name} value={h.name}>
                {h.name}
              </option>
            ))}
          </select>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={onRemove}
          aria-label={`remove notify ${index}`}
          data-testid={`notify-remove-${index}`}
          style={{ padding: '2px 6px', marginLeft: 'auto' }}
        >
          <Trash2 size={13} />
        </Button>
      </div>

      {/* on[] мультивыбор */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 90 }}>
          {t('run:notifyOnLabel')}
        </span>
        {ON_OPTIONS.map((opt) => {
          const selected = (value.on ?? []).includes(opt);
          return (
            <button
              key={opt}
              type="button"
              data-testid={`notify-on-${index}-${opt}`}
              onClick={() => toggleOn(opt)}
              aria-pressed={selected}
              style={{
                padding: '2px 10px',
                borderRadius: 'var(--radius-pill)',
                border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                background: selected ? 'var(--accent)' : 'var(--surface)',
                color: selected ? '#fff' : 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {t(`run:notifyOn${opt.charAt(0).toUpperCase() + opt.slice(1)}`)}
            </button>
          );
        })}
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          ({t('run:notifyOnHint')})
        </span>
      </div>

      {/* only_failures / only_changes */}
      <div style={{ display: 'flex', gap: 16 }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={value.only_failures ?? false}
            onChange={(e) => onChange({ ...value, only_failures: e.target.checked })}
            data-testid={`notify-only-failures-${index}`}
          />
          {t('run:notifyOnlyFailures')}
        </label>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={value.only_changes ?? false}
            onChange={(e) => onChange({ ...value, only_changes: e.target.checked })}
            data-testid={`notify-only-changes-${index}`}
          />
          {t('run:notifyOnlyChanges')}
        </label>
      </div>

      {/* Расширенные поля (annotations + projection) — сворачиваемые */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
        aria-expanded={showAdvanced}
        data-testid={`notify-advanced-toggle-${index}`}
      >
        {showAdvanced ? '▼' : '▶'} {t('run:notifyAnnotationsLabel')} / {t('run:notifyProjectionLabel')}
      </button>

      {showAdvanced ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              {t('run:notifyAnnotationsLabel')}
              <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>
                {t('run:notifyAnnotationsHint')}
              </span>
            </div>
            <KVEditor pairs={kvPairs} onChange={onKVChange} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              {t('run:notifyProjectionLabel')}
              <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>
                {t('run:notifyProjectionHint')}
              </span>
            </div>
            <ProjectionEditor
              paths={value.projection ?? []}
              onChange={(paths) => onChange({ ...value, projection: paths })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}


export interface NotifyBlockProps {
  /** Текущий список notify-элементов. */
  value: VoyageNotify[];
  onChange: (next: VoyageNotify[]) => void;
}

/**
 * NotifyBlock — секция «Уведомления о прогоне» в Step 4.
 * Фетчит список Heralds (для select). При пустом списке — ссылка «создать канал».
 */
export function NotifyBlock({ value, onChange }: NotifyBlockProps) {
  const { t } = useTranslation();

  const heraldsQ = useQuery({
    queryKey: ['heralds.list'],
    queryFn: () => keeperApi.heralds.list({ limit: 200 }),
    staleTime: 60_000,
  });
  const heraldItems = heraldsQ.data?.items ?? [];

  function addItem() {
    onChange([...value, { ...DEFAULT_NOTIFY }]);
  }

  function updateItem(i: number, next: VoyageNotify) {
    onChange(value.map((it, idx) => (idx === i ? next : it)));
  }

  function removeItem(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <fieldset
      style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, margin: 0 }}
      data-testid="notify-block"
    >
      <legend style={{ fontSize: 13, color: 'var(--text-muted)', padding: '0 6px' }}>
        {t('run:notifyTitle')}
      </legend>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>
        {t('run:notifySubtitle')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {value.map((item, i) => (
          <NotifyItem
            key={i}
            index={i}
            value={item}
            onChange={(next) => updateItem(i, next)}
            onRemove={() => removeItem(i)}
            heraldItems={heraldItems}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        onClick={addItem}
        data-testid="notify-add-btn"
        style={{ marginTop: value.length > 0 ? 8 : 0, fontSize: 13 }}
      >
        <Plus size={13} /> {t('run:notifyAddBtn')}
      </Button>
    </fieldset>
  );
}

