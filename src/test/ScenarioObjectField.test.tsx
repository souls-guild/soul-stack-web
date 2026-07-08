// NIM-72 guard-тесты: одиночный типизированный object (AclUser) и map по
// additional_properties больше НЕ падают в raw-JSON-textarea.
//
// Матчинг по data-testid (устойчиво к языку). Симптом-регресс: схема add_user.user
// раньше проходила мимо спец-веток → field-composite-user textarea.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../api/keeper';
import {
  isObjectWithProperties,
  isMapWithAdditionalProps,
  isCompositeType,
  mapValueType,
  serializeFields,
  defaultsFromSchema,
  missingRequiredFields,
  invalidCompositeFields,
  type ScenarioFieldsState,
} from '../pages/incarnations/scenarioInputFields.helpers';

// add_user.user — одиночный типизированный объект (backend-контракт NIM-72).
// required — массив имён обязательных под-полей (JSON-Schema), не boolean → каст.
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

// redis_settings/update_config — типизированный map через additional_properties (без isMap).
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

// ─── предикаты ────────────────────────────────────────────────────────────
describe('isObjectWithProperties хелпер', () => {
  it('true: type=object + properties (не map, не provision)', () => {
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

  it('false: map по additional_properties (нет properties)', () => {
    expect(isObjectWithProperties(additionalPropsMapSchema.opts)).toBe(false);
  });

  it('false: isMap-map', () => {
    expect(isObjectWithProperties({ type: 'object', isMap: true, items: { type: 'string' } })).toBe(false);
  });

  it('false: object без properties (голый object → JSON-textarea)', () => {
    expect(isObjectWithProperties({ type: 'object' })).toBe(false);
  });

  it('false: string-поле', () => {
    expect(isObjectWithProperties({ type: 'string' })).toBe(false);
  });
});

describe('isMapWithAdditionalProps + mapValueType', () => {
  it('true: additional_properties скалярная схема {type:string}', () => {
    expect(isMapWithAdditionalProps(additionalPropsMapSchema.opts)).toBe(true);
    expect(mapValueType(additionalPropsMapSchema.opts)).toBe('string');
  });

  it('mapValueType: integer из additional_properties', () => {
    const prop = { type: 'object', additional_properties: { type: 'integer' } } as unknown as ScenarioInputSchemaProperty;
    expect(isMapWithAdditionalProps(prop)).toBe(true);
    expect(mapValueType(prop)).toBe('integer');
  });

  it('false: additional_properties=false (типизированный объект, не map)', () => {
    expect(isMapWithAdditionalProps(aclUserSchema.user)).toBe(false);
  });

  it('false: additional_properties=true (JSON-schema allow-any → не scalar-map)', () => {
    expect(isMapWithAdditionalProps({ type: 'object', additional_properties: true })).toBe(false);
  });

  it('mapValueType всё ещё читает items.type (isMap-путь)', () => {
    expect(mapValueType({ type: 'object', isMap: true, items: { type: 'integer' } })).toBe('integer');
  });
});

describe('isCompositeType исключает object-with-properties и additional_properties-map', () => {
  it('object+properties → false (не JSON-textarea)', () => {
    expect(isCompositeType(aclUserSchema.user)).toBe(false);
  });

  it('additional_properties-map → false (не JSON-textarea)', () => {
    expect(isCompositeType(additionalPropsMapSchema.opts)).toBe(false);
  });

  it('голый object без properties → true (JSON-textarea)', () => {
    expect(isCompositeType({ type: 'object' })).toBe(true);
  });
});

// ─── регресс на симптом: textarea → типизированные под-поля ────────────────
describe('ObjectField рендер (симптом-регресс)', () => {
  it('рендерит field-object-user + под-поля, НЕ field-composite-user textarea', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.getByTestId('field-object-user')).toBeTruthy();
    // Ключевой регресс: сырой JSON-textarea НЕ рендерится.
    expect(screen.queryByTestId('field-composite-user')).toBeNull();
    // Под-поля рендерятся типизированно.
    expect(screen.getByTestId('field-text-user.name')).toBeTruthy();
    expect(screen.getByTestId('field-text-user.perms')).toBeTruthy();
    expect(screen.getByTestId('field-enum-user.state')).toBeTruthy();
  });

  it('state → <select> с опциями on/off', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    const select = screen.getByTestId('field-enum-user.state');
    expect(select.tagName).toBe('SELECT');
    const options = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('on');
    expect(options).toContain('off');
  });

  it('name/perms → text input (не enum-select)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    const nameInput = screen.getByTestId('field-text-user.name');
    expect(nameInput.tagName).toBe('INPUT');
    expect((nameInput as HTMLInputElement).type).toBe('text');
  });

  it('required-маркеры на обязательных под-полях (name, perms), не на state', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.getByTestId('field-required-marker-user.name')).toBeTruthy();
    expect(screen.getByTestId('field-required-marker-user.perms')).toBeTruthy();
    expect(screen.queryByTestId('field-required-marker-user.state')).toBeNull();
  });

  it('x-type отображается как лейбл типа', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.getByTestId('field-object-user').textContent).toContain('AclUser');
  });

  it('pattern-валидация под-поля работает (вложенно через движок)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.change(screen.getByTestId('field-text-user.name'), { target: { value: 'BAD_123' } });
    expect(screen.getByTestId('field-pattern-error-user.name')).toBeTruthy();
  });

  it('под-поле показывает голый subKey как лейбл (паритет с ArrayOfObjectField), testid остаётся namespaced', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    // testid — namespaced (field-text-user.name), но видимый лейбл — «name», не «user.name».
    const nameLabel = screen.getByTestId('field-text-user.name').closest('label');
    expect(nameLabel?.textContent).toContain('name');
    expect(nameLabel?.textContent).not.toContain('user.name');
  });
});

// ─── ★layout: object НЕ хоронится в advanced-collapse (Variant B) ──────────
describe('object-with-properties не уходит в advanced-collapse', () => {
  it('★единственное object-поле без form → НЕ внутри advanced-collapse, collapse отсутствует', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    const objectField = screen.getByTestId('field-object-user');
    // Ключевой регресс (старый layout хоронил object в свёрнутый <details>).
    expect(objectField.closest('[data-testid="advanced-collapse"]')).toBeNull();
    // Нет optional-полей → collapse не рендерится вовсе.
    expect(screen.queryByTestId('advanced-collapse')).toBeNull();
  });

  it('★object лифтится в верхнюю группу даже когда advanced-collapse есть (рядом optional-поле)', () => {
    const schema: ScenarioInputSchema = {
      user: aclUserSchema.user,
      note: { type: 'string', required: false },
    };
    render(<StatefulFields schema={schema} />);
    const collapse = screen.getByTestId('advanced-collapse');
    const objectField = screen.getByTestId('field-object-user');
    // object — в верхней группе, НЕ потомок collapse.
    expect(collapse.contains(objectField)).toBe(false);
    expect(objectField.closest('[data-testid="advanced-collapse"]')).toBeNull();
    // optional note — внутри collapse (контроль: партиция вообще работает).
    expect(collapse.contains(screen.getByTestId('field-text-note'))).toBe(true);
  });
});

// ─── map через additional_properties ──────────────────────────────────────
describe('additional_properties map → MapEditor', () => {
  it('рендерит field-map-opts, НЕ field-composite-opts textarea', () => {
    render(<StatefulFields schema={additionalPropsMapSchema} />);
    expect(screen.getByTestId('field-map-opts')).toBeTruthy();
    expect(screen.queryByTestId('field-composite-opts')).toBeNull();
  });

  it('добавление пары → key/value инпуты', () => {
    render(<StatefulFields schema={additionalPropsMapSchema} />);
    fireEvent.click(screen.getByTestId('field-map-add-opts'));
    expect(screen.getByTestId('field-map-key-opts-0')).toBeTruthy();
    expect(screen.getByTestId('field-map-val-opts-0')).toBeTruthy();
  });
});

// ─── сериализация / дефолты / валидация ────────────────────────────────────
describe('serializeFields object-with-properties', () => {
  it('собирает вложенный объект {name,perms,state} из под-state', () => {
    const state: ScenarioFieldsState = {
      user: JSON.stringify({ name: 'alice', perms: '+@read', state: 'on' }),
    };
    const body = serializeFields(aclUserSchema, state);
    expect(body.user).toMatchObject({ name: 'alice', perms: '+@read', state: 'on' });
  });

  it('пустые под-поля пропускаются, дефолтный state=on остаётся', () => {
    const state: ScenarioFieldsState = {
      user: JSON.stringify({ name: '', perms: '', state: 'on' }),
    };
    const body = serializeFields(aclUserSchema, state);
    expect(body.user).toEqual({ state: 'on' });
  });

  it('пустое значение объекта → поле отсутствует в body', () => {
    const body = serializeFields(aclUserSchema, { user: '' });
    expect(body).not.toHaveProperty('user');
  });

  it('additional_properties map сериализуется как объект строк', () => {
    const body = serializeFields(additionalPropsMapSchema, { opts: JSON.stringify({ FOO: 'bar' }) });
    expect(body).toEqual({ opts: { FOO: 'bar' } });
  });

  it('сквозной UI: заполнение под-полей → onChange даёт вложенный объект', () => {
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
  it('AclUser: сидирует JSON-строкой с preset (perms/state) + пустой name', () => {
    const defaults = defaultsFromSchema(aclUserSchema);
    expect(typeof defaults.user).toBe('string');
    const parsed = JSON.parse(defaults.user as string);
    expect(parsed.name).toBe('');
    expect(parsed.perms).toBe('allchannels allkeys +@all -@admin -@dangerous +info');
    expect(parsed.state).toBe('on');
  });

  it('не-AclUser объект: только схема-дефолты, без preset', () => {
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
  it('пустое обязательное под-поле гейтит submit', () => {
    const missing = missingRequiredFields(aclUserSchema, {
      user: JSON.stringify({ name: '', perms: '', state: 'on' }),
    });
    expect(missing).toContain('user.name');
    expect(missing).toContain('user.perms');
    expect(missing.length).toBeGreaterThan(0);
  });

  it('все обязательные под-поля заполнены → submit не блокируется', () => {
    const missing = missingRequiredFields(aclUserSchema, {
      user: JSON.stringify({ name: 'alice', perms: '+@read', state: 'on' }),
    });
    expect(missing).toEqual([]);
  });

  it('скрытое поле (show_when=false) не гейтит', () => {
    const visible = new Set<string>(); // user не виден
    const missing = missingRequiredFields(aclUserSchema, { user: '' }, visible);
    expect(missing).toEqual([]);
  });

  it('object-with-properties не считается invalidComposite (значение всегда валидный JSON)', () => {
    const invalid = invalidCompositeFields(aclUserSchema, {
      user: JSON.stringify({ name: 'alice', perms: '+@read', state: 'on' }),
    });
    expect(invalid).not.toContain('user');
  });
});
