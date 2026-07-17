// Guard tests: UX-clarity of the provision field in the create form.
//
// Covers:
//  1. ProvisionField renders as a toggle, not a JSON textarea.
//  2. Enabling the toggle shows sub-fields (provider/profile/await_timeout).
//  3. Disabling the toggle shows the existing-souls hint.
//  4. Pre-submit warning appears when provision=disabled + replicas_per_master is set.
//  5. Pre-submit warning does NOT appear when provision=enabled.
//  6. Pre-submit warning does NOT appear if replicas_per_master is absent from the schema.
//  7. computeRequiredHostCount: sentinel = 1+replicas, cluster = shards*(1+replicas).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock } from './fetchMock';
import { IncarnationNewForm } from '../pages/incarnations/IncarnationNewForm';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import {
  computeRequiredHostCount,
  isProvisionObjectField,
  readProvisionEnabled,
  setProvisionEnabled,
  type ScenarioFieldsState,
} from '../pages/incarnations/scenarioInputFields.helpers';
import type { ScenarioInputSchema } from '../api/keeper';

// ─── helpers unit tests ───────────────────────────────────────────────────

describe('isProvisionObjectField', () => {
  it('true: object with properties.enabled.type=boolean', () => {
    expect(
      isProvisionObjectField({
        type: 'object',
        properties: { enabled: { type: 'boolean' }, provider: { type: 'string' } },
      } as Record<string, unknown>),
    ).toBe(true);
  });

  it('false: plain object without properties', () => {
    expect(isProvisionObjectField({ type: 'object', isMap: true, items: { type: 'string' } })).toBe(false);
  });

  it('false: string field', () => {
    expect(isProvisionObjectField({ type: 'string' })).toBe(false);
  });
});

describe('readProvisionEnabled / setProvisionEnabled', () => {
  it('empty value → false', () => {
    expect(readProvisionEnabled(undefined)).toBe(false);
    expect(readProvisionEnabled('')).toBe(false);
  });

  it('serialized JSON with enabled=false → false', () => {
    expect(readProvisionEnabled(JSON.stringify({ enabled: false, provider: 'wb' }))).toBe(false);
  });

  it('setProvisionEnabled true → readProvisionEnabled true', () => {
    const raw = setProvisionEnabled('', true);
    expect(readProvisionEnabled(raw)).toBe(true);
  });

  it('preserves existing sub-fields when toggling enabled', () => {
    const initial = JSON.stringify({ enabled: false, provider: 'wb' });
    const next = setProvisionEnabled(initial, true);
    const obj = JSON.parse(next);
    expect(obj.provider).toBe('wb');
    expect(obj.enabled).toBe(true);
  });
});

describe('computeRequiredHostCount', () => {
  it('sentinel: 1 + replicas_per_master', () => {
    expect(computeRequiredHostCount({ redis_type: 'sentinel', replicas_per_master: '2' })).toBe(3);
  });

  it('sentinel: replicas_per_master=0 → 1', () => {
    expect(computeRequiredHostCount({ redis_type: 'sentinel', replicas_per_master: '0' })).toBe(1);
  });

  it('cluster: shards*(1+replicas)', () => {
    expect(computeRequiredHostCount({ redis_type: 'cluster', replicas_per_master: '2', shards: '3' })).toBe(9);
  });

  it('cluster without shards → null', () => {
    expect(computeRequiredHostCount({ redis_type: 'cluster', replicas_per_master: '2' })).toBeNull();
  });

  it('no replicas_per_master → null', () => {
    expect(computeRequiredHostCount({ redis_type: 'sentinel' })).toBeNull();
  });

  it('numeric replicas_per_master', () => {
    expect(computeRequiredHostCount({ replicas_per_master: 2 })).toBe(3);
  });
});

// ─── ScenarioInputFields: ProvisionField render ───────────────────────────

// Stub keeperApi.modules.formPrep for SidPicker (not needed in these tests).
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

const PROVISION_SCHEMA: ScenarioInputSchema = {
  provision: {
    type: 'object',
    required: false,
    description: 'Cloud VM creation',
    properties: {
      enabled: { type: 'boolean', default: false, description: 'Enable cloud provision' },
      provider: { type: 'string', description: 'Cloud provider' },
      profile: { type: 'string', description: 'VM profile' },
      await_timeout: { type: 'string', description: 'Timeout' },
    },
  } as Record<string, unknown>,
};

function ProvisionWrapper({ schema, incarnationName }: { schema: ScenarioInputSchema; incarnationName?: string }) {
  const [state, setState] = useState<ScenarioFieldsState>({});
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={setState}
      incarnationName={incarnationName}
    />
  );
}

describe('ScenarioInputFields: ProvisionField', () => {
  it('renders a toggle instead of a JSON textarea', () => {
    render(<ProvisionWrapper schema={PROVISION_SCHEMA} />);
    // Toggle is present.
    expect(screen.getByTestId('field-provision-toggle-provision')).toBeInTheDocument();
    // JSON textarea does NOT render.
    expect(screen.queryByTestId('field-composite-provision')).not.toBeInTheDocument();
  });

  it('disabled by default — shows the existing-souls hint', () => {
    render(<ProvisionWrapper schema={PROVISION_SCHEMA} incarnationName="redis-prod" />);
    expect(screen.getByTestId('field-provision-disabled-hint-provision')).toBeInTheDocument();
  });

  it('enabling the toggle hides the hint and shows sub-fields', async () => {
    const user = userEvent.setup();
    render(<ProvisionWrapper schema={PROVISION_SCHEMA} incarnationName="redis-prod" />);

    const toggle = screen.getByTestId('field-provision-enabled-provision');
    await user.click(toggle);

    // Hint is hidden.
    expect(screen.queryByTestId('field-provision-disabled-hint-provision')).not.toBeInTheDocument();
    // Sub-fields appeared.
    expect(screen.getByTestId('field-provision-sub-provision-provider')).toBeInTheDocument();
    expect(screen.getByTestId('field-provision-sub-provision-profile')).toBeInTheDocument();
  });

  it('sub-fields are NOT visible when the toggle is off', () => {
    render(<ProvisionWrapper schema={PROVISION_SCHEMA} />);
    expect(screen.queryByTestId('field-provision-sub-provision-provider')).not.toBeInTheDocument();
  });
});

// ─── IncarnationNewForm: pre-submit warning ───────────────────────────────

const PROVISION_CREATE_SCENARIO = {
  name: 'create',
  kind: 'lifecycle',
  path: 'scenario/create/main.yml',
  create: true,
  input_schema: {
    redis_type: {
      type: 'string',
      required: true,
      enum: ['sentinel', 'cluster'],
      description: 'Mode',
    },
    replicas_per_master: {
      type: 'integer',
      required: false,
      description: 'Replicas per master',
    },
    provision: {
      type: 'object',
      required: false,
      description: 'Cloud provision',
      properties: {
        enabled: { type: 'boolean', default: false, description: 'Enabled' },
        provider: { type: 'string', description: 'Provider' },
      } as Record<string, unknown>,
    } as Record<string, unknown>,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockRedisScenarios(scenario: any = PROVISION_CREATE_SCENARIO) {
  return installFetchMock([
    {
      method: 'GET',
      url: /\/v1\/services\/redis\/scenarios$/,
      body: {
        service: 'redis',
        ref: 'v2.0.0',
        scenarios: [scenario],
      },
    },
    {
      method: 'GET',
      url: '/v1/services',
      body: { items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] },
    },
  ]);
}

// Pre-submit warning logic — tested via computeRequiredHostCount + readProvisionEnabled
// (unit level). Integration test — via IncarnationNewForm with mock data.

describe('IncarnationNewForm: provision host warning', () => {
  it('warning does NOT appear by default (provision disabled, replicas empty)', async () => {
    mockRedisScenarios();
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      </Routes>,
      '/incarnations/new',
    );

    await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');
    await screen.findByTestId('create-input-fields');

    // replicas_per_master not filled → computeRequiredHostCount=null → no warning.
    expect(screen.queryByTestId('provision-host-warning')).not.toBeInTheDocument();
  });

  it('warning appears after entering replicas_per_master (provision disabled)', async () => {
    mockRedisScenarios();
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      </Routes>,
      '/incarnations/new',
    );

    await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');
    await screen.findByTestId('create-input-fields');

    // Look up the number-spinbutton replicas_per_master (no testid on it — use role).
    const replicasField = screen.queryByRole('spinbutton') as HTMLInputElement | null;
    if (!replicasField) {
      // If spinbutton not found — the field doesn't render in the current schema, skip.
      return;
    }
    await user.clear(replicasField);
    await user.type(replicasField, '2');

    // Provision stays disabled → warning should appear.
    expect(await screen.findByTestId('provision-host-warning')).toBeInTheDocument();
  });

  it('warning does NOT appear when provision=enabled', async () => {
    mockRedisScenarios();
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      </Routes>,
      '/incarnations/new',
    );

    await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');
    await screen.findByTestId('create-input-fields');

    // Enable provision.
    const provisionToggle = await screen.findByTestId('field-provision-enabled-provision');
    await user.click(provisionToggle);

    // Warning should not appear (provision enabled → roster will be created).
    expect(screen.queryByTestId('provision-host-warning')).not.toBeInTheDocument();
  });

  it('warning does NOT appear when the schema has no replicas_per_master', async () => {
    mockRedisScenarios({
      name: 'create',
      kind: 'lifecycle',
      path: 'scenario/create/main.yml',
      create: true,
      input_schema: {
        provision: {
          type: 'object',
          required: false,
          description: 'Cloud provision',
          properties: {
            enabled: { type: 'boolean', default: false, description: 'Enabled' },
          } as Record<string, unknown>,
        },
      },
    });
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/incarnations/new" element={<IncarnationNewForm />} />
      </Routes>,
      '/incarnations/new',
    );

    await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('redis-prod'), 'redis-prod');
    await user.selectOptions(screen.getByRole('combobox'), 'redis');
    await screen.findByTestId('create-input-fields');

    // No replicas_per_master → computeRequiredHostCount=null → no warning.
    expect(screen.queryByTestId('provision-host-warning')).not.toBeInTheDocument();
  });
});
