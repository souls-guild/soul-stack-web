// Tests for show_when + placeholder + hint in ScenarioInputFields.
// Checks: conditional field/section visibility, placeholder in input, hint under a field.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioForm, ScenarioInputSchema } from '../api/keeper';
import {
  computeVisibleFields,
  missingRequiredFields,
  type ScenarioFieldsState,
} from '../pages/incarnations/scenarioInputFields.helpers';

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

const SCHEMA: ScenarioInputSchema = {
  mode: { type: 'string', required: true, enum: ['standalone', 'sentinel', 'cluster'] },
  sentinels: { type: 'string', description: 'Sentinel nodes' },
  replicas: { type: 'integer', description: 'Replicas per master' },
};

function Wrapper({
  schema,
  form,
  initialState,
}: {
  schema: ScenarioInputSchema;
  form?: ScenarioForm;
  initialState?: ScenarioFieldsState;
}) {
  const [state, setState] = useState<ScenarioFieldsState>(initialState ?? {});
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={setState}
      form={form}
    />
  );
}

describe('show_when fields', () => {
  it('field with show_when=false does not render', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [
            { name: 'mode' },
            // show_when=false statically -> never visible
            { name: 'sentinels', show_when: 'false' },
          ],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    // mode renders
    expect(screen.getByTestId('field-enum-mode')).toBeInTheDocument();
    // sentinels hidden
    expect(screen.queryByTestId('field-text-sentinels')).toBeNull();
  });

  it('field with show_when reacts to value change', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [
            { name: 'mode' },
            { name: 'sentinels', show_when: 'input.mode == "sentinel"' },
          ],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);

    // Initial state: sentinels hidden (mode empty, not 'sentinel')
    expect(screen.queryByTestId('field-text-sentinels')).toBeNull();

    // Change mode -> sentinel
    fireEvent.change(screen.getByTestId('field-enum-mode'), { target: { value: 'sentinel' } });

    // Now sentinels is visible
    expect(screen.getByTestId('field-text-sentinels')).toBeInTheDocument();
  });

  it('field hides again when value changes', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [
            { name: 'mode' },
            { name: 'sentinels', show_when: 'input.mode == "cluster"' },
          ],
        },
      ],
    };
    // Start with mode=cluster -> sentinels visible
    render(<Wrapper schema={SCHEMA} form={form} initialState={{ mode: 'cluster' }} />);
    expect(screen.getByTestId('field-text-sentinels')).toBeInTheDocument();

    // Change to standalone -> sentinels hides
    fireEvent.change(screen.getByTestId('field-enum-mode'), { target: { value: 'standalone' } });
    expect(screen.queryByTestId('field-text-sentinels')).toBeNull();
  });
});

describe('show_when sections', () => {
  it('section with show_when=false hides all its fields', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [{ name: 'mode' }],
        },
        {
          key: 'advanced',
          show_when: 'input.mode == "cluster"',
          fields: [{ name: 'sentinels' }, { name: 'replicas' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);

    // advanced section hidden (mode empty)
    expect(screen.queryByTestId('form-section-advanced')).toBeNull();
    expect(screen.queryByTestId('field-text-sentinels')).toBeNull();
    expect(screen.queryByTestId('field-text-replicas')).toBeNull();

    // mode -> cluster -> section appears
    fireEvent.change(screen.getByTestId('field-enum-mode'), { target: { value: 'cluster' } });
    expect(screen.getByTestId('form-section-advanced')).toBeInTheDocument();
  });
});

describe('placeholder from form', () => {
  it('placeholder overrides prop.example', () => {
    const schemaWithExample: ScenarioInputSchema = {
      host: { type: 'string', example: 'default-example' },
    };
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [{ name: 'host', placeholder: 'custom-placeholder' }],
        },
      ],
    };
    render(<Wrapper schema={schemaWithExample} form={form} />);
    const input = screen.getByTestId('field-text-host') as HTMLInputElement;
    expect(input.placeholder).toBe('custom-placeholder');
  });

  it('without form placeholder — prop.example is used', () => {
    const schemaWithExample: ScenarioInputSchema = {
      host: { type: 'string', example: 'host.example.com' },
    };
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [{ name: 'host' }],
        },
      ],
    };
    render(<Wrapper schema={schemaWithExample} form={form} />);
    const input = screen.getByTestId('field-text-host') as HTMLInputElement;
    expect(input.placeholder).toBe('host.example.com');
  });
});

describe('hint from form', () => {
  it('hint from form is shown under the field', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [{ name: 'mode', hint: 'Select the Redis operating mode' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    expect(screen.getByTestId('field-hint-mode')).toBeInTheDocument();
    expect(screen.getByTestId('field-hint-mode').textContent).toBe('Select the Redis operating mode');
  });

  it('without form hint — prop.description is shown', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [{ name: 'sentinels' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    expect(screen.getByTestId('field-hint-sentinels').textContent).toBe('Sentinel nodes');
  });

  it('hint from form overrides prop.description', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [{ name: 'sentinels', hint: 'Override hint' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    expect(screen.getByTestId('field-hint-sentinels').textContent).toBe('Override hint');
  });
});

describe('computeVisibleFields integration', () => {
  it('hidden required field does not block submission (via missingRequiredFields)', () => {
    const schema: ScenarioInputSchema = {
      mode: { type: 'string', required: true },
      host: { type: 'string', required: true },
    };
    const form: ScenarioForm = {
      sections: [
        {
          key: 'main',
          fields: [
            { name: 'mode' },
            { name: 'host', show_when: 'input.mode == "sentinel"' },
          ],
        },
      ],
    };
    // mode = standalone, host hidden -> host should not end up in missing
    const state: ScenarioFieldsState = { mode: 'standalone' };
    const visible = computeVisibleFields(form, state);
    const missing = missingRequiredFields(schema, state, visible);
    expect(missing).not.toContain('host');
    // mode empty -> should be in missing
    expect(missing).not.toContain('mode'); // mode = 'standalone' -- not empty

    const state2: ScenarioFieldsState = {};
    const visible2 = computeVisibleFields(form, state2);
    const missing2 = missingRequiredFields(schema, state2, visible2);
    expect(missing2).toContain('mode');
    expect(missing2).not.toContain('host'); // hidden
  });
});
