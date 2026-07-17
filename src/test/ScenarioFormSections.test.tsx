// Tests for ScenarioInputFields with form sections (Slice B).
// Checks: sectioned render, label-override, collapsed, residual section.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioForm } from '../api/keeper';
import type { ScenarioInputSchema } from '../api/keeper';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';

// Stub keeperApi for SidPicker (not used in the tests below).
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

function Wrapper({
  schema,
  form,
}: {
  schema: ScenarioInputSchema;
  form?: ScenarioForm;
}) {
  const [state, setState] = useState<ScenarioFieldsState>({});
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={setState}
      form={form}
    />
  );
}

const SCHEMA: ScenarioInputSchema = {
  username: { type: 'string', required: true, description: 'Username' },
  password: { type: 'string', required: true, description: 'Password' },
  comment:  { type: 'string', description: 'Comment' },
};

describe('ScenarioInputFields with form sections', () => {
  it('renders a flat layout when no form is provided (backward compatibility)', () => {
    render(<Wrapper schema={SCHEMA} />);
    // No sections — no testid form-section-*
    expect(screen.queryByTestId('form-section-auth')).toBeNull();
    // Fields are present
    expect(screen.getByTestId('field-text-username')).toBeInTheDocument();
  });

  it('renders sections with testid form-section-<key> when form is provided', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'auth',
          title: 'Authentication',
          fields: [{ name: 'username' }, { name: 'password' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    expect(screen.getByTestId('form-section-auth')).toBeInTheDocument();
    expect(screen.getByText('Authentication')).toBeInTheDocument();
  });

  it('a field with a label from form shows the label override instead of the field name', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'auth',
          fields: [{ name: 'username', label: 'Login name' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    // label-override should be present in the DOM
    expect(screen.getByText(/Login name/)).toBeInTheDocument();
  });

  it('fields outside sections go into the default section', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'auth',
          fields: [{ name: 'username' }],
        },
      ],
    };
    // password and comment are not in the auth section -> default section
    render(<Wrapper schema={SCHEMA} form={form} />);
    expect(screen.getByTestId('form-section-__default')).toBeInTheDocument();
    // The default section should contain password and comment
    expect(screen.getByTestId('field-text-password')).toBeInTheDocument();
  });

  it('collapsed=true renders <details> (a collapsible section)', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'advanced',
          title: 'Advanced',
          collapsed: true,
          fields: [{ name: 'comment' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    const section = screen.getByTestId('form-section-advanced');
    expect(section.tagName.toLowerCase()).toBe('details');
  });

  it('section description is rendered in the DOM', () => {
    const form: ScenarioForm = {
      sections: [
        {
          key: 'auth',
          title: 'Auth',
          description: 'Credentials for the new account',
          fields: [{ name: 'username' }],
        },
      ],
    };
    render(<Wrapper schema={SCHEMA} form={form} />);
    expect(screen.getByText('Credentials for the new account')).toBeInTheDocument();
  });

  it('empty form.sections — falls back to flat render', () => {
    const form: ScenarioForm = { sections: [] };
    render(<Wrapper schema={SCHEMA} form={form} />);
    expect(screen.queryByTestId(/form-section/)).toBeNull();
    expect(screen.getByTestId('field-text-username')).toBeInTheDocument();
  });
});
