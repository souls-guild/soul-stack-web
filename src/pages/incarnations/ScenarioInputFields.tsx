import { useEffect, useMemo, useRef, useState } from 'react';
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
  directiveFieldTag,
  directiveNamesForVersion,
  versionToSeries,
  computeRequiredHostCount,
  type DirectiveCatalogContext,
  type ScenarioFieldValue,
  type ScenarioFieldsState,
} from './scenarioInputFields.helpers';
import { SidPicker } from './SidPicker';
import { DeprecatedParamNotice } from './DeprecatedParamNotice';
import { successorSwap } from './deprecatedParam.helpers';

interface Props {
  schema: ScenarioInputSchema;
  value: ScenarioFieldsState;
  onChange: (next: ScenarioFieldsState) => void;
  // Show an inline error under empty required fields (after a submit attempt
  // or when live validation is enabled).
  showErrors?: boolean;
  // ADR-045: context for the SID picker (incarnation_hosts source).
  incarnationContext?: string;
  // Module name for form-prep (needed by SidPicker).
  moduleName?: string;
  // Callback: invoked when the set of map fields with errors changes.
  // The caller includes these fields in the submit gate (alongside invalidCompositeFields).
  onInvalidMapChange?: (fieldNames: string[]) => void;
  // Callback: set of fields with pattern errors (for the gate on the caller's side).
  onPatternErrorChange?: (fieldNames: string[]) => void;
  // Optional presentation layer — splitting fields into named sections.
  // If present — rendered by section; otherwise flat layout (backward compat).
  form?: ScenarioForm;
  // Name of the incarnation being created (for the existing-souls hint in ProvisionField).
  incarnationName?: string;
  // NIM-76: Redis directive catalog (series -> names) for fields with x-directives.
  directiveCatalog?: DirectiveCatalogContext;
  // NIM-76: full Redis version ("8.2.2") — series is chosen client-side. Reactive.
  directiveVersion?: string;
}

// Per-field-name error aggregator. Holds a name->hasError map and notifies
// via the callback on each change. Stable identity via useRef.
function useFieldErrorAggregator(cb: ((names: string[]) => void) | undefined) {
  const errorsRef = useRef<Record<string, boolean>>({});
  const cbRef = useRef(cb);
  cbRef.current = cb;

  return function notify(name: string, hasError: boolean) {
    const prev = errorsRef.current[name];
    if (prev === hasError) return; // no change — don't fire the callback
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
  directiveCatalog,
  directiveVersion,
}: Props) {
  const { t } = useTranslation();
  const notifyMapError = useFieldErrorAggregator(onInvalidMapChange);
  const notifyPatternError = useFieldErrorAggregator(onPatternErrorChange);

  // How many hosts the topology asks for, derived from the SAME field state the form is
  // showing (ADR-081). Computed here rather than passed in so the count a roster picker
  // displays cannot drift from the shards/replicas inputs next to it. undefined = the
  // topology does not pin a number yet, and the picker shows no count.
  const rosterRequiredCount = computeRequiredHostCount(value) ?? undefined;

  const entries = Object.entries(schema ?? {});
  if (entries.length === 0) return null;

  function renderField(
    key: string,
    prop: ScenarioInputSchemaProperty,
    labelOverride?: string,
    placeholderOverride?: string,
    hintOverride?: string,
  ) {
    const field = renderFieldControl(key, prop, labelOverride, placeholderOverride, hintOverride);
    // NIM-243: the deprecation marker wraps the control instead of living inside
    // it — every field shape (SID picker / list / map / object / provision) is
    // covered from one place and none of their branches change. The control stays
    // enabled: the parameter is honored until removed_in, so this warns, it never
    // gates. A parameter without the block renders exactly as it did before.
    if (!prop.deprecated) return field;
    const swap = successorSwap(key, prop, schema ?? {}, value);
    return (
      <div
        key={key}
        data-testid={`field-deprecated-wrap-${key}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          borderLeft: '2px solid var(--warning)',
          paddingLeft: 8,
        }}
      >
        {field}
        <DeprecatedParamNotice
          name={key}
          deprecated={prop.deprecated}
          onSwitch={swap ? () => onChange(swap) : undefined}
        />
      </div>
    );
  }

  function renderFieldControl(
    key: string,
    prop: ScenarioInputSchemaProperty,
    labelOverride?: string,
    placeholderOverride?: string,
    hintOverride?: string,
  ) {
    // The provision field (object with properties.enabled:boolean) is rendered specially.
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
        rosterRequiredCount={rosterRequiredCount}
        moduleName={moduleName}
        onMapError={onInvalidMapChange ? notifyMapError : undefined}
        onPatternError={onPatternErrorChange ? notifyPatternError : undefined}
        labelOverride={labelOverride}
        placeholderOverride={placeholderOverride}
        hintOverride={hintOverride}
        showErrors={showErrors}
        directiveCatalog={directiveCatalog}
        directiveVersion={directiveVersion}
      />
    );
  }

  // Sectional render: if form is set and has sections — lay out fields by section.
  // Fields not assigned to any section go into a "Default" section at the end (flat).
  // show_when: computed client-side from current input values (mini-CEL).
  if (form?.sections && form.sections.length > 0) {
    // Build a set of names assigned to sections, to find the "leftover".
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
          // section show_when: if false — hide the whole section with all its fields.
          const sectionVisible = evalShowWhen(section.show_when, value as Record<string, unknown>);
          if (!sectionVisible) return null;

          const sectionFields = (section.fields ?? [])
            .map((f) => {
              const prop = (schema ?? {})[f.name];
              if (!prop) return null;
              // field show_when: if false — the field isn't rendered.
              // A hidden field isn't sent (the caller doesn't include it in the payload).
              const fieldVisible = evalShowWhen(f.show_when, value as Record<string, unknown>);
              if (!fieldVisible) return null;
              // label: from form.fields[].label -> prop.description -> field name
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

  // Flat render (no form or no sections): backward compatibility.
  // isFieldRequired accounts for required_when reactively based on the current value.
  // NIM-72: keep a standalone object-with-properties in the top group (not in the advanced
  // collapse) — otherwise add_user.user (required=[children], isFieldRequired=false) buries
  // the whole form in a collapsed <details>. Layout-only, no false required marker.
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

// Form section: title + description + collapsed + children.
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
    // Collapsible section via <details>.
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
  // required is computed externally via isFieldRequired (accounts for required_when reactively).
  required: boolean;
  missing: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  // Current state of all form fields (for reactive required_when).
  inputState: Record<string, unknown>;
  onChange: (v: ScenarioFieldValue) => void;
  incarnationContext?: string;
  moduleName?: string;
  rosterRequiredCount?: number;
  // Callback: (fieldName, hasError) — propagates a map-field error up to the parent.
  onMapError?: (name: string, hasError: boolean) => void;
  // Callback: (fieldName, hasError) — propagates a pattern error up to the parent.
  onPatternError?: (name: string, hasError: boolean) => void;
  // Optional label override from ScenarioForm: replaces the field name in the label.
  labelOverride?: string;
  // From ScenarioFormField: placeholder and hint (both optional).
  placeholderOverride?: string;
  hintOverride?: string;
  // Show inline required errors on object sub-fields (NIM-72, recursive ObjectField).
  showErrors?: boolean;
  // NIM-76: Redis directive catalog + version (for MapEditor fields with x-directives).
  directiveCatalog?: DirectiveCatalogContext;
  directiveVersion?: string;
}

function ScenarioInputOneField({ name, required, missing, prop, value, onChange, incarnationContext, moduleName, rosterRequiredCount, onMapError, onPatternError, labelOverride, placeholderOverride, hintOverride, showErrors, directiveCatalog, directiveVersion }: Omit<OneProps, 'inputState'> & { inputState: Record<string, unknown> }) {
  const { t } = useTranslation();
  // Label text without the marker (the marker is rendered as a separate span).
  const labelBaseText = labelOverride ?? name;
  // Red asterisk for required fields.
  const requiredMarker = required ? (
    <span
      data-testid={`field-required-marker-${name}`}
      style={{ color: 'var(--danger)', marginLeft: 2 }}
      aria-label={t('incarnations:nameRequired')}
    >
      *
    </span>
  ) : null;
  // labelText — string without the marker (used where a plain string is needed: MapEditor placeholder etc.).
  const labelText = labelBaseText;
  // placeholder: placeholderOverride -> prop.example -> undefined.
  const resolvedPlaceholder = placeholderOverride ?? prop.example;
  // hint: hintOverride -> prop.description -> undefined.
  // Hint is shown under the field; if hintOverride is set — it takes priority over description.
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
          requiredCount={rosterRequiredCount}
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
          requiredCount={rosterRequiredCount}
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
          requiredCount={rosterRequiredCount}
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

  // ADR-045 S8b: type=array + items.type=int|string -> typed list with +/-.
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

  // ADR-045 B2 + NIM-72: type=object + map (isMap+scalar items OR
  // additional_properties-scalar) -> KEY->VALUE editor.
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
        directiveCatalog={directiveCatalog}
        directiveVersion={directiveVersion}
      />
    );
  }

  // Array-of-object: type=array + items.type=object + items.properties -> cards.
  // Each array element is rendered as a card with sub-fields from items.properties.
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

  // NIM-72: a standalone typed object (type=object + properties) ->
  // recursive sub-field render via the same engine (enum->select, nested
  // map/object/boolean — "for free"). Previously fell back to a JSON textarea.
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
        rosterRequiredCount={rosterRequiredCount}
        moduleName={moduleName}
        onMapError={onMapError}
        onPatternError={onPatternError}
        directiveCatalog={directiveCatalog}
        directiveVersion={directiveVersion}
      />
    );
  }

  // Composite type (array/object): per-field JSON textarea. Value is stored
  // as a raw string; invalid JSON is highlighted inline (submit is blocked
  // by the caller via invalidCompositeFields).
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
  // string + enum -> select (enum takes priority over pattern).
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
  // ADR-045 S4: pattern -> inline regex validation on input (also works for textarea).
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

  // ADR-045 B3: multiline=true -> textarea instead of a single-line input.
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

// ADR-045 S8b: Typed list (list[int]/list[string]) — a set of numeric
// or string inputs with add/remove buttons. Value is stored as a
// JSON array string (for compatibility with serializeFields).
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

  // Parse the current value into a string array (for display in inputs).
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
    // Always store raw strings — validation is inline, serialization happens at submit
    // (serializeFields parses the JSON string and converts numbers).
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
      aria-label={t('incarnations:nameRequired')}
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

// Array-of-object widget: each element is a card with sub-fields from items.properties.
// Value is stored as a JSON string of an object array (for compatibility with serializeFields).
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

  // sub-field properties from items
  const itemProperties = (prop.items?.['properties'] ?? {}) as Record<string, ScenarioInputSchemaProperty>;
  const itemRequiredKeys: string[] = Array.isArray(prop.items?.['required']) ? (prop.items?.['required'] as string[]) : [];
  // x-type — element type name (optional, from items['x-type'])
  const xType = prop.items?.['x-type'] as string | undefined;

  // Parse the current value into an object array
  function parseItems(): Array<Record<string, string>> {
    if (value === undefined || value === '') return [];
    try {
      const parsed = JSON.parse(String(value));
      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            // Convert values to strings for storage in local state
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
    // Serialize into a JSON string of an object array (empty strings kept as-is)
    onChange(JSON.stringify(next));
  }

  function handleSubfieldChange(itemIdx: number, subKey: string, subVal: string) {
    const next = items.map((item, i) => i === itemIdx ? { ...item, [subKey]: subVal } : item);
    commit(next);
  }

  function handleAdd() {
    // Create a new element with empty values for all sub-fields.
    // For type AclUser, apply a preset of safe defaults.
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
      aria-label={t('incarnations:nameRequired')}
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

// NIM-72: a standalone typed object (AclUser add_user.user). Recursively
// renders sub-fields via ScenarioInputOneField (the same engine). Value is a
// JSON string of the sub-field object (subState = ScenarioFieldsState), serialized
// recursively in serializeFields. object-level required:[children] -> markers/gate.
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
  rosterRequiredCount?: number;
  onMapError?: (name: string, hasError: boolean) => void;
  onPatternError?: (name: string, hasError: boolean) => void;
  directiveCatalog?: DirectiveCatalogContext;
  directiveVersion?: string;
}

function ObjectField({ name, labelText, required, prop, value, onChange, missing, hintOverride, showErrors, incarnationContext, moduleName, rosterRequiredCount, onMapError, onPatternError, directiveCatalog, directiveVersion }: ObjectFieldProps) {
  const { t } = useTranslation();

  const subProps = getObjectProperties(prop);
  const reqRaw: unknown = prop.required;
  const requiredKeys: string[] = Array.isArray(reqRaw) ? (reqRaw as string[]) : [];
  const xType = prop['x-type'] as string | undefined;

  // subState is parsed from value on every render (single source of truth — the external value).
  const subState = parseObjectFieldValue(value);

  function handleSubChange(subKey: string, subVal: ScenarioFieldValue) {
    const next: ScenarioFieldsState = { ...subState, [subKey]: subVal };
    onChange(JSON.stringify(next));
  }

  const requiredMarkerEl = required ? (
    <span
      data-testid={`field-required-marker-${name}`}
      style={{ color: 'var(--danger)', marginLeft: 2 }}
      aria-label={t('incarnations:nameRequired')}
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
                    rosterRequiredCount={rosterRequiredCount}
              moduleName={moduleName}
              onMapError={onMapError}
              onPatternError={onPatternError}
              showErrors={showErrors}
              labelOverride={subKey}
              directiveCatalog={directiveCatalog}
              directiveVersion={directiveVersion}
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
// ProvisionField — special render for the cloud-provision object field.
//
// Shows the "Create VM automatically" toggle (enabled) at the top of the section.
// When enabled=true: sub-fields are shown (provider/profile/await_timeout/
// ssh_provider and any others from properties except enabled).
// When enabled=false: shows a hint about existing-souls mode.
// ---------------------------------------------------------------------------
interface ProvisionFieldProps {
  name: string;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  labelOverride?: string;
  // Incarnation name (for the "coven <name>" hint).
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

  // Sub-fields from properties, excluding enabled (rendered as the toggle).
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
      {/* Section header */}
      {sectionTitle ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {sectionTitle}
        </div>
      ) : null}

      {/* Main toggle — enabled */}
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

      {/* Sub-fields — only when enabled */}
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
        /* Hint: existing-souls mode */
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

// ADR-045 B2: KEY->VALUE editor for type=map + scalar items.
// Draft pairs are stored in local state (including unfilled keys);
// the external onChange ALWAYS receives a valid JSON string of applicable pairs (last-wins
// on duplicates) or an empty string — the 'invalid-map' sentinel was removed (major-1 fix).
// Error state (duplicate/incomplete/bad-int) is signaled via onErrorChange.
interface MapEditorProps {
  name: string;
  labelText: string;
  required: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
  missing: boolean;
  baseStyle: React.CSSProperties;
  // Callback: propagates an error/its clearing up to ScenarioInputFields for the submit gate.
  onErrorChange?: (name: string, hasError: boolean) => void;
  hintOverride?: string;
  // NIM-76: Redis directive catalog (series -> names) + current version. Keys are validated
  // ONLY when prop['x-directives'] is truthy AND the catalog is loaded (otherwise graceful).
  directiveCatalog?: DirectiveCatalogContext;
  directiveVersion?: string;
}

type PairError = 'duplicate' | 'incomplete' | 'unknown-directive' | null;

// Computes map-editor pair errors — the single source of truth for render and commitPairs.
// knownDirectives (NIM-76): non-empty Set -> a key outside the catalog = 'unknown-directive';
// null/undefined -> directives aren't validated (catalog not available -> graceful degrade).
function computePairErrors(
  pairs: Array<[string, string]>,
  isInt: boolean,
  knownDirectives?: Set<string> | null,
): {
  pairErrors: PairError[];
  valErrors: boolean[];
  hasError: boolean;
} {
  const keyCount: Record<string, number> = {};
  for (const [k] of pairs) {
    if (k.trim() !== '') keyCount[k] = (keyCount[k] ?? 0) + 1;
  }
  const pairErrors: PairError[] = pairs.map(([k, v]) => {
    if (k.trim() === '' && v.trim() !== '') return 'incomplete';
    if (k.trim() !== '' && (keyCount[k] ?? 0) > 1) return 'duplicate';
    if (k.trim() !== '' && knownDirectives && !knownDirectives.has(k)) return 'unknown-directive';
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

function MapEditor({ name, labelText, required, prop, value, onChange, missing, baseStyle, onErrorChange, hintOverride, directiveCatalog, directiveVersion }: MapEditorProps) {
  const { t } = useTranslation();
  const itemsType = mapValueType(prop);
  const isInt = itemsType === 'integer';

  // Local pair state (includes drafts with an empty key).
  // Initialized from the external value on first render.
  const [pairs, setPairs] = useState<Array<[string, string]>>(() => parseJsonPairs(value));

  // NIM-76: directive names for validation/typeahead — only for the flagged field
  // (x-directives) and when the catalog is loaded + series is known. Otherwise null -> no validation.
  const directiveTag = directiveFieldTag(prop);
  const directiveNames = useMemo(
    () => (directiveTag ? directiveNamesForVersion(directiveCatalog, directiveVersion) : undefined),
    [directiveTag, directiveCatalog, directiveVersion],
  );
  const knownDirectives = useMemo(
    () => (directiveNames ? new Set(directiveNames) : null),
    [directiveNames],
  );
  const directivesDatalistId = directiveNames
    ? `directives-${name}-${versionToSeries(directiveVersion)}`
    : undefined;

  // Errors for the current pairs — via the shared function (source of truth).
  const { pairErrors, valErrors } = computePairErrors(pairs, isInt, knownDirectives);

  // Reactive recheck when version/catalog changes (commitPairs covers pair edits;
  // this effect covers a directive-series change and initial validation of a pre-filled value).
  useEffect(() => {
    const { hasError } = computePairErrors(pairs, isInt, knownDirectives);
    onErrorChange?.(name, hasError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownDirectives]);

  // Clear the error on field unmount (hiding a show_when section or a scenario
  // change): otherwise the aggregator keeps a stale key and the submit gate sticks with no
  // field visible on screen. Aggregator refs are stable -> the first-render callback is correct.
  useEffect(() => {
    return () => onErrorChange?.(name, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitPairs(next: Array<[string, string]>) {
    setPairs(next);

    // Recompute errors for the new pair set via the same function.
    const { hasError: nextHasError } = computePairErrors(next, isInt, knownDirectives);

    // External state is ALWAYS valid JSON: only pairs with a non-empty key,
    // duplicates are last-wins (a draft survives re-mount without losing input).
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k.trim() !== '') obj[k] = v;
    }
    onChange(Object.keys(obj).length > 0 ? JSON.stringify(obj) : '');

    // Signal the error via a separate channel (NOT by corrupting value).
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
      aria-label={t('incarnations:nameRequired')}
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
              list={directivesDatalistId}
              aria-invalid={pairErrors[idx] ? 'true' : undefined}
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
                // unknown-directive — a key problem, we don't highlight the value.
                border: `1px solid ${valErrors[idx] || (pairErrors[idx] && pairErrors[idx] !== 'unknown-directive') ? 'var(--danger)' : 'var(--border)'}`,
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
          ) : pairErrors[idx] === 'unknown-directive' ? (
            <span
              data-testid={`field-map-error-${name}`}
              style={{ color: 'var(--danger)', fontSize: 12, paddingLeft: 2 }}
            >
              {t('run:mapUnknownDirectiveError', { version: directiveVersion })}
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
      {/* NIM-76: one shared datalist per editor — typeahead of series directive names. */}
      {directiveNames && directivesDatalistId ? (
        <datalist id={directivesDatalistId} data-testid={`field-map-directives-${name}`}>
          {directiveNames.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      ) : null}
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
