// Тесты на маркер обязательности (*) в ScenarioInputFields.
// Покрывает: required:true, required_when (истинно/ложно), обычное поле.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioInputSchema } from '../api/keeper';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';
import { isFieldRequired } from '../pages/incarnations/scenarioInputFields.helpers';

// Stub keeperApi.modules.formPrep для SidPicker (не используется в этих тестах, но нужен mock).
vi.mock('../api/keeper', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/keeper')>();
  return {
    ...orig,
    keeperApi: {
      ...(orig.keeperApi as object),
      modules: {
        ...((orig.keeperApi as { modules: object }).modules ?? {}),
        formPrep: vi.fn().mockResolvedValue({ sids: [], truncated: false }),
      },
    },
  };
});

// Stateful wrapper с полным re-render при onChange.
function StatefulFields({
  schema,
  initialState,
}: {
  schema: ScenarioInputSchema;
  initialState?: ScenarioFieldsState;
}) {
  const [state, setState] = useState<ScenarioFieldsState>(initialState ?? {});
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={setState}
    />
  );
}

// --- isFieldRequired unit-тесты ---

describe('isFieldRequired — хелпер', () => {
  it('required:true → true', () => {
    expect(isFieldRequired({ type: 'string', required: true }, {})).toBe(true);
  });

  it('required:false → false', () => {
    expect(isFieldRequired({ type: 'string', required: false }, {})).toBe(false);
  });

  it('required:true + type:boolean → false (boolean-исключение)', () => {
    expect(isFieldRequired({ type: 'boolean', required: true }, {})).toBe(false);
  });

  it('required_when истинно → true', () => {
    expect(isFieldRequired(
      { type: 'string', required_when: 'input.mode == "sentinel"' },
      { mode: 'sentinel' },
    )).toBe(true);
  });

  it('required_when ложно → false', () => {
    expect(isFieldRequired(
      { type: 'string', required_when: 'input.mode == "sentinel"' },
      { mode: 'standalone' },
    )).toBe(false);
  });

  it('ни required ни required_when → false', () => {
    expect(isFieldRequired({ type: 'string' }, {})).toBe(false);
  });
});

// --- Визуальный маркер в ScenarioInputFields ---

describe('ScenarioInputFields — маркер обязательности (*)', () => {
  it('required:true → маркер присутствует', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: true },
    };
    render(<StatefulFields schema={schema} />);
    expect(screen.getByTestId('field-required-marker-host')).toBeTruthy();
    expect(screen.getByTestId('field-required-marker-host').textContent).toBe('*');
  });

  it('required:false → маркер отсутствует', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false },
    };
    render(<StatefulFields schema={schema} />);
    expect(screen.queryByTestId('field-required-marker-host')).toBeNull();
  });

  it('поле без required → маркер отсутствует', () => {
    const schema: ScenarioInputSchema = {
      comment: { type: 'string' },
    };
    render(<StatefulFields schema={schema} />);
    expect(screen.queryByTestId('field-required-marker-comment')).toBeNull();
  });

  it('required_when ложно при начальном state → маркер отсутствует', () => {
    const schema: ScenarioInputSchema = {
      mode: { type: 'string' },
      sentinel_addr: {
        type: 'string',
        required_when: 'input.mode == "sentinel"',
      },
    };
    // mode пустое → required_when ложно
    render(<StatefulFields schema={schema} initialState={{ mode: 'standalone', sentinel_addr: '' }} />);
    expect(screen.queryByTestId('field-required-marker-sentinel_addr')).toBeNull();
  });

  it('required_when истинно → маркер присутствует', () => {
    const schema: ScenarioInputSchema = {
      mode: { type: 'string' },
      sentinel_addr: {
        type: 'string',
        required_when: 'input.mode == "sentinel"',
      },
    };
    render(<StatefulFields schema={schema} initialState={{ mode: 'sentinel', sentinel_addr: '' }} />);
    expect(screen.getByTestId('field-required-marker-sentinel_addr')).toBeTruthy();
  });

  it('required_when реактивен — маркер появляется при смене input', () => {
    const schema: ScenarioInputSchema = {
      mode: { type: 'string' },
      sentinel_addr: {
        type: 'string',
        required_when: 'input.mode == "sentinel"',
      },
    };
    render(<StatefulFields schema={schema} initialState={{ mode: 'standalone', sentinel_addr: '' }} />);
    // Изначально маркера нет
    expect(screen.queryByTestId('field-required-marker-sentinel_addr')).toBeNull();

    // Меняем mode → sentinel
    const modeInput = screen.getByTestId('field-text-mode');
    fireEvent.change(modeInput, { target: { value: 'sentinel' } });

    // Маркер появился
    expect(screen.getByTestId('field-required-marker-sentinel_addr')).toBeTruthy();

    // Возвращаем обратно
    fireEvent.change(modeInput, { target: { value: 'standalone' } });
    expect(screen.queryByTestId('field-required-marker-sentinel_addr')).toBeNull();
  });
});
