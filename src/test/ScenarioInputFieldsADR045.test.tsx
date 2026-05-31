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
});
