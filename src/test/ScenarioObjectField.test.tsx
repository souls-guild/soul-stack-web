// NIM-72 guard tests: a single typed object (AclUser) and a map via
// additional_properties no longer fall into raw-JSON-textarea.
//
// Matching by data-testid (language-agnostic). Symptom regression: the add_user.user
// schema used to slip past the special branches -> field-composite-user textarea.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../api/keeper';
import {
  isObjectWithProperties,
  isMapWithAdditionalProps,
  isCompositeType,
  isFieldRequired,
  mapValueType,
  serializeFields,
  defaultsFromSchema,
  missingRequiredFields,
  invalidCompositeFields,
  type ScenarioFieldsState,
} from '../pages/incarnations/scenarioInputFields.helpers';

// add_user.user — a single typed object (backend contract NIM-72).
// required — array of required sub-field names (JSON-Schema), not boolean -> cast.
const aclUserSchema: ScenarioInputSchema = {
  user: {
    type: 'object',
    additional_properties: false,
    description: 'Redis ACL user',
    properties: {
      name: { type: 'string', pattern: '^[a-z]+$' },
      perms: { type: 'string' },
      state: { type: 'string', enum: ['on', 'off'], default: 'on' },
    },
    required: ['name', 'perms'],
    'x-type': 'AclUser',
  } as unknown as ScenarioInputSchemaProperty,
};

// redis_settings/update_config — a typed map via additional_properties (without isMap).
const additionalPropsMapSchema: ScenarioInputSchema = {
  opts: {
    type: 'object',
    additional_properties: { type: 'string' },
  } as unknown as ScenarioInputSchemaProperty,
};

function StatefulFields({
  schema,
  onChangeSpy,
  showErrors,
}: {
  schema: ScenarioInputSchema;
  onChangeSpy?: (s: ScenarioFieldsState) => void;
  showErrors?: boolean;
}) {
  const [state, setState] = useState<ScenarioFieldsState>({});
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={(next) => {
        setState(next);
        onChangeSpy?.(next);
      }}
      showErrors={showErrors ?? false}
    />
  );
}

// -- predicates ----------------------------------------------------------
describe('isObjectWithProperties helper', () => {
  it('true: type=object + properties (not a map, not provision)', () => {
    expect(isObjectWithProperties(aclUserSchema.user)).toBe(true);
  });

  it('false: provision-object (properties.enabled:boolean)', () => {
    expect(
      isObjectWithProperties({
        type: 'object',
        properties: { enabled: { type: 'boolean' }, provider: { type: 'string' } },
      } as unknown as ScenarioInputSchemaProperty),
    ).toBe(false);
  });

  it('false: map via additional_properties (no properties)', () => {
    expect(isObjectWithProperties(additionalPropsMapSchema.opts)).toBe(false);
  });

  it('false: isMap-map', () => {
    expect(isObjectWithProperties({ type: 'object', isMap: true, items: { type: 'string' } })).toBe(false);
  });

  it('false: object without properties (bare object → JSON textarea)', () => {
    expect(isObjectWithProperties({ type: 'object' })).toBe(false);
  });

  it('false: string field', () => {
    expect(isObjectWithProperties({ type: 'string' })).toBe(false);
  });
});

describe('isMapWithAdditionalProps + mapValueType', () => {
  it('true: additional_properties scalar schema {type:string}', () => {
    expect(isMapWithAdditionalProps(additionalPropsMapSchema.opts)).toBe(true);
    expect(mapValueType(additionalPropsMapSchema.opts)).toBe('string');
  });

  it('mapValueType: integer from additional_properties', () => {
    const prop = { type: 'object', additional_properties: { type: 'integer' } } as unknown as ScenarioInputSchemaProperty;
    expect(isMapWithAdditionalProps(prop)).toBe(true);
    expect(mapValueType(prop)).toBe('integer');
  });

  it('false: additional_properties=false (typed object, not a map)', () => {
    expect(isMapWithAdditionalProps(aclUserSchema.user)).toBe(false);
  });

  it('false: additional_properties=true (JSON-schema allow-any → not a scalar map)', () => {
    expect(isMapWithAdditionalProps({ type: 'object', additional_properties: true })).toBe(false);
  });

  it('mapValueType still reads items.type (isMap path)', () => {
    expect(mapValueType({ type: 'object', isMap: true, items: { type: 'integer' } })).toBe('integer');
  });
});

describe('isCompositeType excludes object-with-properties and additional_properties-map', () => {
  it('object+properties → false (not a JSON textarea)', () => {
    expect(isCompositeType(aclUserSchema.user)).toBe(false);
  });

  it('additional_properties-map → false (not a JSON textarea)', () => {
    expect(isCompositeType(additionalPropsMapSchema.opts)).toBe(false);
  });

  it('bare object without properties → true (JSON textarea)', () => {
    expect(isCompositeType({ type: 'object' })).toBe(true);
  });
});

// -- symptom regression: textarea -> typed sub-fields ------------------------
describe('ObjectField render (symptom regression)', () => {
  it('renders field-object-user + sub-fields, NOT field-composite-user textarea', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.getByTestId('field-object-user')).toBeTruthy();
    // Key regression: raw JSON textarea is NOT rendered.
    expect(screen.queryByTestId('field-composite-user')).toBeNull();
    // Sub-fields render typed.
    expect(screen.getByTestId('field-text-user.name')).toBeTruthy();
    expect(screen.getByTestId('field-text-user.perms')).toBeTruthy();
    expect(screen.getByTestId('field-enum-user.state')).toBeTruthy();
  });

  it('state → <select> with on/off options', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    const select = screen.getByTestId('field-enum-user.state');
    expect(select.tagName).toBe('SELECT');
    const options = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('on');
    expect(options).toContain('off');
  });

  it('name/perms → text input (not enum-select)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    const nameInput = screen.getByTestId('field-text-user.name');
    expect(nameInput.tagName).toBe('INPUT');
    expect((nameInput as HTMLInputElement).type).toBe('text');
  });

  it('required markers on required sub-fields (name, perms), not on state', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.getByTestId('field-required-marker-user.name')).toBeTruthy();
    expect(screen.getByTestId('field-required-marker-user.perms')).toBeTruthy();
    expect(screen.queryByTestId('field-required-marker-user.state')).toBeNull();
  });

  it('x-type is shown as the type label', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.getByTestId('field-object-user').textContent).toContain('AclUser');
  });

  it('sub-field pattern validation works (nested through the engine)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.change(screen.getByTestId('field-text-user.name'), { target: { value: 'BAD_123' } });
    expect(screen.getByTestId('field-pattern-error-user.name')).toBeTruthy();
  });

  it('sub-field shows the bare subKey as its label (parity with ArrayOfObjectField), testid stays namespaced', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    // testid is namespaced (field-text-user.name), but the visible label is "name", not "user.name".
    const nameLabel = screen.getByTestId('field-text-user.name').closest('label');
    expect(nameLabel?.textContent).toContain('name');
    expect(nameLabel?.textContent).not.toContain('user.name');
  });
});

// -- *layout: object is NOT buried in advanced-collapse (Variant B) ----------
describe('object-with-properties does not go into advanced-collapse', () => {
  it('★single object field without form → NOT inside advanced-collapse, collapse absent', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    const objectField = screen.getByTestId('field-object-user');
    // Key regression (old layout buried object in a collapsed <details>).
    expect(objectField.closest('[data-testid="advanced-collapse"]')).toBeNull();
    // No optional fields -> collapse doesn't render at all.
    expect(screen.queryByTestId('advanced-collapse')).toBeNull();
  });

  it('★object is lifted into the top group even when advanced-collapse exists (an optional field nearby)', () => {
    const schema: ScenarioInputSchema = {
      user: aclUserSchema.user,
      note: { type: 'string', required: false },
    };
    render(<StatefulFields schema={schema} />);
    const collapse = screen.getByTestId('advanced-collapse');
    const objectField = screen.getByTestId('field-object-user');
    // object is in the top group, NOT a descendant of collapse.
    expect(collapse.contains(objectField)).toBe(false);
    expect(objectField.closest('[data-testid="advanced-collapse"]')).toBeNull();
    // optional note — inside collapse (control: partitioning works at all).
    expect(collapse.contains(screen.getByTestId('field-text-note'))).toBe(true);
  });
});

// -- x-required: `*` on the object field itself (NIM-72) ----------------------
// add_user.user carries field-level required:true, backend projects it as
// x-required (the required key is taken by the array of children). UI puts `*` on the field.
const aclUserRequiredSchema: ScenarioInputSchema = {
  user: {
    ...(aclUserSchema.user as object),
    'x-required': true,
  } as unknown as ScenarioInputSchemaProperty,
};

describe('x-required → `*` on the object field', () => {
  it('isFieldRequired: true with x-required, despite required=array of children', () => {
    expect(isFieldRequired(aclUserRequiredSchema.user, {})).toBe(true);
  });

  it('isFieldRequired: false without x-required (required=array does not make the field required)', () => {
    expect(isFieldRequired(aclUserSchema.user, {})).toBe(false);
  });

  it('render: field-required-marker-user marker present with x-required', () => {
    render(<StatefulFields schema={aclUserRequiredSchema} />);
    expect(screen.getByTestId('field-required-marker-user')).toBeTruthy();
  });

  it('render: without x-required no marker on the container (sub-fields keep their own markers)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.queryByTestId('field-required-marker-user')).toBeNull();
    // Control: required sub-fields stay marked.
    expect(screen.getByTestId('field-required-marker-user.name')).toBeTruthy();
  });
});

// -- map via additional_properties --------------------------------------------
describe('additional_properties map → MapEditor', () => {
  it('renders field-map-opts, NOT field-composite-opts textarea', () => {
    render(<StatefulFields schema={additionalPropsMapSchema} />);
    expect(screen.getByTestId('field-map-opts')).toBeTruthy();
    expect(screen.queryByTestId('field-composite-opts')).toBeNull();
  });

  it('adding a pair → key/value inputs', () => {
    render(<StatefulFields schema={additionalPropsMapSchema} />);
    fireEvent.click(screen.getByTestId('field-map-add-opts'));
    expect(screen.getByTestId('field-map-key-opts-0')).toBeTruthy();
    expect(screen.getByTestId('field-map-val-opts-0')).toBeTruthy();
  });
});

// -- serialization / defaults / validation -------------------------------------
describe('serializeFields object-with-properties', () => {
  it('assembles a nested object {name,perms,state} from sub-state', () => {
    const state: ScenarioFieldsState = {
      user: JSON.stringify({ name: 'alice', perms: '+@read', state: 'on' }),
    };
    const body = serializeFields(aclUserSchema, state);
    expect(body.user).toMatchObject({ name: 'alice', perms: '+@read', state: 'on' });
  });

  it('empty sub-fields are skipped, default state=on stays', () => {
    const state: ScenarioFieldsState = {
      user: JSON.stringify({ name: '', perms: '', state: 'on' }),
    };
    const body = serializeFields(aclUserSchema, state);
    expect(body.user).toEqual({ state: 'on' });
  });

  it('empty object value → field absent from body', () => {
    const body = serializeFields(aclUserSchema, { user: '' });
    expect(body).not.toHaveProperty('user');
  });

  it('additional_properties map serializes as an object of strings', () => {
    const body = serializeFields(additionalPropsMapSchema, { opts: JSON.stringify({ FOO: 'bar' }) });
    expect(body).toEqual({ opts: { FOO: 'bar' } });
  });

  it('end-to-end UI: filling sub-fields → onChange yields a nested object', () => {
    const captured: ScenarioFieldsState[] = [];
    render(<StatefulFields schema={aclUserSchema} onChangeSpy={(s) => captured.push(s)} />);
    fireEvent.change(screen.getByTestId('field-text-user.name'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByTestId('field-text-user.perms'), { target: { value: '+@read' } });
    fireEvent.change(screen.getByTestId('field-enum-user.state'), { target: { value: 'off' } });

    const last = captured[captured.length - 1];
    expect(typeof last.user).toBe('string');
    const body = serializeFields(aclUserSchema, last);
    expect(body.user).toMatchObject({ name: 'alice', perms: '+@read', state: 'off' });
  });
});

describe('defaultsFromSchema object-with-properties', () => {
  it('AclUser: seeds a JSON string with preset (perms/state) + empty name', () => {
    const defaults = defaultsFromSchema(aclUserSchema);
    expect(typeof defaults.user).toBe('string');
    const parsed = JSON.parse(defaults.user as string);
    expect(parsed.name).toBe('');
    expect(parsed.perms).toBe('allchannels allkeys +@all -@admin -@dangerous +info');
    expect(parsed.state).toBe('on');
  });

  it('non-AclUser object: schema defaults only, no preset', () => {
    const genericSchema: ScenarioInputSchema = {
      cfg: {
        type: 'object',
        properties: { host: { type: 'string' }, port: { type: 'string', default: '6379' } },
      } as unknown as ScenarioInputSchemaProperty,
    };
    const parsed = JSON.parse(defaultsFromSchema(genericSchema).cfg as string);
    expect(parsed).toEqual({ host: '', port: '6379' });
  });
});

describe('missingRequiredFields object-level required:[children]', () => {
  it('an empty required sub-field gates submit', () => {
    const missing = missingRequiredFields(aclUserSchema, {
      user: JSON.stringify({ name: '', perms: '', state: 'on' }),
    });
    expect(missing).toContain('user.name');
    expect(missing).toContain('user.perms');
    expect(missing.length).toBeGreaterThan(0);
  });

  it('all required sub-fields filled → submit not blocked', () => {
    const missing = missingRequiredFields(aclUserSchema, {
      user: JSON.stringify({ name: 'alice', perms: '+@read', state: 'on' }),
    });
    expect(missing).toEqual([]);
  });

  it('a hidden field (show_when=false) does not gate', () => {
    const visible = new Set<string>(); // user is not visible
    const missing = missingRequiredFields(aclUserSchema, { user: '' }, visible);
    expect(missing).toEqual([]);
  });

  it('object-with-properties is not counted as invalidComposite (value is always valid JSON)', () => {
    const invalid = invalidCompositeFields(aclUserSchema, {
      user: JSON.stringify({ name: 'alice', perms: '+@read', state: 'on' }),
    });
    expect(invalid).not.toContain('user');
  });
});
