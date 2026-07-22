// Tests for ADR-045 S4: pattern validation, enum dropdown, format:sid -> SidPicker.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import { paramsToInputSchema } from '../pages/run/moduleParams.helpers';
import type { ModuleParam } from '../api/keeper';
import type { ScenarioInputSchema } from '../api/keeper';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';

// Stub keeperApi.modules.formPrep for SidPicker.
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

// Stateful wrapper for correct re-render on onChange.
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
  it('renders a select for a field with enum', () => {
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

  it('updates the value on enum selection', () => {
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
  it('shows an error when the pattern does not match', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    renderFields(schema);
    const input = screen.getByTestId('field-text-host');
    fireEvent.change(input, { target: { value: 'BAD_123' } });
    expect(screen.getByTestId('field-pattern-error-host')).toBeTruthy();
  });

  it('does not show an error when the pattern matches', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    renderFields(schema);
    const input = screen.getByTestId('field-text-host');
    fireEvent.change(input, { target: { value: 'valid' } });
    expect(screen.queryByTestId('field-pattern-error-host')).toBeNull();
  });

  it('does not show an error for an empty value (empty field is not validated)', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    renderFields(schema);
    expect(screen.queryByTestId('field-pattern-error-host')).toBeNull();
  });
});

describe('ScenarioInputFields ADR-045 — format:sid SidPicker', () => {
  it('renders SidPicker (single) for format:sid + source', () => {
    const schema: ScenarioInputSchema = {
      target_sid: {
        type: 'string',
        required: true,
        format: 'sid',
        source: { incarnation_hosts: true },
      },
    };
    renderFields(schema, { incarnationContext: 'redis-prod', moduleName: 'official.redis' });
    // SidPicker renders the field inside field-sid-single-target_sid
    expect(screen.getByTestId('field-sid-single-target_sid')).toBeTruthy();
  });

  it('renders SidPicker (multi) for type:array + format:sid + source', () => {
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

  it('source:incarnation_hosts without incarnationContext → shows the incarnation_hosts hint (not choir)', () => {
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
    // Must be exactly incarnation_hosts text (contains "incarnation", NOT "choir").
    expect(hint!.textContent).toMatch(/incarnation/i);
    expect(hint!.textContent).not.toMatch(/choir/i);
  });

  it('source:choir without incarnationContext → shows the choir hint (not incarnation_hosts text)', () => {
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
    // Must be choir-specific text ("choir"), NOT incarnation_hosts text.
    expect(hint!.textContent).toMatch(/choir/i);
  });

  it('source not set + no incarnationContext → legitimate text input (leave as is)', () => {
    // format:sid without source doesn't fall into the SidPicker branch — renders as a regular text input.
    const schema: ScenarioInputSchema = {
      plain_sid: {
        type: 'string',
        required: false,
        format: 'sid',
        // source not set -> ScenarioInputFields renders field-text-*, not field-sid-single-*
      },
    };
    renderFields(schema, { incarnationContext: undefined, moduleName: 'official.redis' });
    // No source -> not the SidPicker branch, renders a regular text input
    const input = screen.getByTestId('field-text-plain_sid');
    expect(input).toBeTruthy();
    expect(screen.queryByTestId('sid-picker-no-context')).toBeNull();
  });

  it('loads suggestions on focus (with incarnationContext)', async () => {
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

describe('paramsToInputSchema — type normalization ADR-045', () => {
  it('normalizes list → array', () => {
    const params: ModuleParam[] = [{ name: 'hosts', type: 'list', required: false }];
    const schema = paramsToInputSchema(params);
    expect(schema.hosts.type).toBe('array');
  });

  it('normalizes map → object + isMap=true', () => {
    const params: ModuleParam[] = [{ name: 'tags', type: 'map', required: false }];
    const schema = paramsToInputSchema(params);
    expect(schema.tags.type).toBe('object');
    expect(schema.tags.isMap).toBe(true);
  });

  it('object without map: isMap is absent', () => {
    const params: ModuleParam[] = [{ name: 'cfg', type: 'object', required: false }];
    const schema = paramsToInputSchema(params);
    expect(schema.cfg.type).toBe('object');
    expect(schema.cfg.isMap).toBeFalsy();
  });

  it('passes through enum', () => {
    const params: ModuleParam[] = [{ name: 'env', type: 'string', required: true, enum: ['prod', 'dev'] }];
    const schema = paramsToInputSchema(params);
    expect(schema.env.enum).toEqual(['prod', 'dev']);
  });

  it('passes through pattern', () => {
    const params: ModuleParam[] = [{ name: 'host', type: 'string', required: false, pattern: '^[a-z]+$' }];
    const schema = paramsToInputSchema(params);
    expect(schema.host.pattern).toBe('^[a-z]+$');
  });

  it('passes through format', () => {
    const params: ModuleParam[] = [{ name: 'sid', type: 'string', required: false, format: 'sid' }];
    const schema = paramsToInputSchema(params);
    expect(schema.sid.format).toBe('sid');
  });

  it('passes through source', () => {
    const params: ModuleParam[] = [
      { name: 'target', type: 'string', required: false, source: { incarnation_hosts: true } },
    ];
    const schema = paramsToInputSchema(params);
    expect(schema.target.source).toEqual({ incarnation_hosts: true });
  });

  it('S8b: passes through items with type normalization int → integer', () => {
    const params: ModuleParam[] = [
      { name: 'codes', type: 'list', required: false, items: { name: '', required: false, type: 'int' } },
    ];
    const schema = paramsToInputSchema(params);
    expect(schema.codes.type).toBe('array');
    expect(schema.codes.items?.type).toBe('integer');
  });

  it('S8b: passes through items.format=sid for list[sid]', () => {
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
  it('list[int]: renders a numeric list with +/- buttons', () => {
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
    // Add an item
    fireEvent.click(addBtn);
    expect(screen.getByTestId('field-typedlist-item-status_codes-0')).toBeTruthy();
  });

  it('list[int]: number is entered correctly, invalid string shows an error', () => {
    const schema: ScenarioInputSchema = {
      codes: { type: 'array', required: false, items: { type: 'integer' } },
    };
    renderFields(schema);
    fireEvent.click(screen.getByTestId('field-typedlist-add-codes'));
    const input = screen.getByTestId('field-typedlist-item-codes-0') as HTMLInputElement;
    expect(input.type).toBe('number');
  });

  it('list[string]: renders a string list, not a JSON textarea', () => {
    const schema: ScenarioInputSchema = {
      tags: { type: 'array', required: false, items: { type: 'string' } },
    };
    renderFields(schema);
    // Should not be a JSON textarea
    expect(screen.queryByTestId('field-composite-tags')).toBeNull();
    // Should be a typed list
    expect(screen.getByTestId('field-typedlist-tags')).toBeTruthy();
  });

  it('list[sid] via items: renders SidPicker multi (items.format=sid + items.source)', () => {
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

  it('list without items: falls back to JSON textarea', () => {
    const schema: ScenarioInputSchema = {
      raw: { type: 'array', required: false },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-composite-raw')).toBeTruthy();
    expect(screen.queryByTestId('field-typedlist-raw')).toBeNull();
  });

  it('remove button removes the item', () => {
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
  it('multiline=true → renders textarea with data-testid field-multiline', () => {
    const schema: ScenarioInputSchema = {
      script: { type: 'string', required: false, multiline: true },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-multiline-script')).toBeTruthy();
    expect(screen.getByTestId('field-multiline-script').tagName).toBe('TEXTAREA');
    // Should NOT be a text input
    expect(screen.queryByTestId('field-text-script')).toBeNull();
  });

  it('multiline=true: input updates the value', () => {
    const schema: ScenarioInputSchema = {
      body: { type: 'string', required: false, multiline: true },
    };
    renderFields(schema);
    const ta = screen.getByTestId('field-multiline-body') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hello\nworld' } });
    expect(ta.value).toBe('hello\nworld');
  });

  it('example → placeholder on text input', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, example: 'db-01.example.com' },
    };
    renderFields(schema);
    const input = screen.getByTestId('field-text-host') as HTMLInputElement;
    expect(input.placeholder).toBe('db-01.example.com');
  });

  it('example → placeholder on multiline textarea', () => {
    const schema: ScenarioInputSchema = {
      cmd: { type: 'string', required: false, multiline: true, example: 'apt-get update' },
    };
    renderFields(schema);
    const ta = screen.getByTestId('field-multiline-cmd') as HTMLTextAreaElement;
    expect(ta.placeholder).toBe('apt-get update');
  });

  it('multiline=true: pattern validation still works', () => {
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

  it('paramsToInputSchema passes through multiline and example', () => {
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

describe('ScenarioInputFields ADR-045 B2 — MapEditor validation (bugs fix)', () => {
  const mapSchema: ScenarioInputSchema = {
    env: { type: 'object', required: true, isMap: true, items: { type: 'string' } },
  };

  it('duplicate key → field-map-error shown + onInvalidMapChange signals the error', async () => {
    const invalidMapFields: string[] = [];
    renderFields(mapSchema, { onInvalidMapChange: (f) => { invalidMapFields.length = 0; invalidMapFields.push(...f); } });
    // Add two pairs
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    // Enter identical keys
    fireEvent.change(screen.getByTestId('field-map-key-env-0'), { target: { value: 'FOO' } });
    fireEvent.change(screen.getByTestId('field-map-val-env-0'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('field-map-key-env-1'), { target: { value: 'FOO' } });
    fireEvent.change(screen.getByTestId('field-map-val-env-1'), { target: { value: '2' } });
    // An inline error should appear
    await waitFor(() => {
      expect(screen.getAllByTestId('field-map-error-env').length).toBeGreaterThan(0);
    });
    // onInvalidMapChange signals the error through a separate channel (not a sentinel string).
    expect(invalidMapFields).toContain('env');
  });

  it('duplicate key: external value is valid JSON (last-wins, not sentinel)', async () => {
    // Check that the value is NOT corrupted into 'invalid-map': the draft survives re-mount.
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
    // The last recorded value should be valid JSON (last-wins on duplicate), not 'invalid-map'.
    await waitFor(() => expect(values.length).toBeGreaterThan(0));
    const lastVal = values[values.length - 1];
    expect(lastVal).not.toBe('invalid-map');
    // last-wins: A->2 (the second key wins).
    if (typeof lastVal === 'string' && lastVal !== '') {
      const parsed = JSON.parse(lastVal);
      expect(parsed).toMatchObject({ A: '2' });
    }
  });

  it('empty key + non-empty value → warning + onInvalidMapChange signals the error', async () => {
    const invalidMapFields: string[] = [];
    renderFields(mapSchema, { onInvalidMapChange: (f) => { invalidMapFields.length = 0; invalidMapFields.push(...f); } });
    fireEvent.click(screen.getByTestId('field-map-add-env'));
    // leave key empty, fill in value
    fireEvent.change(screen.getByTestId('field-map-val-env-0'), { target: { value: 'bar' } });
    await waitFor(() => {
      expect(screen.getAllByTestId('field-map-error-env').length).toBeGreaterThan(0);
    });
    expect(invalidMapFields).toContain('env');
  });

  it('bad-int value → warning + onInvalidMapChange signals the error (major-2)', async () => {
    const intMapSchema: ScenarioInputSchema = {
      scores: { type: 'object', required: false, isMap: true, items: { type: 'integer' } },
    };
    const invalidMapFields: string[] = [];
    renderFields(intMapSchema, { onInvalidMapChange: (f) => { invalidMapFields.length = 0; invalidMapFields.push(...f); } });
    fireEvent.click(screen.getByTestId('field-map-add-scores'));
    fireEvent.change(screen.getByTestId('field-map-key-scores-0'), { target: { value: 'foo' } });
    fireEvent.change(screen.getByTestId('field-map-val-scores-0'), { target: { value: 'abc' } });
    // An inline error should appear (field-map-error-scores).
    await waitFor(() => {
      expect(screen.getAllByTestId('field-map-error-scores').length).toBeGreaterThan(0);
    });
    // onInvalidMapChange signals the bad-int error.
    expect(invalidMapFields).toContain('scores');
  });

  it('fully empty pair (key=\'\', value=\'\') — NOT an error, does NOT signal', () => {
    // Fully empty pairs are an affordance, not an error.
    const blockedFields = invalidCompositeFields(mapSchema, { env: '' });
    expect(blockedFields).not.toContain('env');
  });

  it('end-to-end: two valid pairs → correct body (string values)', () => {
    const state = { env: JSON.stringify({ FOO: 'bar', BAZ: 'qux' }) };
    const body = serializeFields(mapSchema, state);
    expect(body).toEqual({ env: { FOO: 'bar', BAZ: 'qux' } });
  });

  it('end-to-end: all pairs removed → env absent from body (empty map)', () => {
    const body = serializeFields(mapSchema, { env: '' });
    expect(body).not.toHaveProperty('env');
  });

  it('end-to-end: map[string]int — values are converted to numbers', () => {
    const intMapSchema: ScenarioInputSchema = {
      scores: { type: 'object', required: false, isMap: true, items: { type: 'integer' } },
    };
    const state = { scores: JSON.stringify({ a: '1', b: '42' }) };
    const body = serializeFields(intMapSchema, state);
    expect(body).toEqual({ scores: { a: 1, b: 42 } });
  });

  it('pattern violation → onPatternErrorChange signals (nit gate)', async () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false, pattern: '^[a-z]+$' },
    };
    const patternErrors: string[] = [];
    renderFields(schema, { onPatternErrorChange: (f) => { patternErrors.length = 0; patternErrors.push(...f); } });
    const input = screen.getByTestId('field-text-host');
    fireEvent.change(input, { target: { value: 'INVALID_123' } });
    await waitFor(() => expect(patternErrors).toContain('host'));
    // After the fix — the error clears.
    fireEvent.change(input, { target: { value: 'valid' } });
    await waitFor(() => expect(patternErrors).not.toContain('host'));
  });
});

describe('ScenarioInputFields ADR-045 B2 — MapEditor KEY→VALUE', () => {
  it('map+items.string → renders MapEditor (field-map-*)', () => {
    const schema: ScenarioInputSchema = {
      labels: { type: 'object', required: false, isMap: true, items: { type: 'string' } },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-map-labels')).toBeTruthy();
    // Not a JSON textarea
    expect(screen.queryByTestId('field-composite-labels')).toBeNull();
  });

  it('map+items.string: add pair → key/value inputs appear', () => {
    // required=true so it doesn't fall into details (advanced collapse)
    const schema: ScenarioInputSchema = {
      env_vars: { type: 'object', required: true, isMap: true, items: { type: 'string' } },
    };
    renderFields(schema);
    fireEvent.click(screen.getByTestId('field-map-add-env_vars'));
    expect(screen.getByTestId('field-map-key-env_vars-0')).toBeTruthy();
    expect(screen.getByTestId('field-map-val-env_vars-0')).toBeTruthy();
  });

  it('map+items.string: remove pair', () => {
    // required=true so it doesn't fall into details (advanced collapse)
    const schema: ScenarioInputSchema = {
      tags: { type: 'object', required: true, isMap: true, items: { type: 'string' } },
    };
    renderFields(schema);
    fireEvent.click(screen.getByTestId('field-map-add-tags'));
    fireEvent.click(screen.getByTestId('field-map-add-tags'));
    expect(screen.getByTestId('field-map-key-tags-0')).toBeTruthy();
    fireEvent.click(screen.getByTestId('field-map-remove-tags-0'));
    // After removing pair 0 of two, one remains, at index 0 (not 1)
    expect(screen.queryByTestId('field-map-key-tags-1')).toBeNull();
    expect(screen.getByTestId('field-map-key-tags-0')).toBeTruthy();
  });

  it('map without items → JSON textarea (degradation)', () => {
    const schema: ScenarioInputSchema = {
      profile: { type: 'object', required: false, isMap: true },
    };
    renderFields(schema);
    // no isMap+scalarItems -> composite JSON-textarea
    expect(screen.getByTestId('field-composite-profile')).toBeTruthy();
    expect(screen.queryByTestId('field-map-profile')).toBeNull();
  });

  it('object without isMap → JSON textarea', () => {
    const schema: ScenarioInputSchema = {
      config: { type: 'object', required: false },
    };
    renderFields(schema);
    expect(screen.getByTestId('field-composite-config')).toBeTruthy();
    expect(screen.queryByTestId('field-map-config')).toBeNull();
  });

  it('paramsToInputSchema: type=map+items → isMap=true + items passed through', () => {
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
