import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../../api/keeper';
import type { ScenarioFieldValue, ScenarioFieldsState } from './scenarioInputFields.helpers';

interface Props {
  schema: ScenarioInputSchema;
  value: ScenarioFieldsState;
  onChange: (next: ScenarioFieldsState) => void;
}

export function ScenarioInputFields({ schema, value, onChange }: Props) {
  const entries = Object.entries(schema ?? {});
  if (entries.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map(([key, prop]) => (
        <ScenarioInputOneField
          key={key}
          name={key}
          required={Boolean(prop.required)}
          prop={prop}
          value={value[key]}
          onChange={(v) => onChange({ ...value, [key]: v })}
        />
      ))}
    </div>
  );
}

interface OneProps {
  name: string;
  required: boolean;
  prop: ScenarioInputSchemaProperty;
  value: ScenarioFieldValue;
  onChange: (v: ScenarioFieldValue) => void;
}

function ScenarioInputOneField({ name, required, prop, value, onChange }: OneProps) {
  const labelText = `${name}${required ? ' *' : ''}`;
  const baseStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
  };
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
    </label>
  );
}
