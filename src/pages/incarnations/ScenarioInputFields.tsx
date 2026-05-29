import { useTranslation } from 'react-i18next';
import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';
import {
  isCompositeType,
  type ScenarioFieldValue,
  type ScenarioFieldsState,
} from './scenarioInputFields.helpers';

interface Props {
  schema: ScenarioInputSchema;
  value: ScenarioFieldsState;
  onChange: (next: ScenarioFieldsState) => void;
  // Показать inline-ошибку под пустыми required-полями (после попытки submit
  // или при включённой live-валидации).
  showErrors?: boolean;
}

export function ScenarioInputFields({ schema, value, onChange, showErrors = false }: Props) {
  const entries = Object.entries(schema ?? {});
  if (entries.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map(([key, prop]) => {
        const required = Boolean(prop.required) && prop.type !== 'boolean';
        const v = value[key];
        const empty = v === undefined || (typeof v === 'string' && v.trim() === '');
        const missing = showErrors && required && empty;
        return (
          <ScenarioInputOneField
            key={key}
            name={key}
            required={Boolean(prop.required)}
            missing={missing}
            prop={prop}
            value={v}
            onChange={(nv) => onChange({ ...value, [key]: nv })}
          />
        );
      })}
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
}

function ScenarioInputOneField({ name, required, missing, prop, value, onChange }: OneProps) {
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
          style={baseStyle}
        />
        {prop.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
        ) : null}
        {missingMsg}
      </label>
    );
  }
  // string + enum fallback на select.
  if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labelText}
        </span>
        <select
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
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {labelText}
      </span>
      <input
        type="text"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        style={baseStyle}
      />
      {prop.description ? (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{prop.description}</span>
      ) : null}
      {missingMsg}
    </label>
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
