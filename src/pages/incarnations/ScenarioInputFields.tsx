import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScenarioInputSchema, ScenarioInputSchemaProperty, ScenarioForm } from '../../api/keeper';
import {
  isCompositeType,
  isMapWithScalarItems,
  isMapWithAdditionalProps,
  isObjectWithProperties,
  mapValueType,
  parseObjectFieldValue,
  isTypedListField,
  isArrayOfObjectField,
  isProvisionObjectField,
  getObjectProperties,
  ACL_USER_PRESET,
  readProvisionEnabled,
  setProvisionEnabled,
  setProvisionSubField,
  readProvisionSubField,
  evalShowWhen,
  isFieldRequired,
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
  // Опциональный презентационный слой — разбивка полей на именованные секции.
  // Если присутствует — рендерим секционно; иначе — плоский layout (обратная совместимость).
  form?: ScenarioForm;
  // Имя создаваемой инкарнации (для подсказки existing-souls в ProvisionField).
  incarnationName?: string;
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
  form,
  incarnationName,
}: Props) {
  const { t } = useTranslation();
  const notifyMapError = useFieldErrorAggregator(onInvalidMapChange);
  const notifyPatternError = useFieldErrorAggregator(onPatternErrorChange);

  const entries = Object.entries(schema ?? {});
  if (entries.length === 0) return null;

  function renderField(
    key: string,
    prop: ScenarioInputSchemaProperty,
    labelOverride?: string,
    placeholderOverride?: string,
    hintOverride?: string,
  ) {
    // Provision-поле (object с properties.enabled:boolean) рендерится специально.
    if (isProvisionObjectField(prop)) {
      const v = value[key];
      return (
        <ProvisionField
          key={key}
          name={key}
          prop={prop}
          value={v}
          onChange={(nv) => onChange({ ...value, [key]: nv })}
          labelOverride={labelOverride}
          incarnationName={incarnationName}
        />
      );
    }

    const isRequired = isFieldRequired(prop, value as Record<string, unknown>);
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
        inputState={value as Record<string, unknown>}
        onChange={(nv) => onChange({ ...value, [key]: nv })}
        incarnationContext={incarnationContext}
        moduleName={moduleName}
        onMapError={onInvalidMapChange ? notifyMapError : undefined}
        onPatternError={onPatternErrorChange ? notifyPatternError : undefined}
        labelOverride={labelOverride}
        placeholderOverride={placeholderOverride}
        hintOverride={hintOverride}
        showErrors={showErrors}
      />
    );
  }

  // Секционный рендер: если form задан и содержит секции — раскладываем поля по секциям.
  // Поля, не попавшие ни в одну секцию — «Default» секция в конце (плоско).
  // show_when: вычисляется client-side по текущим значениям input (мини-CEL).
  if (form?.sections && form.sections.length > 0) {
    // Строим set имён, включённых в секции, чтобы найти «остаток».
    const assignedNames = new Set<string>();
    for (const section of form.sections) {
      for (const field of section.fields ?? []) {
        assignedNames.add(field.name);
      }
    }
    const residualEntries = entries.filter(([key]) => !assignedNames.has(key));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {form.sections.map((section) => {
          // show_when секции: если false — прячем всю секцию со всеми полями.
          const sectionVisible = evalShowWhen(section.show_when, value as Record<string, unknown>);
          if (!sectionVisible) return null;

          const sectionFields = (section.fields ?? [])
            .map((f) => {
              const prop = (schema ?? {})[f.name];
              if (!prop) return null;
              // show_when поля: если false — поле не рендерим.
              // Скрытое поле не отправляется (caller не включает его в payload).
              const fieldVisible = evalShowWhen(f.show_when, value as Record<string, unknown>);
              if (!fieldVisible) return null;
              // label: из form.fields[].label → prop.description → имя поля
              const labelOverride = f.label ?? prop.description ?? f.name;
              return renderField(f.name, prop, labelOverride, f.placeholder, f.hint);
            })
            .filter(Boolean);
          if (sectionFields.length === 0) return null;
          return (
            <FormSection
              key={section.key}
              sectionKey={section.key}
              title={section.title}
              description={section.description}
              collapsed={section.collapsed}
            >
              {sectionFields}
            </FormSection>
          );
        })}
        {residualEntries.length > 0 ? (
          <FormSection sectionKey="__default" title={t('run:formDefaultSection')}>
            {residualEntries.map(([key, prop]) => renderField(key, prop))}
          </FormSection>
        ) : null}
      </div>
    );
  }

  // Плоский рендер (нет form или нет секций): обратная совместимость.
  // isFieldRequired учитывает required_when реактивно по текущему value.
  // NIM-72: одиночный object-with-properties держим в верхней группе (не в advanced-
  // collapse) — иначе add_user.user (required=[children], isFieldRequired=false) хоронит
  // всю форму в свёрнутый <details>. Layout-only, без ложного required-маркера.
  const requiredEntries = entries.filter(([, prop]) => isFieldRequired(prop, value as Record<string, unknown>) || isObjectWithProperties(prop));
  const optionalEntries = entries.filter(([, prop]) => !isFieldRequired(prop, value as Record<string, unknown>) && !isObjectWithProperties(prop));

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

// Секция формы: title + description + collapsed + children.
interface FormSectionProps {
  sectionKey: string;
  title?: string;
  description?: string;
  collapsed?: boolean;
  children: React.ReactNode;
}

function FormSection({ sectionKey, title, description, collapsed, children }: FormSectionProps) {
  const hasHeader = Boolean(title || description);

  if (collapsed) {
    // Сворачиваемая секция через <details>.
    return (
      <details
        data-testid={`form-section-${sectionKey}`}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-muted)',
            userSelect: 'none',
            listStyle: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginBottom: 4,
          }}
        >
          <span>&#9654;</span>
          {title ? <span>{title}</span> : null}
        </summary>
        {description ? (
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 8px' }}>{description}</p>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          {children}
        </div>
      </details>
    );
  }

  return (
    <div data-testid={`form-section-${sectionKey}`}>
      {hasHeader ? (
        <div style={{ marginBottom: 8 }}>
          {title ? (
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 2,
              }}
            >
              {title}
            </div>
          ) : null}
          {description ? (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{description}</p>
          ) : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

interface OneProps {
  name: string;
  // required вычислен снаружи через isFieldRequired (учитывает required_when реактивно).
  required: boolean;
  missing: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  // Текущее состояние всех полей формы (для реактивного required_when).
  inputState: Record<string, unknown>;
  onChange: (v: ScenarioFieldValue) => void;
  incarnationContext?: string;
  moduleName?: string;
  // Callback: (fieldName, hasError) — поднимает ошибку map-поля к родителю.
  onMapError?: (name: string, hasError: boolean) => void;
  // Callback: (fieldName, hasError) — поднимает pattern-ошибку к родителю.
  onPatternError?: (name: string, hasError: boolean) => void;
  // Опциональная подпись из ScenarioForm: заменяет имя поля в label.
  labelOverride?: string;
  // Из ScenarioFormField: placeholder и hint (оба опциональны).
  placeholderOverride?: string;
  hintOverride?: string;
  // Показывать inline-ошибки required у под-полей объекта (NIM-72, рекурсивный ObjectField).
  showErrors?: boolean;
}

function ScenarioInputOneField({ name, required, missing, prop, value, onChange, incarnationContext, moduleName, onMapError, onPatternError, labelOverride, placeholderOverride, hintOverride, showErrors }: Omit<OneProps, 'inputState'> & { inputState: Record<string, unknown> }) {
  const { t } = useTranslation();
  // Текст label без маркера (маркер рендерится отдельным span).
  const labelBaseText = labelOverride ?? name;
  // Красная звёздочка для обязательных полей.
  const requiredMarker = required ? (
    <span
      data-testid={`field-required-marker-${name}`}
      style={{ color: 'var(--danger)', marginLeft: 2 }}
      aria-label="обязательное поле"
    >
      *
    </span>
  ) : null;
  // labelText — строка без маркера (используется там, где нужен plain-string: placeholder MapEditor и пр.).
  const labelText = labelBaseText;
  // placeholder: placeholderOverride → prop.example → undefined.
  const resolvedPlaceholder = placeholderOverride ?? prop.example;
  // hint: hintOverride → prop.description → undefined.
  // Hint отображается под полем; если hintOverride задан — он важнее description.
  const resolvedHint = hintOverride ?? prop.description;
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
          {labelText}{requiredMarker}
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
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
          {labelText}{requiredMarker}
        </span>
        <SidPicker
          value={value === undefined ? undefined : String(value)}
          onChange={(v) => onChange(v)}
          source={prop.source}
          incarnationContext={incarnationContext}
          moduleName={moduleName ?? ''}
          missing={missing}
        />
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
          {labelText}{requiredMarker}
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
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
        required={required}
        prop={prop}
        value={value}
        onChange={onChange}
        missing={missing}
        baseStyle={baseStyle}
        hintOverride={resolvedHint}
      />
    );
  }

  // ADR-045 B2 + NIM-72: type=object + map (isMap+scalar items ИЛИ
  // additional_properties-скаляр) → KEY→VALUE-редактор.
  if (isMapWithScalarItems(prop) || isMapWithAdditionalProps(prop)) {
    return (
      <MapEditor
        name={name}
        labelText={labelText}
        required={required}
        prop={prop}
        value={value}
        onChange={onChange}
        missing={missing}
        baseStyle={baseStyle}
        onErrorChange={onMapError}
        hintOverride={resolvedHint}
      />
    );
  }

  // Array-of-object: type=array + items.type=object + items.properties → карточки.
  // Каждый элемент массива рендерится карточкой с под-полями по items.properties.
  if (isArrayOfObjectField(prop)) {
    return (
      <ArrayOfObjectField
        name={name}
        labelText={labelText}
        required={required}
        prop={prop}
        value={value}
        onChange={onChange}
        missing={missing}
        baseStyle={baseStyle}
        hintOverride={resolvedHint}
      />
    );
  }

  // NIM-72: одиночный типизированный объект (type=object + properties) →
  // рекурсивный рендер под-полей через тот же движок (enum→select, вложенный
  // map/object/boolean — «бесплатно»). Раньше падал в JSON-textarea.
  if (isObjectWithProperties(prop)) {
    return (
      <ObjectField
        name={name}
        labelText={labelText}
        required={required}
        prop={prop}
        value={value}
        onChange={onChange}
        missing={missing}
        hintOverride={resolvedHint}
        showErrors={showErrors}
        incarnationContext={incarnationContext}
        moduleName={moduleName}
        onMapError={onMapError}
        onPatternError={onPatternError}
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
          {labelText}{requiredMarker} <span style={{ color: 'var(--text-faint)' }}>({prop.type})</span>
        </span>
        <textarea
          data-testid={`field-composite-${name}`}
          rows={4}
          value={raw}
          onChange={(e) => onChange(e.target.value)}
          placeholder={resolvedPlaceholder ?? (prop.type === 'array' ? '[]' : '{}')}
          spellCheck={false}
          style={{ ...baseStyle, border: `1px solid ${missing || jsonError ? 'var(--danger)' : 'var(--border)'}` }}
        />
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>— {resolvedHint}</span>
        ) : null}
      </label>
    );
  }
  if (prop.type === 'integer' || prop.type === 'number') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}{requiredMarker}
        </span>
        <input
          type="number"
          step={prop.type === 'integer' ? 1 : 'any'}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}
          placeholder={resolvedPlaceholder}
          style={baseStyle}
        />
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
          {labelText}{requiredMarker}
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
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
          {labelText}{requiredMarker}
        </span>
        <textarea
          data-testid={`field-multiline-${name}`}
          rows={6}
          value={strVal}
          onChange={(e) => handleStringChange(e.target.value)}
          placeholder={resolvedPlaceholder}
          spellCheck={false}
          style={{
            ...baseStyle,
            fontFamily: 'var(--font-mono)',
            resize: 'vertical',
            border: `1px solid ${missing || patternError ? 'var(--danger)' : 'var(--border)'}`,
          }}
        />
        {resolvedHint ? (
          <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
        {labelText}{requiredMarker}
      </span>
      <input
        type="text"
        data-testid={`field-text-${name}`}
        value={strVal}
        onChange={(e) => handleStringChange(e.target.value)}
        placeholder={resolvedPlaceholder}
        style={{ ...baseStyle, border: `1px solid ${missing || patternError ? 'var(--danger)' : 'var(--border)'}` }}
      />
      {resolvedHint ? (
        <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{resolvedHint}</span>
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
  required: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  missing: boolean;
  baseStyle: React.CSSProperties;
  hintOverride?: string;
}

function TypedListField({ name, labelText, required, prop, value, onChange, missing, baseStyle, hintOverride }: TypedListFieldProps) {
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

  const listRequiredMarker = required ? (
    <span
      data-testid={`field-required-marker-${name}`}
      style={{ color: 'var(--danger)', marginLeft: 2 }}
      aria-label="обязательное поле"
    >
      *
    </span>
  ) : null;

  return (
    <div data-testid={`field-typedlist-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}{listRequiredMarker}{' '}
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
      {hintOverride ? (
        <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{hintOverride}</span>
      ) : null}
      {missing ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t('forms:required')}</span>
      ) : null}
    </div>
  );
}

// Array-of-object виджет: каждый элемент — карточка с под-полями по items.properties.
// Значение хранится как JSON-строка массива объектов (для совместимости с serializeFields).
interface ArrayOfObjectFieldProps {
  name: string;
  labelText: string;
  required: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  missing: boolean;
  baseStyle: React.CSSProperties;
  hintOverride?: string;
}

function ArrayOfObjectField({ name, labelText, required, prop, value, onChange, missing, baseStyle, hintOverride }: ArrayOfObjectFieldProps) {
  const { t } = useTranslation();

  // properties под-полей из items
  const itemProperties = (prop.items?.['properties'] ?? {}) as Record<string, ScenarioInputSchemaProperty>;
  const itemRequiredKeys: string[] = Array.isArray(prop.items?.['required']) ? (prop.items?.['required'] as string[]) : [];
  // x-type — имя типа элемента (опционально, из items['x-type'])
  const xType = prop.items?.['x-type'] as string | undefined;

  // Разбираем текущее значение в массив объектов
  function parseItems(): Array<Record<string, string>> {
    if (value === undefined || value === '') return [];
    try {
      const parsed = JSON.parse(String(value));
      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            // Конвертируем значения в строки для хранения в локальном state
            const rec: Record<string, string> = {};
            for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
              rec[k] = v === undefined || v === null ? '' : String(v);
            }
            return rec;
          }
          return {};
        });
      }
    } catch {
      // ignore
    }
    return [];
  }

  const [items, setItems] = useState<Array<Record<string, string>>>(() => parseItems());

  function commit(next: Array<Record<string, string>>) {
    setItems(next);
    // Сериализуем в JSON-строку массива объектов (пустые строки сохраняем как есть)
    onChange(JSON.stringify(next));
  }

  function handleSubfieldChange(itemIdx: number, subKey: string, subVal: string) {
    const next = items.map((item, i) => i === itemIdx ? { ...item, [subKey]: subVal } : item);
    commit(next);
  }

  function handleAdd() {
    // Создаём новый элемент с пустыми значениями для всех под-полей.
    // Для типа AclUser применяем preset безопасных дефолтов.
    const preset = xType === 'AclUser' ? ACL_USER_PRESET : {};
    const newItem: Record<string, string> = {};
    for (const k of Object.keys(itemProperties)) {
      newItem[k] = preset[k] ?? '';
    }
    commit([...items, newItem]);
  }

  function handleRemove(idx: number) {
    commit(items.filter((_, i) => i !== idx));
  }

  const requiredMarkerEl = required ? (
    <span
      data-testid={`field-required-marker-${name}`}
      style={{ color: 'var(--danger)', marginLeft: 2 }}
      aria-label="обязательное поле"
    >
      *
    </span>
  ) : null;

  return (
    <div data-testid={`field-arrayobj-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}{requiredMarkerEl}
        {xType ? (
          <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>[{xType}]</span>
        ) : null}
      </span>
      {items.map((item, itemIdx) => (
        <div
          key={itemIdx}
          data-testid={`field-arrayobj-card-${name}-${itemIdx}`}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            {xType ? (
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                {xType} #{itemIdx + 1}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>#{itemIdx + 1}</span>
            )}
            <button
              type="button"
              data-testid={`field-arrayobj-remove-${name}-${itemIdx}`}
              onClick={() => handleRemove(itemIdx)}
              style={{
                padding: '2px 8px',
                fontSize: 13,
                cursor: 'pointer',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
              title={t('run:listRemoveItem')}
            >
              {t('run:listRemoveItem')}
            </button>
          </div>
          {Object.entries(itemProperties).map(([subKey, subProp]) => {
            const isSubRequired = itemRequiredKeys.includes(subKey);
            const subVal = item[subKey] ?? '';
            const subRequiredMarker = isSubRequired ? (
              <span
                data-testid={`field-arrayobj-subfield-required-${name}-${itemIdx}-${subKey}`}
                style={{ color: 'var(--danger)', marginLeft: 2 }}
              >
                *
              </span>
            ) : null;

            // enum sub-field → select
            if (subProp.enum && Array.isArray(subProp.enum) && subProp.enum.length > 0) {
              return (
                <label key={subKey} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {subKey}{subRequiredMarker}
                  </span>
                  <select
                    data-testid={`field-arrayobj-subfield-${name}-${itemIdx}-${subKey}`}
                    value={subVal}
                    onChange={(e) => handleSubfieldChange(itemIdx, subKey, e.target.value)}
                    style={{ ...baseStyle, fontSize: 12 }}
                  >
                    <option value="">—</option>
                    {subProp.enum.map((opt) => (
                      <option key={String(opt)} value={String(opt)}>
                        {String(opt)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            // text sub-field (string/default)
            return (
              <label key={subKey} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {subKey}{subRequiredMarker}
                </span>
                <input
                  type="text"
                  data-testid={`field-arrayobj-subfield-${name}-${itemIdx}-${subKey}`}
                  value={subVal}
                  onChange={(e) => handleSubfieldChange(itemIdx, subKey, e.target.value)}
                  placeholder={subProp.example ?? subProp.description}
                  style={{ ...baseStyle, fontSize: 12 }}
                />
              </label>
            );
          })}
        </div>
      ))}
      <button
        type="button"
        data-testid={`field-arrayobj-add-${name}`}
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
        + {t('run:arrayObjAddItem')}
      </button>
      {hintOverride ? (
        <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{hintOverride}</span>
      ) : null}
      {missing ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t('forms:required')}</span>
      ) : null}
    </div>
  );
}

// NIM-72: одиночный типизированный объект (AclUser add_user.user). Рекурсивно
// рендерит под-поля через ScenarioInputOneField (тот же движок). Значение —
// JSON-строка объекта под-полей (subState = ScenarioFieldsState), сериализуется
// рекурсивно в serializeFields. object-level required:[children] → маркеры/gate.
interface ObjectFieldProps {
  name: string;
  labelText: string;
  required: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  missing: boolean;
  hintOverride?: string;
  showErrors?: boolean;
  incarnationContext?: string;
  moduleName?: string;
  onMapError?: (name: string, hasError: boolean) => void;
  onPatternError?: (name: string, hasError: boolean) => void;
}

function ObjectField({ name, labelText, required, prop, value, onChange, missing, hintOverride, showErrors, incarnationContext, moduleName, onMapError, onPatternError }: ObjectFieldProps) {
  const { t } = useTranslation();

  const subProps = getObjectProperties(prop);
  const reqRaw: unknown = prop.required;
  const requiredKeys: string[] = Array.isArray(reqRaw) ? (reqRaw as string[]) : [];
  const xType = prop['x-type'] as string | undefined;

  // subState парсится из value на каждый рендер (single source of truth — внешний value).
  const subState = parseObjectFieldValue(value);

  function handleSubChange(subKey: string, subVal: ScenarioFieldValue) {
    const next: ScenarioFieldsState = { ...subState, [subKey]: subVal };
    onChange(JSON.stringify(next));
  }

  const requiredMarkerEl = required ? (
    <span
      data-testid={`field-required-marker-${name}`}
      style={{ color: 'var(--danger)', marginLeft: 2 }}
      aria-label="обязательное поле"
    >
      *
    </span>
  ) : null;

  return (
    <div data-testid={`field-object-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}{requiredMarkerEl}
        {xType ? <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>[{xType}]</span> : null}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
        {Object.entries(subProps).map(([subKey, subProp]) => {
          const isSubRequired = requiredKeys.includes(subKey);
          const subVal = subState[subKey];
          const subEmpty = subVal === undefined || (typeof subVal === 'string' && subVal.trim() === '');
          const subMissing = Boolean(showErrors) && isSubRequired && subEmpty;
          return (
            <ScenarioInputOneField
              key={subKey}
              name={`${name}.${subKey}`}
              required={isSubRequired}
              missing={subMissing}
              prop={subProp}
              value={subVal}
              inputState={subState as Record<string, unknown>}
              onChange={(nv) => handleSubChange(subKey, nv)}
              incarnationContext={incarnationContext}
              moduleName={moduleName}
              onMapError={onMapError}
              onPatternError={onPatternError}
              showErrors={showErrors}
              labelOverride={subKey}
            />
          );
        })}
      </div>
      {hintOverride ? (
        <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{hintOverride}</span>
      ) : null}
      {missing ? (
        <span data-testid={`field-required-${name}`} style={{ color: 'var(--danger)', fontSize: 12 }}>{t('forms:required')}</span>
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

// ---------------------------------------------------------------------------
// ProvisionField — специальный рендер для cloud-provision object-поля.
//
// Показывает toggle «Создать VM автоматически» (enabled) вверху секции.
// Когда enabled=true: отображаются под-поля (provider/profile/await_timeout/
// ssh_provider и любые другие из properties, кроме enabled).
// Когда enabled=false: показывает подсказку о режиме existing-souls.
// ---------------------------------------------------------------------------
interface ProvisionFieldProps {
  name: string;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  labelOverride?: string;
  // Имя инкарнации (для подсказки «coven <name>»).
  incarnationName?: string;
}

function ProvisionField({ name, prop, value, onChange, labelOverride, incarnationName }: ProvisionFieldProps) {
  const { t } = useTranslation();

  const enabled = readProvisionEnabled(value);

  function handleToggle(e: React.ChangeEvent<HTMLInputElement>) {
    const next = setProvisionEnabled(value, e.target.checked);
    onChange(next);
  }

  function handleSubChange(subKey: string, subVal: string) {
    const next = setProvisionSubField(value, subKey, subVal);
    onChange(next);
  }

  // Sub-поля из properties, исключаем enabled (рендерится как toggle).
  const subProps = getObjectProperties(prop);
  const subEntries = Object.entries(subProps).filter(([k]) => k !== 'enabled');

  const baseStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
  };

  const sectionTitle = labelOverride ?? prop.description ?? name;

  return (
    <div data-testid={`field-provision-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Заголовок секции */}
      {sectionTitle ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {sectionTitle}
        </div>
      ) : null}

      {/* Главный toggle — enabled */}
      <label
        data-testid={`field-provision-toggle-${name}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: enabled
            ? 'color-mix(in srgb, var(--accent) 6%, var(--surface))'
            : 'var(--surface)',
          border: `1px solid ${enabled ? 'color-mix(in srgb, var(--accent) 30%, var(--border))' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <input
          type="checkbox"
          data-testid={`field-provision-enabled-${name}`}
          checked={enabled}
          onChange={handleToggle}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          {t('incarnations:provisionToggleLabel')}
        </span>
      </label>

      {/* Под-поля — только когда enabled */}
      {enabled ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid color-mix(in srgb, var(--accent) 30%, var(--border))' }}>
          {subEntries.map(([subKey, subProp]) => {
            const subVal = readProvisionSubField(value, subKey);
            const subLabel = subProp.description ?? subKey;
            const subPlaceholder = subProp.example;
            const subHint = subProp.description !== subLabel ? subProp.description : undefined;

            if (subProp.type === 'boolean') {
              return (
                <label key={subKey} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    data-testid={`field-provision-sub-${name}-${subKey}`}
                    checked={subVal === 'true'}
                    onChange={(e) => handleSubChange(subKey, e.target.checked ? 'true' : 'false')}
                  />
                  <span className="mono">{subLabel}</span>
                </label>
              );
            }

            return (
              <label key={subKey} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {subLabel}
                </span>
                <input
                  type="text"
                  data-testid={`field-provision-sub-${name}-${subKey}`}
                  value={subVal}
                  onChange={(e) => handleSubChange(subKey, e.target.value)}
                  placeholder={subPlaceholder}
                  style={baseStyle}
                />
                {subHint ? (
                  <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{subHint}</span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : (
        /* Подсказка: existing-souls режим */
        <div
          data-testid={`field-provision-disabled-hint-${name}`}
          style={{
            padding: '10px 12px',
            background: 'color-mix(in srgb, var(--text-faint) 6%, var(--surface))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: 12,
            color: 'var(--text-faint)',
          }}
        >
          {t('incarnations:provisionDisabledHint', { coven: incarnationName || '…' })}
        </div>
      )}
    </div>
  );
}

// ADR-045 B2: KEY→VALUE-редактор для type=map + scalar items.
// Черновые пары хранятся в локальном state (включая незаполненные ключи);
// внешний onChange ВСЕГДА получает валидный JSON-строку применимых пар (last-wins
// при дублях) или пустую строку — sentinel 'invalid-map' устранён (major-1 fix).
// Ошибочность (duplicate/incomplete/bad-int) сигнализируется через onErrorChange.
interface MapEditorProps {
  name: string;
  labelText: string;
  required: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  missing: boolean;
  baseStyle: React.CSSProperties;
  // Callback: поднимает ошибку/её снятие к ScenarioInputFields для gate-а submit-а.
  onErrorChange?: (name: string, hasError: boolean) => void;
  hintOverride?: string;
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

function MapEditor({ name, labelText, required, prop, value, onChange, missing, baseStyle, onErrorChange, hintOverride }: MapEditorProps) {
  const { t } = useTranslation();
  const itemsType = mapValueType(prop);
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

  const mapRequiredMarker = required ? (
    <span
      data-testid={`field-required-marker-${name}`}
      style={{ color: 'var(--danger)', marginLeft: 2 }}
      aria-label="обязательное поле"
    >
      *
    </span>
  ) : null;

  return (
    <div data-testid={`field-map-${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}{mapRequiredMarker}{' '}
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
      {hintOverride ? (
        <span data-testid={`field-hint-${name}`} style={{ color: 'var(--text-faint)', fontSize: 12 }}>{hintOverride}</span>
      ) : null}
      {missing ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t('forms:required')}</span>
      ) : null}
    </div>
  );
}
