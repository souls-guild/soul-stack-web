// Tests for the ArrayOfObjectField widget (array-of-object cards with sub-fields).

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioInputSchema } from '../api/keeper';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';
import {
  isArrayOfObjectField,
  isTypedListField,
  isCompositeType,
  serializeFields,
} from '../pages/incarnations/scenarioInputFields.helpers';
import { useState } from 'react';

// Schema for the redis users field (as it arrives from the backend).
// items contains properties+required (an array of strings) - these are non-TypeScript
// fields, passed through the index-signature [key]:unknown, hence the cast via unknown.
const aclUserSchema: ScenarioInputSchema = {
  users: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        perms: { type: 'string' },
        state: { type: 'string', enum: ['on', 'off'] },
      },
      required: ['name', 'perms'],
      'x-type': 'AclUser',
    } as unknown as ScenarioInputSchemaProperty,
  },
};

// Helper stateful wrapper
import type { ScenarioInputSchemaProperty } from '../api/keeper';

function StatefulFields({
  schema,
  onChangeSpy,
}: {
  schema: ScenarioInputSchema;
  onChangeSpy?: (s: ScenarioFieldsState) => void;
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
    />
  );
}

// --------------------------------------------------------------------------
describe('isArrayOfObjectField хелпер', () => {
  it('возвращает true для array+items.type=object+properties', () => {
    expect(
      isArrayOfObjectField({
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' } } } as unknown as ScenarioInputSchemaProperty,
      }),
    ).toBe(true);
  });

  it('возвращает false для array+items.type=string', () => {
    expect(isArrayOfObjectField({ type: 'array', items: { type: 'string' } })).toBe(false);
  });

  it('возвращает false для array без items', () => {
    expect(isArrayOfObjectField({ type: 'array' })).toBe(false);
  });

  it('возвращает false для array+items.type=object без properties', () => {
    expect(isArrayOfObjectField({ type: 'array', items: { type: 'object' } })).toBe(false);
  });
});

// --------------------------------------------------------------------------
describe('isTypedListField не захватывает array-of-object', () => {
  it('array+items.type=string → true (TypedListField)', () => {
    expect(isTypedListField({ type: 'array', items: { type: 'string' } })).toBe(true);
  });

  it('array+items.type=object+properties → false (не TypedListField)', () => {
    expect(
      isTypedListField({
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' } } } as unknown as ScenarioInputSchemaProperty,
      }),
    ).toBe(false);
  });
});

// --------------------------------------------------------------------------
describe('isCompositeType не захватывает array-of-object', () => {
  it('array+items.type=object+properties → false (не composite JSON-textarea)', () => {
    expect(
      isCompositeType({
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' } } } as unknown as ScenarioInputSchemaProperty,
      }),
    ).toBe(false);
  });

  it('array без items → true (JSON-textarea)', () => {
    expect(isCompositeType({ type: 'array' })).toBe(true);
  });
});

// --------------------------------------------------------------------------
describe('ArrayOfObjectField рендер', () => {
  it('рендерит виджет field-arrayobj-*, не JSON-textarea и не TypedList', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    expect(screen.getByTestId('field-arrayobj-users')).toBeTruthy();
    expect(screen.queryByTestId('field-composite-users')).toBeNull();
    expect(screen.queryByTestId('field-typedlist-users')).toBeNull();
  });

  it('кнопка добавить создаёт карточку с под-полями name/perms/state', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    const addBtn = screen.getByTestId('field-arrayobj-add-users');
    fireEvent.click(addBtn);

    expect(screen.getByTestId('field-arrayobj-card-users-0')).toBeTruthy();
    expect(screen.getByTestId('field-arrayobj-subfield-users-0-name')).toBeTruthy();
    expect(screen.getByTestId('field-arrayobj-subfield-users-0-perms')).toBeTruthy();
    expect(screen.getByTestId('field-arrayobj-subfield-users-0-state')).toBeTruthy();
  });

  it('state → enum-select для поля с enum (on/off)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    const select = screen.getByTestId('field-arrayobj-subfield-users-0-state');
    expect(select.tagName).toBe('SELECT');
    const options = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('on');
    expect(options).toContain('off');
  });

  it('name/perms → text input (не enum)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    const nameInput = screen.getByTestId('field-arrayobj-subfield-users-0-name');
    expect(nameInput.tagName).toBe('INPUT');
    expect((nameInput as HTMLInputElement).type).toBe('text');
  });

  it('required-маркер * на обязательных под-полях (name, perms)', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    expect(screen.getByTestId('field-arrayobj-subfield-required-users-0-name')).toBeTruthy();
    expect(screen.getByTestId('field-arrayobj-subfield-required-users-0-perms')).toBeTruthy();
    // state is not required, no marker
    expect(screen.queryByTestId('field-arrayobj-subfield-required-users-0-state')).toBeNull();
  });

  it('x-type отображается как лейбл типа', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    const card = screen.getByTestId('field-arrayobj-card-users-0');
    expect(card.textContent).toContain('AclUser');
  });

  it('кнопка удалить убирает карточку', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    expect(screen.getByTestId('field-arrayobj-card-users-0')).toBeTruthy();
    expect(screen.getByTestId('field-arrayobj-card-users-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('field-arrayobj-remove-users-0'));
    expect(screen.queryByTestId('field-arrayobj-card-users-1')).toBeNull();
    expect(screen.getByTestId('field-arrayobj-card-users-0')).toBeTruthy();
  });

  it('значение = массив объектов (через onChange)', () => {
    const captured: ScenarioFieldsState[] = [];
    render(<StatefulFields schema={aclUserSchema} onChangeSpy={(s) => captured.push(s)} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    fireEvent.change(screen.getByTestId('field-arrayobj-subfield-users-0-name'), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByTestId('field-arrayobj-subfield-users-0-perms'), {
      target: { value: '+@read' },
    });
    fireEvent.change(screen.getByTestId('field-arrayobj-subfield-users-0-state') as HTMLSelectElement, {
      target: { value: 'on' },
    });

    // last value - JSON string of array of objects
    const last = captured[captured.length - 1];
    expect(typeof last.users).toBe('string');
    const parsed = JSON.parse(last.users as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({ name: 'alice', perms: '+@read', state: 'on' });
  });
});

// --------------------------------------------------------------------------
describe('ArrayOfObjectField AclUser preset', () => {
  it('при добавлении AclUser-элемента перms и state заполнены preset-значениями', () => {
    const captured: ScenarioFieldsState[] = [];
    render(<StatefulFields schema={aclUserSchema} onChangeSpy={(s) => captured.push(s)} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));

    // Check preset via onChange (captured state contains JSON string)
    const last = captured[captured.length - 1];
    expect(typeof last.users).toBe('string');
    const parsed = JSON.parse(last.users as string) as Array<Record<string, string>>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].perms).toBe('allchannels allkeys +@all -@admin -@dangerous +info');
    expect(parsed[0].state).toBe('on');
    expect(parsed[0].name).toBe('');
  });

  it('preset значение perms отображается в input после добавления', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    const permsInput = screen.getByTestId('field-arrayobj-subfield-users-0-perms') as HTMLInputElement;
    expect(permsInput.value).toBe('allchannels allkeys +@all -@admin -@dangerous +info');
  });

  it('preset state=on выбран в select после добавления', () => {
    render(<StatefulFields schema={aclUserSchema} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-users'));
    const stateSelect = screen.getByTestId('field-arrayobj-subfield-users-0-state') as HTMLSelectElement;
    expect(stateSelect.value).toBe('on');
  });

  it('non-AclUser array-of-object добавляет пустые значения (нет preset)', () => {
    const genericSchema: ScenarioInputSchema = {
      hosts: {
        type: 'array',
        required: false,
        items: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            port: { type: 'string' },
          },
        } as unknown as ScenarioInputSchemaProperty,
      },
    };
    const captured: ScenarioFieldsState[] = [];
    render(<StatefulFields schema={genericSchema} onChangeSpy={(s) => captured.push(s)} />);
    fireEvent.click(screen.getByTestId('field-arrayobj-add-hosts'));

    const last = captured[captured.length - 1];
    const parsed = JSON.parse(last.hosts as string) as Array<Record<string, string>>;
    expect(parsed[0].host).toBe('');
    expect(parsed[0].port).toBe('');
  });
});

// --------------------------------------------------------------------------
describe('serializeFields array-of-object', () => {
  it('сериализует в массив объектов (не строку)', () => {
    const state: ScenarioFieldsState = {
      users: JSON.stringify([{ name: 'alice', perms: '+@read', state: 'on' }]),
    };
    const body = serializeFields(aclUserSchema, state);
    expect(Array.isArray(body.users)).toBe(true);
    expect((body.users as Array<Record<string, string>>)[0]).toMatchObject({
      name: 'alice',
      perms: '+@read',
      state: 'on',
    });
  });

  it('пустое значение → поле отсутствует в body', () => {
    const body = serializeFields(aclUserSchema, { users: '' });
    expect(body).not.toHaveProperty('users');
  });

  it('два элемента → массив из двух объектов', () => {
    const state: ScenarioFieldsState = {
      users: JSON.stringify([
        { name: 'alice', perms: '+@read', state: 'on' },
        { name: 'bob', perms: '+@write', state: 'off' },
      ]),
    };
    const body = serializeFields(aclUserSchema, state);
    expect((body.users as unknown[]).length).toBe(2);
  });
});
