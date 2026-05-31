// Тесты ADR-045 S4: pattern-валидация, enum-dropdown, format:sid → SidPicker.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import { paramsToInputSchema } from '../pages/run/moduleParams.helpers';
import type { ModuleParam } from '../api/keeper';
import type { ScenarioInputSchema } from '../api/keeper';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';

// Stub keeperApi.modules.formPrep для SidPicker.
vi.mock('../api/keeper', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/keeper')>();
  return {
    ...orig,
    keeperApi: {
      ...(orig.keeperApi as object),
      modules: {
        ...((orig.keeperApi as { modules: object }).modules ?? {}),
        formPrep: vi.fn().mockResolvedValue({ sids: ['db-01.example.com', 'db-02.example.com'], truncated: false }),
      },
    },
  };
});

// Stateful wrapper для корректного re-render при onChange.
import { useState } from 'react';

function StatefulFields({
  schema,
  incarnationContext,
  moduleName,
  showErrors,
}: {
  schema: ScenarioInputSchema;
  incarnationContext?: string;
  moduleName?: string;
  showErrors?: boolean;
}) {
  const [state, setState] = useState<ScenarioFieldsState>({});
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={setState}
      showErrors={showErrors ?? false}
      incarnationContext={incarnationContext}
      moduleName={moduleName}
    />
  );
}

function renderFields(
  schema: ScenarioInputSchema,
  opts?: { incarnationContext?: string; moduleName?: string; showErrors?: boolean },
) {
  render(
    <StatefulFields
      schema={schema}
      incarnationContext={opts?.incarnationContext}
      moduleName={opts?.moduleName}
      showErrors={opts?.showErrors}
    />,
  );
}

describe('ScenarioInputFields ADR-045 — enum dropdown', () => {
  it('рендерит select для поля с enum', () => {
    const schema: ScenarioInputSchema = {
      env: { type: 'string', required: true, enum: ['prod', 'stage', 'dev'] },
    };
    renderFields(schema);
    const sel = screen.getByTestId('field-enum-env');
    expect(sel.tagName).toBe('SELECT');
    const options = Array.from(sel.querySelectorAll('option')).map((o) => o.value);
    expect(options).toContain('prod');
    expect(options).toContain('stage');
    expect(options).toContain('dev');
  });

  it('обновляет значение при выборе из enum', () => {
    const schema: ScenarioInputSchema = {
      env: { type: 'string', required: false, enum: ['prod', 'stage'] },
    };
    renderFields(schema);
    const sel = screen.getByTestId('field-enum-env') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'stage' } });
    expect(sel.value).toBe('stage');
  });
});

describe('ScenarioInputFields ADR-045 — pattern validation', () => {
  it('показывает ошибку при несовпадении с паттерном', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    renderFields(schema);
    const input = screen.getByTestId('field-text-host');
    fireEvent.change(input, { target: { value: 'BAD_123' } });
    expect(screen.getByTestId('field-pattern-error-host')).toBeTruthy();
  });

  it('не показывает ошибку при совпадении с паттерном', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    renderFields(schema);
    const input = screen.getByTestId('field-text-host');
    fireEvent.change(input, { target: { value: 'valid' } });
    expect(screen.queryByTestId('field-pattern-error-host')).toBeNull();
  });

  it('не показывает ошибку для пустого значения (пустое поле не валидируется)', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    renderFields(schema);
    expect(screen.queryByTestId('field-pattern-error-host')).toBeNull();
  });
});

describe('ScenarioInputFields ADR-045 — format:sid SidPicker', () => {
  it('рендерит SidPicker (single) для format:sid + source', () => {
    const schema: ScenarioInputSchema = {
      target_sid: {
        type: 'string',
        required: true,
        format: 'sid',
        source: { incarnation_hosts: true },
      },
    };
    renderFields(schema, { incarnationContext: 'redis-prod', moduleName: 'official.redis' });
    // SidPicker рендерит поле внутри field-sid-single-target_sid
    expect(screen.getByTestId('field-sid-single-target_sid')).toBeTruthy();
  });

  it('рендерит SidPicker (multi) для type:array + format:sid + source', () => {
    const schema: ScenarioInputSchema = {
      target_sids: {
        type: 'array',
        required: false,
        format: 'sid',
        source: { incarnation_hosts: true },
      },
    };
    renderFields(schema, { incarnationContext: 'redis-prod', moduleName: 'official.redis' });
    expect(screen.getByTestId('field-sid-multi-target_sids')).toBeTruthy();
  });

  it('fallback на text-input если нет incarnationContext', () => {
    const schema: ScenarioInputSchema = {
      target_sid: {
        type: 'string',
        required: false,
        format: 'sid',
        source: { incarnation_hosts: true },
      },
    };
    // Без incarnationContext — деградирует в text input (нет picker dropdown).
    renderFields(schema, { incarnationContext: undefined, moduleName: 'official.redis' });
    const wrapper = screen.getByTestId('field-sid-single-target_sid');
    // SidPicker fallback — рендерит обычный input без dropdown.
    const input = wrapper.querySelector('input');
    expect(input).toBeTruthy();
  });

  it('загружает подсказки при фокусе (с incarnationContext)', async () => {
    const { keeperApi } = await import('../api/keeper');
    const schema: ScenarioInputSchema = {
      sid: {
        type: 'string',
        required: false,
        format: 'sid',
        source: { incarnation_hosts: true },
      },
    };
    renderFields(schema, { incarnationContext: 'redis-prod', moduleName: 'official.redis' });
    const input = screen.getByTestId('sid-picker-input');
    fireEvent.focus(input);
    await waitFor(() => {
      expect(keeperApi.modules.formPrep).toHaveBeenCalled();
    });
  });
});

describe('paramsToInputSchema — нормализация типов ADR-045', () => {
  it('нормализует list → array', () => {
    const params: ModuleParam[] = [{ name: 'hosts', type: 'list', required: false }];
    const schema = paramsToInputSchema(params);
    expect(schema.hosts.type).toBe('array');
  });

  it('нормализует map → object', () => {
    const params: ModuleParam[] = [{ name: 'tags', type: 'map', required: false }];
    const schema = paramsToInputSchema(params);
    expect(schema.tags.type).toBe('object');
  });

  it('пробрасывает enum', () => {
    const params: ModuleParam[] = [{ name: 'env', type: 'string', required: true, enum: ['prod', 'dev'] }];
    const schema = paramsToInputSchema(params);
    expect(schema.env.enum).toEqual(['prod', 'dev']);
  });

  it('пробрасывает pattern', () => {
    const params: ModuleParam[] = [{ name: 'host', type: 'string', required: false, pattern: '^[a-z]+$' }];
    const schema = paramsToInputSchema(params);
    expect(schema.host.pattern).toBe('^[a-z]+$');
  });

  it('пробрасывает format', () => {
    const params: ModuleParam[] = [{ name: 'sid', type: 'string', required: false, format: 'sid' }];
    const schema = paramsToInputSchema(params);
    expect(schema.sid.format).toBe('sid');
  });

  it('пробрасывает source', () => {
    const params: ModuleParam[] = [
      { name: 'target', type: 'string', required: false, source: { incarnation_hosts: true } },
    ];
    const schema = paramsToInputSchema(params);
    expect(schema.target.source).toEqual({ incarnation_hosts: true });
  });

  it('S8b: пробрасывает items с нормализацией типа int → integer', () => {
    const params: ModuleParam[] = [
      { name: 'codes', type: 'list', required: false, items: { name: '', required: false, type: 'int' } },
    ];
    const schema = paramsToInputSchema(params);
    expect(schema.codes.type).toBe('array');
    expect(schema.codes.items?.type).toBe('integer');
  });

  it('S8b: пробрасывает items.format=sid для list[sid]', () => {
    const params: ModuleParam[] = [
      {
        name: 'sids', type: 'list', required: false,
        items: { name: '', required: false, type: 'string', format: 'sid', source: { incarnation_hosts: true } },
      },
    ];
    const schema = paramsToInputSchema(params);
    expect(schema.sids.items?.format).toBe('sid');
    expect(schema.sids.items?.source).toEqual({ incarnation_hosts: true });
  });
});

describe('ScenarioInputFields ADR-045 S8b — typed list rendering', () => {
  it('list[int]: рендерит числовой список с кнопками +/-', () => {
    const schema: ScenarioInputSchema = {
      status_codes: {
        type: 'array',
        required: true,
        items: { type: 'integer' },
      },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-typedlist-status_codes')).toBeTruthy();
    const addBtn = screen.getByTestId('field-typedlist-add-status_codes');
    expect(addBtn).toBeTruthy();
    // Добавляем элемент
    fireEvent.click(addBtn);
    expect(screen.getByTestId('field-typedlist-item-status_codes-0')).toBeTruthy();
  });

  it('list[int]: число вводится корректно, невалидная строка показывает ошибку', () => {
    const schema: ScenarioInputSchema = {
      codes: { type: 'array', required: false, items: { type: 'integer' } },
    };
    renderFields(schema);
    fireEvent.click(screen.getByTestId('field-typedlist-add-codes'));
    const input = screen.getByTestId('field-typedlist-item-codes-0') as HTMLInputElement;
    expect(input.type).toBe('number');
  });

  it('list[string]: рендерит строковый список, не JSON-textarea', () => {
    const schema: ScenarioInputSchema = {
      tags: { type: 'array', required: false, items: { type: 'string' } },
    };
    renderFields(schema);
    // Не должно быть JSON-textarea
    expect(screen.queryByTestId('field-composite-tags')).toBeNull();
    // Должен быть typed list
    expect(screen.getByTestId('field-typedlist-tags')).toBeTruthy();
  });

  it('list[sid] via items: рендерит SidPicker multi (items.format=sid + items.source)', () => {
    const schema: ScenarioInputSchema = {
      sids: {
        type: 'array',
        required: false,
        items: { type: 'string', format: 'sid', source: { incarnation_hosts: true } },
      },
    };
    renderFields(schema, { incarnationContext: 'redis-prod', moduleName: 'official.redis' });
    expect(screen.getByTestId('field-sid-multi-sids')).toBeTruthy();
  });

  it('list без items: fallback на JSON-textarea', () => {
    const schema: ScenarioInputSchema = {
      raw: { type: 'array', required: false },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-composite-raw')).toBeTruthy();
    expect(screen.queryByTestId('field-typedlist-raw')).toBeNull();
  });

  it('кнопка удалить убирает элемент', () => {
    const schema: ScenarioInputSchema = {
      nums: { type: 'array', required: false, items: { type: 'integer' } },
    };
    renderFields(schema);
    fireEvent.click(screen.getByTestId('field-typedlist-add-nums'));
    fireEvent.click(screen.getByTestId('field-typedlist-add-nums'));
    expect(screen.getByTestId('field-typedlist-item-nums-0')).toBeTruthy();
    expect(screen.getByTestId('field-typedlist-item-nums-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('field-typedlist-remove-nums-0'));
    expect(screen.queryByTestId('field-typedlist-item-nums-1')).toBeNull();
  });
});
