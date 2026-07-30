// NIM-243: a deprecated module parameter is marked in the Run -> Command form,
// stays editable and stays submitted. The backend (NIM-205) ships the block on
// GET /v1/modules; the UI turns it into a warning with a deadline and, where the
// move is safe, a one-click switch to the successor.

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import { paramsToInputSchema } from '../pages/run/moduleParams.helpers';
import { serializeFields, defaultsFromSchema } from '../pages/incarnations/scenarioInputFields.helpers';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';
import type { ModuleParam, ScenarioInputSchema } from '../api/keeper';

// Live state wrapper: the switch button rewrites two fields at once, so the
// assertions need a real re-render rather than a spy on onChange.
function StatefulFields({ schema, initial }: { schema: ScenarioInputSchema; initial?: ScenarioFieldsState }) {
  const [state, setState] = useState<ScenarioFieldsState>(initial ?? defaultsFromSchema(schema));
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={setState}
    />
  );
}

function renderFields(schema: ScenarioInputSchema, initial?: ScenarioFieldsState) {
  render(<StatefulFields schema={schema} initial={initial} />);
}

const DEPRECATED_PARAM: ModuleParam = {
  name: 'address',
  type: 'string',
  required: false,
  deprecated: { since: '0.4.0', removed_in: '0.6.0', use: 'addr' },
};
const SUCCESSOR_PARAM: ModuleParam = { name: 'addr', type: 'string', required: false };

describe('NIM-243 — deprecation survives the ModuleParam -> input-schema projection', () => {
  it('paramsToInputSchema carries the deprecated block through verbatim', () => {
    // paramsToInputSchema copies an explicit list of keys; anything not listed is
    // dropped in silence and the form then looks like the backend sent nothing.
    const schema = paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]);
    expect(schema.address.deprecated).toEqual({ since: '0.4.0', removed_in: '0.6.0', use: 'addr' });
  });

  it('leaves the block absent for a parameter that is not deprecated', () => {
    const schema = paramsToInputSchema([SUCCESSOR_PARAM]);
    expect(schema.addr.deprecated).toBeUndefined();
    expect('deprecated' in schema.addr).toBe(false);
  });
});

describe('NIM-243 — the deprecated field is marked, not withdrawn', () => {
  it('shows the deadline sentence and the successor suggestion', () => {
    renderFields(paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]));
    const note = screen.getByTestId('field-deprecated-address');
    expect(note).toHaveTextContent('Deprecated since 0.4.0');
    expect(note).toHaveTextContent('stops working in 0.6.0');
    expect(screen.getByTestId('field-deprecated-use-address')).toHaveTextContent('Use addr instead.');
  });

  it('keeps the input present, enabled and writable', () => {
    renderFields(paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]));
    const input = screen.getByTestId('field-text-address') as HTMLInputElement;
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: '10.0.0.1' } });
    expect((screen.getByTestId('field-text-address') as HTMLInputElement).value).toBe('10.0.0.1');
  });

  it('still submits the deprecated parameter — it is honored until removed_in', () => {
    const schema = paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]);
    expect(serializeFields(schema, { address: '10.0.0.1' })).toEqual({ address: '10.0.0.1' });
  });

  it('renders the marker inside the Advanced group for an optional parameter', () => {
    // Placement is deliberate: a parameter on its way out is not promoted above
    // the fields an operator actually fills.
    renderFields(paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]));
    const advanced = screen.getByTestId('advanced-collapse');
    expect(advanced).toContainElement(screen.getByTestId('field-deprecated-address'));
  });
});

describe('NIM-243 — switching to the successor', () => {
  it('moves the value and clears the deprecated field', () => {
    const schema = paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]);
    renderFields(schema, { address: '10.0.0.1', addr: '' });
    fireEvent.click(screen.getByTestId('field-deprecated-switch-address'));
    expect((screen.getByTestId('field-text-addr') as HTMLInputElement).value).toBe('10.0.0.1');
    expect((screen.getByTestId('field-text-address') as HTMLInputElement).value).toBe('');
  });

  it('leaves only the successor in the submitted payload after the switch', () => {
    const schema = paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]);
    // The state the switch produces: source emptied, successor filled.
    expect(serializeFields(schema, { address: '', addr: '10.0.0.1' })).toEqual({ addr: '10.0.0.1' });
  });

  it('withholds the button when the successor is not declared by the module', () => {
    const schema = paramsToInputSchema([DEPRECATED_PARAM]);
    renderFields(schema, { address: '10.0.0.1' });
    expect(screen.getByTestId('field-deprecated-use-address')).toBeInTheDocument();
    expect(screen.queryByTestId('field-deprecated-switch-address')).toBeNull();
  });

  it('withholds the button when the successor already holds a value', () => {
    const schema = paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]);
    renderFields(schema, { address: '10.0.0.1', addr: 'db-01' });
    expect(screen.queryByTestId('field-deprecated-switch-address')).toBeNull();
  });

  it('withholds the button when the successor has a different type', () => {
    const schema = paramsToInputSchema([
      DEPRECATED_PARAM,
      { name: 'addr', type: 'list', required: false, items: { name: 'item', required: false, type: 'string' } },
    ]);
    renderFields(schema, { address: '10.0.0.1' });
    expect(screen.queryByTestId('field-deprecated-switch-address')).toBeNull();
  });

  it('withholds the button when the deprecated field is empty — nothing to move', () => {
    const schema = paramsToInputSchema([DEPRECATED_PARAM, SUCCESSOR_PARAM]);
    renderFields(schema, { address: '', addr: '' });
    expect(screen.queryByTestId('field-deprecated-switch-address')).toBeNull();
  });
});

describe('NIM-243 — missing bounds degrade instead of rendering "undefined"', () => {
  // Every sub-key is optional in the wire schema. The manifest validator demands
  // since+removed_in, but nothing between it and the form enforces that.
  const cases: Array<[string, ModuleParam['deprecated'], string]> = [
    ['both bounds', { since: '0.4.0', removed_in: '0.6.0' }, 'Deprecated since 0.4.0 — stops working in 0.6.0.'],
    ['since only', { since: '0.4.0' }, 'Deprecated since 0.4.0.'],
    ['removed_in only', { removed_in: '0.6.0' }, 'Deprecated — stops working in 0.6.0.'],
    ['neither bound', {}, 'This parameter is deprecated.'],
    ['successor only', { use: 'addr' }, 'This parameter is deprecated.'],
  ];

  for (const [label, deprecated, sentence] of cases) {
    it(`renders a complete sentence with ${label}`, () => {
      renderFields(paramsToInputSchema([{ ...DEPRECATED_PARAM, deprecated }]));
      const note = screen.getByTestId('field-deprecated-address');
      expect(note).toHaveTextContent(sentence);
      expect(note.textContent).not.toContain('undefined');
    });
  }
});

describe('NIM-243 — a module without deprecated parameters is untouched', () => {
  it('renders no deprecation marker anywhere', () => {
    const schema = paramsToInputSchema([
      { name: 'addr', type: 'string', required: true },
      { name: 'mode', type: 'string', required: false, enum: ['fast', 'safe'] },
    ]);
    const { container } = render(<StatefulFields schema={schema} />);
    expect(container.querySelector('[data-testid^="field-deprecated"]')).toBeNull();
    expect(container.querySelector('[role="note"]')).toBeNull();
    // The controls themselves are the ones that were there before.
    expect(screen.getByTestId('field-text-addr')).toBeInTheDocument();
    expect(screen.getByTestId('field-enum-mode')).toBeInTheDocument();
  });
});
