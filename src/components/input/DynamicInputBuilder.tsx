import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Code, Pencil } from 'lucide-react';
import {
  changeRowType,
  fieldsToObject,
  fieldsToObjectLossy,
  newEmptyRow,
  parseRawJsonToFields,
  type FieldRow,
  type FieldType,
} from './DynamicInputBuilder.helpers';
import i18n from '../../i18n';
import styles from './DynamicInputBuilder.module.css';

interface Props {
  value: Record<string, unknown>;
  // onChange вызывается только когда состояние формы валидно (все ключи
  // непустые, без дубликатов, типы коэрсятся). При невалидности — onChange
  // не вызывается, ошибки рисуются inline.
  onChange: (next: Record<string, unknown>) => void;
  // Опционально показывать toggle «Edit as raw JSON». Default — true.
  allowRawJsonToggle?: boolean;
  ariaLabel?: string;
}

const TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'integer', label: 'integer' },
  { value: 'boolean', label: 'boolean' },
  { value: 'json', label: 'json' },
];

export function DynamicInputBuilder({
  value,
  onChange,
  allowRawJsonToggle = true,
  ariaLabel,
}: Props) {
  const { t } = useTranslation();
  // Локальный state-of-truth — массив FieldRow + флаг raw-режима.
  // Внешний `value` синхронизируется через onChange при валидных изменениях.
  const [rows, setRows] = useState<FieldRow[]>(() => parseRawJsonToFields(value ?? {}));
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState<string>(() => JSON.stringify(value ?? {}, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);

  // Защита от echo: каждый onChange отметим в lastEmittedRef, чтобы внешний
  // re-render с тем же value не сбрасывал локальный rows-state.
  const lastEmittedRef = useRef<string>(JSON.stringify(value ?? {}));

  // Внешний reset (например, смена scenario сбросила input): если приходящий
  // value отличается от последнего emit-а — пересоздаём rows.
  useEffect(() => {
    const incoming = JSON.stringify(value ?? {});
    if (incoming !== lastEmittedRef.current) {
      lastEmittedRef.current = incoming;
      setRows(parseRawJsonToFields(value ?? {}));
      setRawText(JSON.stringify(value ?? {}, null, 2));
      setRawError(null);
    }
  }, [value]);

  const validation = useMemo(() => fieldsToObject(rows), [rows]);

  function emit(next: Record<string, unknown>) {
    const s = JSON.stringify(next);
    lastEmittedRef.current = s;
    onChange(next);
  }

  function updateRows(next: FieldRow[]) {
    setRows(next);
    const v = fieldsToObject(next);
    if (v.result !== null) emit(v.result);
  }

  function addRow() {
    updateRows([...rows, newEmptyRow()]);
  }

  function deleteRow(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    updateRows(next);
  }

  function patchRow(idx: number, patch: Partial<FieldRow>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    updateRows(next);
  }

  function changeType(idx: number, t: FieldType) {
    const next = rows.map((r, i) => (i === idx ? changeRowType(r, t) : r));
    updateRows(next);
  }

  // raw-mode handlers.
  function toggleRawMode() {
    if (!rawMode) {
      // Form → raw: используем lossy-сериализацию, чтобы не терять draft.
      const draft = fieldsToObjectLossy(rows);
      setRawText(JSON.stringify(draft, null, 2));
      setRawError(null);
      setRawMode(true);
      return;
    }
    // Raw → form: парсим текущий rawText.
    const parsed = tryParseRawObject(rawText);
    if (parsed.error) {
      setRawError(parsed.error);
      return;
    }
    const nextRows = parseRawJsonToFields(parsed.value);
    setRows(nextRows);
    setRawError(null);
    setRawMode(false);
    const v = fieldsToObject(nextRows);
    if (v.result !== null) emit(v.result);
  }

  function onRawChange(text: string) {
    setRawText(text);
    const parsed = tryParseRawObject(text);
    if (parsed.error) {
      setRawError(parsed.error);
      return;
    }
    setRawError(null);
    emit(parsed.value);
  }

  return (
    <div className={styles.wrap} aria-label={ariaLabel ?? 'Dynamic input builder'}>
      <div className={styles.toolbar}>
        <span className={styles.hint}>
          {rawMode ? t('run:builderRawHint') : t('run:builderFormHint')}
        </span>
        {allowRawJsonToggle ? (
          <div className={styles.modeRow} role="group" aria-label="Input mode">
            <button
              type="button"
              className={styles.modeBtn}
              aria-pressed={!rawMode}
              onClick={() => {
                if (rawMode) toggleRawMode();
              }}
              title={t('run:builderFormTitle')}
            >
              <Pencil size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              form
            </button>
            <button
              type="button"
              className={styles.modeBtn}
              aria-pressed={rawMode}
              onClick={() => {
                if (!rawMode) toggleRawMode();
              }}
              title={t('run:builderRawTitle')}
            >
              <Code size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              raw JSON
            </button>
          </div>
        ) : null}
      </div>

      {rawMode ? (
        <>
          <textarea
            className={styles.jsonArea}
            value={rawText}
            onChange={(e) => onRawChange(e.target.value)}
            spellCheck={false}
            aria-label="Raw JSON input"
            placeholder="{}"
          />
          {rawError ? <span className={styles.error}>{rawError}</span> : null}
        </>
      ) : (
        <FormView
          rows={rows}
          rowErrors={validation.rowErrors}
          onAddRow={addRow}
          onDeleteRow={deleteRow}
          onPatchRow={patchRow}
          onChangeType={changeType}
        />
      )}

      {!rawMode ? <Preview rows={rows} /> : null}
    </div>
  );
}

interface FormViewProps {
  rows: FieldRow[];
  rowErrors: Array<string | null>;
  onAddRow: () => void;
  onDeleteRow: (idx: number) => void;
  onPatchRow: (idx: number, patch: Partial<FieldRow>) => void;
  onChangeType: (idx: number, t: FieldType) => void;
}

function FormView({
  rows,
  rowErrors,
  onAddRow,
  onDeleteRow,
  onPatchRow,
  onChangeType,
}: FormViewProps) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <span>{t('run:builderEmptyHint')}</span>
        <button type="button" className={styles.addBtn} onClick={onAddRow} aria-label="Add first field">
          <Plus size={12} /> {t('run:builderAddFirstField')}
        </button>
      </div>
    );
  }
  return (
    <>
      <div className={styles.rows} role="list" aria-label="Input fields">
        {rows.map((row, idx) => (
          <RowEditor
            key={row.id}
            row={row}
            error={rowErrors[idx]}
            onKeyChange={(k) => onPatchRow(idx, { key: k })}
            onRawChange={(r) => onPatchRow(idx, { raw: r })}
            onTypeChange={(ty) => onChangeType(idx, ty)}
            onDelete={() => onDeleteRow(idx)}
          />
        ))}
      </div>
      <button type="button" className={styles.addBtn} onClick={onAddRow} aria-label="Add field">
        <Plus size={12} /> {t('run:builderAddField')}
      </button>
    </>
  );
}

interface RowEditorProps {
  row: FieldRow;
  error: string | null;
  onKeyChange: (key: string) => void;
  onRawChange: (raw: string | boolean) => void;
  onTypeChange: (t: FieldType) => void;
  onDelete: () => void;
}

function RowEditor({ row, error, onKeyChange, onRawChange, onTypeChange, onDelete }: RowEditorProps) {
  return (
    <div className={styles.row} role="listitem">
      <input
        type="text"
        className={`${styles.input} ${error ? styles.invalid : ''}`}
        placeholder="key"
        value={row.key}
        onChange={(e) => onKeyChange(e.target.value)}
        aria-label={`field key ${row.id}`}
      />
      <select
        className={styles.input}
        value={row.type}
        onChange={(e) => onTypeChange(e.target.value as FieldType)}
        aria-label={`field type ${row.id}`}
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ValueInput row={row} onRawChange={onRawChange} />
      <button
        type="button"
        className={styles.delBtn}
        onClick={onDelete}
        aria-label={`delete field ${row.id}`}
      >
        <Trash2 size={12} />
      </button>
      {error ? (
        <span className={styles.error} style={{ gridColumn: '1 / -1' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function ValueInput({
  row,
  onRawChange,
}: {
  row: FieldRow;
  onRawChange: (raw: string | boolean) => void;
}) {
  const { t } = useTranslation();
  if (row.type === 'boolean') {
    return (
      <label className={styles.checkboxCell}>
        <input
          type="checkbox"
          checked={Boolean(row.raw)}
          onChange={(e) => onRawChange(e.target.checked)}
          aria-label={`field value ${row.id}`}
        />
      </label>
    );
  }
  if (row.type === 'json') {
    return (
      <textarea
        className={styles.input}
        rows={3}
        value={typeof row.raw === 'string' ? row.raw : ''}
        onChange={(e) => onRawChange(e.target.value)}
        placeholder={t('run:builderJsonPlaceholder')}
        spellCheck={false}
        aria-label={`field value ${row.id}`}
      />
    );
  }
  const inputType = row.type === 'number' || row.type === 'integer' ? 'text' : 'text';
  // type='text' даже для number — чтобы можно было редактировать '-' и '12.';
  // финальный coerce — в helpers.
  return (
    <input
      type={inputType}
      className={styles.input}
      value={typeof row.raw === 'string' ? row.raw : ''}
      onChange={(e) => onRawChange(e.target.value)}
      placeholder={row.type === 'string' ? 'value' : '0'}
      aria-label={`field value ${row.id}`}
    />
  );
}

function Preview({ rows }: { rows: FieldRow[] }) {
  // Lossy preview всегда: показываем «как получится», даже если есть невалидные
  // строки (они окажутся string).
  const obj = useMemo(() => fieldsToObjectLossy(rows), [rows]);
  const text = useMemo(() => JSON.stringify(obj, null, 2), [obj]);
  if (Object.keys(obj).length === 0) return null;
  return (
    <pre className={styles.preview} aria-label="JSON preview">
      {text}
    </pre>
  );
}

function tryParseRawObject(text: string): { value: Record<string, unknown>; error: null } | { value: null; error: string } {
  const t = text.trim();
  if (t === '') return { value: {}, error: null };
  try {
    const parsed = JSON.parse(t);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: i18n.t('run:builderExpectObject') };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? `JSON: ${e.message}` : i18n.t('run:builderInvalidJson') };
  }
}
