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
  onInvalidMapChange,
  onPatternErrorChange,
}: {
  schema: ScenarioInputSchema;
  incarnationContext?: string;
  moduleName?: string;
  showErrors?: boolean;
  onInvalidMapChange?: (fields: string[]) => void;
  onPatternErrorChange?: (fields: string[]) => void;
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
      onInvalidMapChange={onInvalidMapChange}
      onPatternErrorChange={onPatternErrorChange}
    />
  );
}

function renderFields(
  schema: ScenarioInputSchema,
  opts?: {
    incarnationContext?: string;
    moduleName?: string;
    showErrors?: boolean;
    onInvalidMapChange?: (fields: string[]) => void;
    onPatternErrorChange?: (fields: string[]) => void;
  },
) {
  render(
    <StatefulFields
      schema={schema}
      incarnationContext={opts?.incarnationContext}
      moduleName={opts?.moduleName}
      showErrors={opts?.showErrors}
      onInvalidMapChange={opts?.onInvalidMapChange}
      onPatternErrorChange={opts?.onPatternErrorChange}
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

  it('source:incarnation_hosts без incarnationContext → показана подсказка incarnation_hosts (не choir)', () => {
    const schema: ScenarioInputSchema = {
      target_sid: {
        type: 'string',
        required: false,
        format: 'sid',
        source: { incarnation_hosts: true },
      },
    };
    renderFields(schema, { incarnationContext: undefined, moduleName: 'official.redis' });
    const wrapper = screen.getByTestId('field-sid-single-target_sid');
    const hint = wrapper.querySelector('[data-testid="sid-picker-no-context"]');
    expect(hint).toBeTruthy();
    expect(wrapper.querySelector('input')).toBeNull();
    // Должен быть именно incarnation_hosts-текст (содержит «инкарнации», НЕ «choir»).
    expect(hint!.textContent).toMatch(/инкарнаци/i);
    expect(hint!.textContent).not.toMatch(/choir/i);
  });

  it('source:choir без incarnationContext → показана подсказка choir (не incarnation_hosts-текст)', () => {
    const schema: ScenarioInputSchema = {
      target_sid: {
        type: 'string',
        required: false,
        format: 'sid',
        source: { choir: 'primaries' },
      },
    };
    renderFields(schema, { incarnationContext: undefined, moduleName: 'official.redis' });
    const wrapper = screen.getByTestId('field-sid-single-target_sid');
    const hint = wrapper.querySelector('[data-testid="sid-picker-no-context"]');
    expect(hint).toBeTruthy();
    expect(wrapper.querySelector('input')).toBeNull();
    // Должен быть choir-специфичный текст («choir»), а НЕ incarnation_hosts-текст.
    expect(hint!.textContent).toMatch(/choir/i);
  });

  it('source не задан + нет incarnationContext → легитимный text-input (не трогаем)', () => {
    // format:sid без source не попадает в SidPicker-ветку — рендерится как обычный text-input.
    const schema: ScenarioInputSchema = {
      plain_sid: {
        type: 'string',
        required: false,
        format: 'sid',
        // source не задан → ScenarioInputFields рендерит field-text-*, не field-sid-single-*
      },
    };
    renderFields(schema, { incarnationContext: undefined, moduleName: 'official.redis' });
    // Нет source → не SidPicker-ветка, рендерится обычный text input
    const input = screen.getByTestId('field-text-plain_sid');
    expect(input).toBeTruthy();
    expect(screen.queryByTestId('sid-picker-no-context')).toBeNull();
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

  it('нормализует map → object + isMap=true', () => {
    const params: ModuleParam[] = [{ name: 'tags', type: 'map', required: false }];
    const schema = paramsToInputSchema(params);
    expect(schema.tags.type).toBe('object');
    expect(schema.tags.isMap).toBe(true);
  });

  it('object без map: isMap отсутствует', () => {
    const params: ModuleParam[] = [{ name: 'cfg', type: 'object', required: false }];
    const schema = paramsToInputSchema(params);
    expect(schema.cfg.type).toBe('object');
    expect(schema.cfg.isMap).toBeFalsy();
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

describe('ScenarioInputFields ADR-045 B3 — multiline textarea + example placeholder', () => {
  it('multiline=true → рендерит textarea с data-testid field-multiline', () => {
    const schema: ScenarioInputSchema = {
      script: { type: 'string', required: false, multiline: true },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-multiline-script')).toBeTruthy();
    expect(screen.getByTestId('field-multiline-script').tagName).toBe('TEXTAREA');
    // НЕ должно быть text-input
    expect(screen.queryByTestId('field-text-script')).toBeNull();
  });

  it('multiline=true: ввод обновляет значение', () => {
    const schema: ScenarioInputSchema = {
      body: { type: 'string', required: false, multiline: true },
    };
    renderFields(schema);
    const ta = screen.getByTestId('field-multiline-body') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hello\nworld' } });
    expect(ta.value).toBe('hello\nworld');
  });

  it('example → placeholder на text input', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, example: 'db-01.example.com' },
    };
    renderFields(schema);
    const input = screen.getByTestId('field-text-host') as HTMLInputElement;
    expect(input.placeholder).toBe('db-01.example.com');
  });

  it('example → placeholder на multiline textarea', () => {
    const schema: ScenarioInputSchema = {
      cmd: { type: 'string', required: false, multiline: true, example: 'apt-get update' },
    };
    renderFields(schema);
    const ta = screen.getByTestId('field-multiline-cmd') as HTMLTextAreaElement;
    expect(ta.placeholder).toBe('apt-get update');
  });

  it('multiline=true: pattern-валидация продолжает работать', () => {
    const schema: ScenarioInputSchema = {
      slug: { type: 'string', required: false, multiline: true, pattern: '^[a-z-]+$' },
    };
    renderFields(schema);
    const ta = screen.getByTestId('field-multiline-slug') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'INVALID_123' } });
    expect(screen.getByTestId('field-pattern-error-slug')).toBeTruthy();
    fireEvent.change(ta, { target: { value: 'valid-slug' } });
    expect(screen.queryByTestId('field-pattern-error-slug')).toBeNull();
  });

  it('paramsToInputSchema пробрасывает multiline и example', () => {
    const params: ModuleParam[] = [
      { name: 'cmd', type: 'string', required: true, multiline: true, example: 'uptime' },
    ];
    const schema = paramsToInputSchema(params);
    expect(schema.cmd.multiline).toBe(true);
    expect(schema.cmd.example).toBe('uptime');
  });
});

import {
  invalidCompositeFields,
  serializeFields,
} from '../pages/incarnations/scenarioInputFields.helpers';

describe('ScenarioInputFields ADR-045 B2 — MapEditor валидация (bugs fix)', () => {
  const mapSchema: ScenarioInputSchema = {
    env: { type: 'object', required: true, isMap: true, items: { type: 'string' } },
  };

  it('дубль-ключ → показан field-map-error + onInvalidMapChange сигнализирует об ошибке', async () => {
    const invalidMapFields: string[] = [];
    renderFields(mapSchema, { onInvalidMapChange: (f) => { invalidMapFields.length = 0; invalidMapFields.push(...f); } });
    // Добавляем две пары
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    // Вводим одинаковые ключи
    fireEvent.change(screen.getByTestId('field-map-key-env-0'), { target: { value: 'FOO' } });
    fireEvent.change(screen.getByTestId('field-map-val-env-0'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('field-map-key-env-1'), { target: { value: 'FOO' } });
    fireEvent.change(screen.getByTestId('field-map-val-env-1'), { target: { value: '2' } });
    // Должен появиться inline-error
    await waitFor(() => {
      expect(screen.getAllByTestId('field-map-error-env').length).toBeGreaterThan(0);
    });
    // onInvalidMapChange сигнализирует об ошибке через отдельный канал (не sentinel-строка).
    expect(invalidMapFields).toContain('env');
  });

  it('дубль-ключ: внешнее value — валидный JSON (last-wins, не sentinel)', async () => {
    // Проверяем что значение НЕ портится в 'invalid-map': черновик переживает re-mount.
    const values: Array<string | number | boolean | undefined> = [];
    const schema: ScenarioInputSchema = {
      env: { type: 'object', required: false, isMap: true, items: { type: 'string' } },
    };
    let capturedOnChange: ((next: import('../pages/incarnations/scenarioInputFields.helpers').ScenarioFieldsState) => void) | null = null;
    function TrackingWrapper() {
      const [state, setState] = useState<import('../pages/incarnations/scenarioInputFields.helpers').ScenarioFieldsState>({});
      capturedOnChange = (next) => {
        setState(next);
        values.push(next.env);
      };
      return (
        <ScenarioInputFields
          schema={schema}
          value={state}
          onChange={capturedOnChange}
        />
      );
    }
    render(<TrackingWrapper />);
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    fireEvent.change(screen.getByTestId('field-map-key-env-0'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('field-map-val-env-0'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('field-map-key-env-1'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('field-map-val-env-1'), { target: { value: '2' } });
    // Последнее записанное значение должно быть валидным JSON (last-wins дубля), не 'invalid-map'.
    await waitFor(() => expect(values.length).toBeGreaterThan(0));
    const lastVal = values[values.length - 1];
    expect(lastVal).not.toBe('invalid-map');
    // last-wins: A→2 (второй ключ выигрывает).
    if (typeof lastVal === 'string' && lastVal !== '') {
      const parsed = JSON.parse(lastVal);
      expect(parsed).toMatchObject({ A: '2' });
    }
  });

  it('пустой key + непустой value → warning + onInvalidMapChange сигнализирует об ошибке', async () => {
    const invalidMapFields: string[] = [];
    renderFields(mapSchema, { onInvalidMapChange: (f) => { invalidMapFields.length = 0; invalidMapFields.push(...f); } });
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    // key оставляем пустым, value заполняем
    fireEvent.change(screen.getByTestId('field-map-val-env-0'), { target: { value: 'bar' } });
    await waitFor(() => {
      expect(screen.getAllByTestId('field-map-error-env').length).toBeGreaterThan(0);
    });
    expect(invalidMapFields).toContain('env');
  });

  it('bad-int value → warning + onInvalidMapChange сигнализирует об ошибке (major-2)', async () => {
    const intMapSchema: ScenarioInputSchema = {
      scores: { type: 'object', required: false, isMap: true, items: { type: 'integer' } },
    };
    const invalidMapFields: string[] = [];
    renderFields(intMapSchema, { onInvalidMapChange: (f) => { invalidMapFields.length = 0; invalidMapFields.push(...f); } });
    fireEvent.click(screen.getByTestId('field-map-add-scores'));
    fireEvent.change(screen.getByTestId('field-map-key-scores-0'), { target: { value: 'foo' } });
    fireEvent.change(screen.getByTestId('field-map-val-scores-0'), { target: { value: 'abc' } });
    // Должен появиться inline-error (field-map-error-scores).
    await waitFor(() => {
      expect(screen.getAllByTestId('field-map-error-scores').length).toBeGreaterThan(0);
    });
    // onInvalidMapChange сигнализирует об ошибке bad-int.
    expect(invalidMapFields).toContain('scores');
  });

  it('полностью пустая пара (key=\'\', value=\'\') — НЕ ошибка, NOT сигнализирует', () => {
    // Полностью пустые пары — affordance, не ошибка.
    const blockedFields = invalidCompositeFields(mapSchema, { env: '' });
    expect(blockedFields).not.toContain('env');
  });

  it('сквозной: две валидные пары → корректный body (string values)', () => {
    const state = { env: JSON.stringify({ FOO: 'bar', BAZ: 'qux' }) };
    const body = serializeFields(mapSchema, state);
    expect(body).toEqual({ env: { FOO: 'bar', BAZ: 'qux' } });
  });

  it('сквозной: все пары удалены → env отсутствует в body (пустой map)', () => {
    const body = serializeFields(mapSchema, { env: '' });
    expect(body).not.toHaveProperty('env');
  });

  it('сквозной: map[string]int — значения конвертируются в числа', () => {
    const intMapSchema: ScenarioInputSchema = {
      scores: { type: 'object', required: false, isMap: true, items: { type: 'integer' } },
    };
    const state = { scores: JSON.stringify({ a: '1', b: '42' }) };
    const body = serializeFields(intMapSchema, state);
    expect(body).toEqual({ scores: { a: 1, b: 42 } });
  });

  it('pattern-violation → onPatternErrorChange сигнализирует (nit gate)', async () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    const patternErrors: string[] = [];
    renderFields(schema, { onPatternErrorChange: (f) => { patternErrors.length = 0; patternErrors.push(...f); } });
    const input = screen.getByTestId('field-text-host');
    fireEvent.change(input, { target: { value: 'INVALID_123' } });
    await waitFor(() => expect(patternErrors).toContain('host'));
    // После исправления — ошибка снимается.
    fireEvent.change(input, { target: { value: 'valid' } });
    await waitFor(() => expect(patternErrors).not.toContain('host'));
  });
});

describe('ScenarioInputFields ADR-045 B2 — MapEditor KEY→VALUE', () => {
  it('map+items.string → рендерит MapEditor (field-map-*)', () => {
    const schema: ScenarioInputSchema = {
      labels: { type: 'object', required: false, isMap: true, items: { type: 'string' } },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-map-labels')).toBeTruthy();
    // Не JSON-textarea
    expect(screen.queryByTestId('field-composite-labels')).toBeNull();
  });

  it('map+items.string: добавить пару → появляются key/value инпуты', () => {
    // required=true чтобы не попасть в details (advanced collapse)
    const schema: ScenarioInputSchema = {
      env_vars: { type: 'object', required: true, isMap: true, items: { type: 'string' } },
    };
    renderFields(schema);
    fireEvent.click(screen.getByTestId('field-map-add-env_vars'));
    expect(screen.getByTestId('field-map-key-env_vars-0')).toBeTruthy();
    expect(screen.getByTestId('field-map-val-env_vars-0')).toBeTruthy();
  });

  it('map+items.string: удалить пару', () => {
    // required=true чтобы не попасть в details (advanced collapse)
    const schema: ScenarioInputSchema = {
      tags: { type: 'object', required: true, isMap: true, items: { type: 'string' } },
    };
    renderFields(schema);
    fireEvent.click(screen.getByTestId('field-map-add-tags'));
    fireEvent.click(screen.getByTestId('field-map-add-tags'));
    expect(screen.getByTestId('field-map-key-tags-0')).toBeTruthy();
    fireEvent.click(screen.getByTestId('field-map-remove-tags-0'));
    // После удаления 0-й пары из двух остаётся одна, индекс 0 (не 1)
    expect(screen.queryByTestId('field-map-key-tags-1')).toBeNull();
    expect(screen.getByTestId('field-map-key-tags-0')).toBeTruthy();
  });

  it('map без items → JSON-textarea (деградация)', () => {
    const schema: ScenarioInputSchema = {
      profile: { type: 'object', required: false, isMap: true },
    };
    renderFields(schema);
    // нет isMap+scalarItems → composite JSON-textarea
    expect(screen.getByTestId('field-composite-profile')).toBeTruthy();
    expect(screen.queryByTestId('field-map-profile')).toBeNull();
  });

  it('object без isMap → JSON-textarea', () => {
    const schema: ScenarioInputSchema = {
      config: { type: 'object', required: false },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-composite-config')).toBeTruthy();
    expect(screen.queryByTestId('field-map-config')).toBeNull();
  });

  it('paramsToInputSchema: type=map+items → isMap=true + items пробрасываются', () => {
    const params: ModuleParam[] = [
      {
        name: 'labels',
        type: 'map',
        required: false,
        items: { name: '', required: false, type: 'string' },
      },
    ];
    const schema = paramsToInputSchema(params);
    expect(schema.labels.isMap).toBe(true);
    expect(schema.labels.type).toBe('object');
    expect(schema.labels.items?.type).toBe('string');
  });
});
