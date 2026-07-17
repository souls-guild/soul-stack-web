// Tests for the required marker (*) in ScenarioInputFields.
// Covers: required:true, required_when (true/false), a regular field.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioInputSchema } from '../api/keeper';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';
import { isFieldRequired } from '../pages/incarnations/scenarioInputFields.helpers';

// Stub keeperApi.modules.formPrep for SidPicker (not used in these tests, but a mock is needed).
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

// Stateful wrapper with a full re-render on onChange.
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

// --- isFieldRequired unit tests ---

describe('isFieldRequired — helper', () => {
  it('required:true → true', () => {
    expect(isFieldRequired({ type: 'string', required: true }, {})).toBe(true);
  });

  it('required:false → false', () => {
    expect(isFieldRequired({ type: 'string', required: false }, {})).toBe(false);
  });

  it('required:true + type:boolean → false (boolean exception)', () => {
    expect(isFieldRequired({ type: 'boolean', required: true }, {})).toBe(false);
  });

  it('required_when true → true', () => {
    expect(isFieldRequired(
      { type: 'string', required_when: 'input.mode == "sentinel"' },
      { mode: 'sentinel' },
    )).toBe(true);
  });

  it('required_when false → false', () => {
    expect(isFieldRequired(
      { type: 'string', required_when: 'input.mode == "sentinel"' },
      { mode: 'standalone' },
    )).toBe(false);
  });

  it('neither required nor required_when → false', () => {
    expect(isFieldRequired({ type: 'string' }, {})).toBe(false);
  });
});

// --- Visual marker in ScenarioInputFields ---

describe('ScenarioInputFields — required marker (*)', () => {
  it('required:true → marker present', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: true },
    };
    render(<StatefulFields schema={schema} />);
    expect(screen.getByTestId('field-required-marker-host')).toBeTruthy();
    expect(screen.getByTestId('field-required-marker-host').textContent).toBe('*');
  });

  it('required:false → marker absent', () => {
    const schema: ScenarioInputSchema = {
      host: { type: 'string', required: false },
    };
    render(<StatefulFields schema={schema} />);
    expect(screen.queryByTestId('field-required-marker-host')).toBeNull();
  });

  it('field without required → marker absent', () => {
    const schema: ScenarioInputSchema = {
      comment: { type: 'string' },
    };
    render(<StatefulFields schema={schema} />);
    expect(screen.queryByTestId('field-required-marker-comment')).toBeNull();
  });

  it('required_when false at initial state → marker absent', () => {
    const schema: ScenarioInputSchema = {
      mode: { type: 'string' },
      sentinel_addr: {
        type: 'string',
        required_when: 'input.mode == "sentinel"',
      },
    };
    // mode is empty -> required_when is false
    render(<StatefulFields schema={schema} initialState={{ mode: 'standalone', sentinel_addr: '' }} />);
    expect(screen.queryByTestId('field-required-marker-sentinel_addr')).toBeNull();
  });

  it('required_when true → marker present', () => {
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

  it('required_when is reactive — marker appears when input changes', () => {
    const schema: ScenarioInputSchema = {
      mode: { type: 'string' },
      sentinel_addr: {
        type: 'string',
        required_when: 'input.mode == "sentinel"',
      },
    };
    render(<StatefulFields schema={schema} initialState={{ mode: 'standalone', sentinel_addr: '' }} />);
    // No marker initially
    expect(screen.queryByTestId('field-required-marker-sentinel_addr')).toBeNull();

    // Change mode -> sentinel
    const modeInput = screen.getByTestId('field-text-mode');
    fireEvent.change(modeInput, { target: { value: 'sentinel' } });

    // Marker appeared
    expect(screen.getByTestId('field-required-marker-sentinel_addr')).toBeTruthy();

    // Revert back
    fireEvent.change(modeInput, { target: { value: 'standalone' } });
    expect(screen.queryByTestId('field-required-marker-sentinel_addr')).toBeNull();
  });
});
