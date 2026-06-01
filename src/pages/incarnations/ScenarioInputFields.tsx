import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';
import {
  isCompositeType,
  isMapWithScalarItems,
  isTypedListField,
  type ScenarioFieldValue,
  type ScenarioFieldsState,
} from './scenarioInputFields.helpers';
import { SidPicker } from './SidPicker';

interface Props {
  schema: ScenarioInputSchema;
  value: ScenarioFieldsState;
  onChange: (next: ScenarioFieldsState) => void;
  // Показать inline-ошибку под пустыми required-полями (после попытки submit
  // или при включённой live-валидации).
  showErrors?: boolean;
  // ADR-045: контекст для SID-picker (incarnation_hosts source).
  incarnationContext?: string;
  // Имя модуля для form-prep (нужно SidPicker-у).
  moduleName?: string;
  // Callback: вызывается при изменении набора map-полей с ошибками.
  // Caller включает эти поля в submit-gate (наряду с invalidCompositeFields).
  onInvalidMapChange?: (fieldNames: string[]) => void;
  // Callback: набор полей с pattern-ошибками (для gate на стороне caller-а).
  onPatternErrorChange?: (fieldNames: string[]) => void;
}

// Агрегатор ошибок по имени поля. Хранит карту name→hasError и оповещает
// callback-ом при каждом изменении. Стабильный identity через useRef.
function useFieldErrorAggregator(cb: ((names: string[]) => void) | undefined) {
  const errorsRef = useRef<Record<string, boolean>>({});
  const cbRef = useRef(cb);
  cbRef.current = cb;

  return function notify(name: string, hasError: boolean) {
    const prev = errorsRef.current[name];
    if (prev === hasError) return; // нет изменений — не дёргаем callback
    errorsRef.current = { ...errorsRef.current, [name]: hasError };
    cbRef.current?.(Object.keys(errorsRef.current).filter((k) => errorsRef.current[k]));
  };
}

export function ScenarioInputFields({
  schema,
  value,
  onChange,
  showErrors = false,
  incarnationContext,
  moduleName,
  onInvalidMapChange,
  onPatternErrorChange,
}: Props) {
  const { t } = useTranslation();
  const notifyMapError = useFieldErrorAggregator(onInvalidMapChange);
  const notifyPatternError = useFieldErrorAggregator(onPatternErrorChange);

  const entries = Object.entries(schema ?? {});
  if (entries.length === 0) return null;

  // Разделяем на обязательные (required=true, не boolean) и опциональные.
  // Boolean-поля считаются опциональными (всегда имеют дефолт false).
  const requiredEntries = entries.filter(([, prop]) => Boolean(prop.required) && prop.type !== 'boolean');
  const optionalEntries = entries.filter(([, prop]) => !prop.required || prop.type === 'boolean');

  function renderField(key: string, prop: ScenarioInputSchemaProperty) {
    const isRequired = Boolean(prop.required) && prop.type !== 'boolean';
    const v = value[key];
    const empty = v === undefined || (typeof v === 'string' && v.trim() === '');
    const missing = showErrors && isRequired && empty;
    return (
      <ScenarioInputOneField
        key={key}
        name={key}
        required={isRequired}
        missing={missing}
        prop={prop}
        value={v}
        onChange={(nv) => onChange({ ...value, [key]: nv })}
        incarnationContext={incarnationContext}
        moduleName={moduleName}
        onMapError={onInvalidMapChange ? notifyMapError : undefined}
        onPatternError={onPatternErrorChange ? notifyPatternError : undefined}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {requiredEntries.map(([key, prop]) => renderField(key, prop))}
      {optionalEntries.length > 0 ? (
        <details data-testid="advanced-collapse">
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--text-muted)',
              userSelect: 'none',
              marginBottom: 0,
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>&#9654;</span> {t('run:advancedLabel')}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {optionalEntries.map(([key, prop]) => renderField(key, prop))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

interface OneProps {
  name: string;
  required: boolean;
  missing: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  incarnationContext?: string;
  moduleName?: string;
  // Callback: (fieldName, hasError) — поднимает ошибку map-поля к родителю.
  onMapError?: (name: string, hasError: boolean) => void;
  // Callback: (fieldName, hasError) — поднимает pattern-ошибку к родителю.
  onPatternError?: (name: string, hasError: boolean) => void;
}

function ScenarioInputOneField({ name, required, missing, prop, value, onChange, incarnationContext, moduleName, onMapError, onPatternError }: OneProps) {
  const { t } = useTranslation();
  const labelText = `${name}${required ? ' *' : ''}`;
  const baseStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    border: `1px solid ${missing ? 'var(--danger)' : 'var(--border)'}`,
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
  };
  const missingMsg = missing ? (
    <span
      data-testid={`field-required-${name}`}
      style={{ color: 'var(--danger)', fontSize: 12 }}
    >
      {t('forms:required')}
    </span>
  ) : null;

  // ADR-045 S4: format:sid + type:array → multi SID-picker.
  if (prop.type === 'array' && prop.format === 'sid' && prop.source) {
    return (
      <div data-testid={`field-sid-multi-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}
        </span>
        <SidPicker
          value={value === undefined ? undefined : String(value)}
          onChange={(v) => onChange(v)}
          source={prop.source}
          incarnationContext={incarnationContext}
          moduleName={moduleName ?? ''}
          multi
          missing={missing}
        />
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {missingMsg}
      </div>
    );
  }

  // ADR-045 S4: format:sid + type:string → single SID-picker.
  if (prop.format === 'sid' && prop.source) {
    return (
      <div data-testid={`field-sid-single-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}
        </span>
        <SidPicker
          value={value === undefined ? undefined : String(value)}
          onChange={(v) => onChange(v)}
          source={prop.source}
          incarnationContext={incarnationContext}
          moduleName={moduleName ?? ''}
          missing={missing}
        />
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {missingMsg}
      </div>
    );
  }

  // ADR-045 S8b: type=array + items.format=sid + source → multi SID-picker.
  if (isTypedListField(prop) && prop.items?.format === 'sid' && prop.items?.source) {
    return (
      <div data-testid={`field-sid-multi-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}
        </span>
        <SidPicker
          value={value === undefined ? undefined : String(value)}
          onChange={(v) => onChange(v)}
          source={prop.items.source}
          incarnationContext={incarnationContext}
          moduleName={moduleName ?? ''}
          multi
          missing={missing}
        />
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {missingMsg}
      </div>
    );
  }

  // ADR-045 S8b: type=array + items.type=int|string → типизированный список с +/-.
  if (isTypedListField(prop)) {
    return (
      <TypedListField
        name={name}
        labelText={labelText}
        prop={prop}
        value={value}
        onChange={onChange}
        missing={missing}
        baseStyle={baseStyle}
      />
    );
  }

  // ADR-045 B2: type=object + isMap=true + scalar items → KEY→VALUE-редактор.
  if (isMapWithScalarItems(prop)) {
    return (
      <MapEditor
        name={name}
        labelText={labelText}
        prop={prop}
        value={value}
        onChange={onChange}
        missing={missing}
        baseStyle={baseStyle}
        onErrorChange={onMapError}
      />
    );
  }

  // Составной тип (array/object): per-field JSON-textarea. Значение хранится
  // raw-строкой; невалидный JSON подсвечивается inline (submit блокируется
  // caller-ом через invalidCompositeFields).
  if (isCompositeType(prop)) {
    const raw = value === undefined ? '' : String(value);
    const jsonError = raw.trim() !== '' && !isParsableJson(raw);
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText} <span style={{ color: 'var(--text-faint)' }}>({prop.type})</span>
        </span>
        <textarea
          data-testid={`field-composite-${name}`}
          rows={4}
          value={raw}
          onChange={(e) => onChange(e.target.value)}
          placeholder={prop.type === 'array' ? '[]' : '{}'}
          spellCheck={false}
          style={{ ...baseStyle, border: `1px solid ${missing || jsonError ? 'var(--danger)' : 'var(--border)'}` }}
        />
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {jsonError ? (
          <span data-testid={`field-json-error-${name}`} style={{ color: 'var(--danger)', fontSize: 12 }}>
            {t('run:scenarioInputJsonError')}
          </span>
        ) : null}
        {missingMsg}
      </label>
    );
  }
  if (prop.type === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="mono">{labelText}</span>
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>— {prop.description}</span>
        ) : null}
      </label>
    );
  }
  if (prop.type === 'integer' || prop.type === 'number') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}
        </span>
        <input
          type="number"
          step={prop.type === 'integer' ? 1 : 'any'}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}
          placeholder={prop.example}
          style={baseStyle}
        />
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {missingMsg}
      </label>
    );
  }
  // string + enum → select (enum выше приоритетом pattern).
  if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}
        </span>
        <select
          data-testid={`field-enum-${name}`}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          style={baseStyle}
        >
          <option value="">—</option>
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {missingMsg}
      </label>
    );
  }
  // ADR-045 S4: pattern → inline-валидация regex при вводе (работает и для textarea).
  const strVal = value === undefined ? '' : String(value);
  const patternError =
    prop.pattern && strVal.trim() !== ''
      ? (() => {
          try {
            return !new RegExp(prop.pattern).test(strVal);
          } catch {
            return false;
          }
        })()
      : false;

  function handleStringChange(newVal: string) {
    onChange(newVal);
    if (onPatternError && prop.pattern) {
      try {
        const hasErr = newVal.trim() !== '' && !new RegExp(prop.pattern).test(newVal);
        onPatternError(name, hasErr);
      } catch {
        onPatternError(name, false);
      }
    }
  }

  // ADR-045 B3: multiline=true → textarea вместо однострочного input.
  if (prop.multiline) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}
        </span>
        <textarea
          data-testid={`field-multiline-${name}`}
          rows={6}
          value={strVal}
          onChange={(e) => handleStringChange(e.target.value)}
          placeholder={prop.example}
          spellCheck={false}
          style={{
            ...baseStyle,
            fontFamily: 'var(--font-mono)',
            resize: 'vertical',
            border: `1px solid ${missing || patternError ? 'var(--danger)' : 'var(--border)'}`,
          }}
        />
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {patternError ? (
          <span
            data-testid={`field-pattern-error-${name}`}
            style={{ color: 'var(--danger)', fontSize: 12 }}
          >
            {t('run:patternError', { pattern: prop.pattern })}
          </span>
        ) : null}
        {missingMsg}
      </label>
    );
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}
      </span>
      <input
        type="text"
        data-testid={`field-text-${name}`}
        value={strVal}
        onChange={(e) => handleStringChange(e.target.value)}
        placeholder={prop.example}
        style={{ ...baseStyle, border: `1px solid ${missing || patternError ? 'var(--danger)' : 'var(--border)'}` }}
      />
      {prop.description ? (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
      ) : null}
      {patternError ? (
        <span
          data-testid={`field-pattern-error-${name}`}
          style={{ color: 'var(--danger)', fontSize: 12 }}
        >
          {t('run:patternError', { pattern: prop.pattern })}
        </span>
      ) : null}
      {missingMsg}
    </label>
  );
}

// ADR-045 S8b: Типизированный список (list[int]/list[string]) — набор числовых
// или строковых инпутов с кнопками добавить/удалить. Значение хранится как
// JSON-строка массива (для совместимости с serializeFields).
interface TypedListFieldProps {
  name: string;
  labelText: string;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  missing: boolean;
  baseStyle: React.CSSProperties;
}

function TypedListField({ name, labelText, prop, value, onChange, missing, baseStyle }: TypedListFieldProps) {
  const { t } = useTranslation();
  const itemsType = prop.items?.type ?? 'string';
  const isInt = itemsType === 'integer';

  // Разбираем текущее значение в массив строк (для отображения в инпутах).
  function parseItems(): string[] {
    if (value === undefined || value === '') return [];
    try {
      const parsed = JSON.parse(String(value));
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // ignore
    }
    return [];
  }

  const items = parseItems();

  function commit(next: string[]) {
    // Всегда сохраняем сырые строки — валидация inline, серилизация при submit
    // (serializeFields парсит JSON-строку и конвертирует числа).
    onChange(JSON.stringify(next));
  }

  function handleItemChange(idx: number, v: string) {
    const next = [...items];
    next[idx] = v;
    commit(next);
  }

  function handleAdd() {
    commit([...items, '']);
  }

  function handleRemove(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    commit(next);
  }

  const intErrors: boolean[] = isInt
    ? items.map((s) => s.trim() !== '' && Number.isNaN(parseInt(s, 10)))
    : items.map(() => false);

  return (
    <div data-testid={`field-typedlist-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}{' '}
        <span style={{ color: 'var(--text-faint)' }}>
          ({isInt ? 'list[int]' : 'list[string]'})
        </span>
      </span>
      {items.map((item, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type={isInt ? 'number' : 'text'}
            step={isInt ? 1 : undefined}
            data-testid={`field-typedlist-item-${name}-${idx}`}
            value={item}
            onChange={(e) => handleItemChange(idx, e.target.value)}
            style={{
              ...baseStyle,
              flex: 1,
              border: `1px solid ${intErrors[idx] ? 'var(--danger)' : 'var(--border)'}`,
            }}
          />
          <button
            type="button"
            data-testid={`field-typedlist-remove-${name}-${idx}`}
            onClick={() => handleRemove(idx)}
            style={{
              padding: '4px 8px',
              fontSize: 14,
              cursor: 'pointer',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
            }}
            title={t('run:listRemoveItem')}
          >
            {t('run:listRemoveItem')}
          </button>
          {intErrors[idx] ? (
            <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t('run:listIntError')}</span>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        data-testid={`field-typedlist-add-${name}`}
        onClick={handleAdd}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 10px',
          fontSize: 13,
          cursor: 'pointer',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        + {t('run:listAddItem')}
      </button>
      {prop.description ? (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
      ) : null}
      {missing ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t('forms:required')}</span>
      ) : null}
    </div>
  );
}

function isParsableJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// ADR-045 B2: KEY→VALUE-редактор для type=map + scalar items.
// Черновые пары хранятся в локальном state (включая незаполненные ключи);
// внешний onChange ВСЕГДА получает валидный JSON-строку применимых пар (last-wins
// при дублях) или пустую строку — sentinel 'invalid-map' устранён (major-1 fix).
// Ошибочность (duplicate/incomplete/bad-int) сигнализируется через onErrorChange.
interface MapEditorProps {
  name: string;
  labelText: string;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  missing: boolean;
  baseStyle: React.CSSProperties;
  // Callback: поднимает ошибку/её снятие к ScenarioInputFields для gate-а submit-а.
  onErrorChange?: (name: string, hasError: boolean) => void;
}

// Вычисляет ошибки пар map-редактора — единый источник правды для рендера и commitPairs.
function computePairErrors(
  pairs: Array<[string, string]>,
  isInt: boolean,
): {
  pairErrors: Array<'duplicate' | 'incomplete' | null>;
  valErrors: boolean[];
  hasError: boolean;
} {
  const keyCount: Record<string, number> = {};
  for (const [k] of pairs) {
    if (k.trim() !== '') keyCount[k] = (keyCount[k] ?? 0) + 1;
  }
  const pairErrors: Array<'duplicate' | 'incomplete' | null> = pairs.map(([k, v]) => {
    if (k.trim() === '' && v.trim() !== '') return 'incomplete';
    if (k.trim() !== '' && (keyCount[k] ?? 0) > 1) return 'duplicate';
    return null;
  });
  const valErrors: boolean[] = isInt
    ? pairs.map(([, v]) => v.trim() !== '' && Number.isNaN(parseInt(v, 10)))
    : pairs.map(() => false);
  const hasError = pairErrors.some(Boolean) || valErrors.some(Boolean);
  return { pairErrors, valErrors, hasError };
}

function parseJsonPairs(raw: ScenarioFieldValue): Array<[string, string]> {
  if (raw === undefined || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]);
    }
  } catch {
    // ignore
  }
  return [];
}

function MapEditor({ name, labelText, prop, value, onChange, missing, baseStyle, onErrorChange }: MapEditorProps) {
  const { t } = useTranslation();
  const itemsType = prop.items?.type ?? 'string';
  const isInt = itemsType === 'integer';

  // Локальный state пар (включает черновые с пустым ключом).
  // Инициализируется из внешнего value при первом рендере.
  const [pairs, setPairs] = useState<Array<[string, string]>>(() => parseJsonPairs(value));

  // Ошибки текущих пар — через единую функцию (источник правды).
  const { pairErrors, valErrors } = computePairErrors(pairs, isInt);

  function commitPairs(next: Array<[string, string]>) {
    setPairs(next);

    // Пересчитываем ошибки для нового набора пар через ту же функцию.
    const { hasError: nextHasError } = computePairErrors(next, isInt);

    // Внешний state — ВСЕГДА валидный JSON: только пары с непустым ключом,
    // дубли — last-wins (черновик переживает re-mount без потери введённого).
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k.trim() !== '') obj[k] = v;
    }
    onChange(Object.keys(obj).length > 0 ? JSON.stringify(obj) : '');

    // Сигнализируем об ошибке через отдельный канал (НЕ через порчу value).
    onErrorChange?.(name, nextHasError);
  }

  function handleKeyChange(idx: number, k: string) {
    const next = [...pairs] as Array<[string, string]>;
    next[idx] = [k, next[idx][1]];
    commitPairs(next);
  }

  function handleValChange(idx: number, v: string) {
    const next = [...pairs] as Array<[string, string]>;
    next[idx] = [next[idx][0], v];
    commitPairs(next);
  }

  function handleAdd() {
    commitPairs([...pairs, ['', '']]);
  }

  function handleRemove(idx: number) {
    commitPairs(pairs.filter((_, i) => i !== idx));
  }

  return (
    <div data-testid={`field-map-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}{' '}
        <span style={{ color: 'var(--text-faint)' }}>
          ({isInt ? 'map[string]int' : 'map[string]string'})
        </span>
      </span>
      {pairs.map(([k, v], idx) => (
        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              data-testid={`field-map-key-${name}-${idx}`}
              value={k}
              onChange={(e) => handleKeyChange(idx, e.target.value)}
              placeholder="key"
              style={{
                ...baseStyle,
                flex: '0 0 140px',
                border: `1px solid ${pairErrors[idx] ? 'var(--danger)' : 'var(--border)'}`,
              }}
            />
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>→</span>
            <input
              type="text"
              data-testid={`field-map-val-${name}-${idx}`}
              value={v}
              onChange={(e) => handleValChange(idx, e.target.value)}
              placeholder={isInt ? '0' : 'value'}
              style={{
                ...baseStyle,
                flex: 1,
                border: `1px solid ${valErrors[idx] || pairErrors[idx] ? 'var(--danger)' : 'var(--border)'}`,
              }}
            />
            <button
              type="button"
              data-testid={`field-map-remove-${name}-${idx}`}
              onClick={() => handleRemove(idx)}
              style={{
                padding: '4px 8px',
                fontSize: 14,
                cursor: 'pointer',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
              title={t('run:mapRemovePair')}
            >
              {t('run:mapRemovePair')}
            </button>
          </div>
          {pairErrors[idx] === 'duplicate' ? (
            <span
              data-testid={`field-map-error-${name}`}
              style={{ color: 'var(--danger)', fontSize: 12, paddingLeft: 2 }}
            >
              {t('run:mapDuplicateKeyError')}
            </span>
          ) : pairErrors[idx] === 'incomplete' ? (
            <span
              data-testid={`field-map-error-${name}`}
              style={{ color: 'var(--danger)', fontSize: 12, paddingLeft: 2 }}
            >
              {t('run:mapIncompleteKeyError')}
            </span>
          ) : valErrors[idx] ? (
            <span
              data-testid={`field-map-error-${name}`}
              style={{ color: 'var(--danger)', fontSize: 12, paddingLeft: 2 }}
            >
              {t('run:listIntError')}
            </span>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        data-testid={`field-map-add-${name}`}
        onClick={handleAdd}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 10px',
          fontSize: 13,
          cursor: 'pointer',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        + {t('run:mapAddPair')}
      </button>
      {prop.description ? (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
      ) : null}
      {missing ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t('forms:required')}</span>
      ) : null}
    </div>
  );
}
