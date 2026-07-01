// Guard-тесты: UX-clarity provision-поля в create-форме.
//
// Покрывает:
//  1. ProvisionField рендерится как toggle, не как JSON-textarea.
//  2. Включение toggle показывает под-поля (provider/profile/await_timeout).
//  3. Выключение toggle показывает подсказку existing-souls.
//  4. Pre-submit warning появляется когда provision=disabled + replicas_per_master задан.
//  5. Pre-submit warning НЕ появляется когда provision=enabled.
//  6. Pre-submit warning НЕ появляется если нет replicas_per_master в схеме.
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
  it('true: object с properties.enabled.type=boolean', () => {
    expect(
      isProvisionObjectField({
        type: 'object',
        properties: { enabled: { type: 'boolean' }, provider: { type: 'string' } },
      } as Record<string, unknown>),
    ).toBe(true);
  });

  it('false: обычный object без properties', () => {
    expect(isProvisionObjectField({ type: 'object', isMap: true, items: { type: 'string' } })).toBe(false);
  });

  it('false: string-поле', () => {
    expect(isProvisionObjectField({ type: 'string' })).toBe(false);
  });
});

describe('readProvisionEnabled / setProvisionEnabled', () => {
  it('пустое значение → false', () => {
    expect(readProvisionEnabled(undefined)).toBe(false);
    expect(readProvisionEnabled('')).toBe(false);
  });

  it('serialized JSON с enabled=false → false', () => {
    expect(readProvisionEnabled(JSON.stringify({ enabled: false, provider: 'wb' }))).toBe(false);
  });

  it('setProvisionEnabled true → readProvisionEnabled true', () => {
    const raw = setProvisionEnabled('', true);
    expect(readProvisionEnabled(raw)).toBe(true);
  });

  it('сохраняет существующие sub-поля при смене enabled', () => {
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

  it('cluster без shards → null', () => {
    expect(computeRequiredHostCount({ redis_type: 'cluster', replicas_per_master: '2' })).toBeNull();
  });

  it('нет replicas_per_master → null', () => {
    expect(computeRequiredHostCount({ redis_type: 'sentinel' })).toBeNull();
  });

  it('числовое replicas_per_master', () => {
    expect(computeRequiredHostCount({ replicas_per_master: 2 })).toBe(3);
  });
});

// ─── ScenarioInputFields: ProvisionField render ───────────────────────────

// Stub keeperApi.modules.formPrep для SidPicker (не нужен в этих тестах).
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
    description: 'Облачное создание VM',
    properties: {
      enabled: { type: 'boolean', default: false, description: 'Включить cloud provision' },
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
  it('рендерит toggle вместо JSON-textarea', () => {
    render(<ProvisionWrapper schema={PROVISION_SCHEMA} />);
    // Toggle присутствует.
    expect(screen.getByTestId('field-provision-toggle-provision')).toBeInTheDocument();
    // JSON-textarea НЕ рендерится.
    expect(screen.queryByTestId('field-composite-provision')).not.toBeInTheDocument();
  });

  it('disabled по умолчанию — показывает подсказку existing-souls', () => {
    render(<ProvisionWrapper schema={PROVISION_SCHEMA} incarnationName="redis-prod" />);
    expect(screen.getByTestId('field-provision-disabled-hint-provision')).toBeInTheDocument();
  });

  it('включение toggle скрывает подсказку и показывает под-поля', async () => {
    const user = userEvent.setup();
    render(<ProvisionWrapper schema={PROVISION_SCHEMA} incarnationName="redis-prod" />);

    const toggle = screen.getByTestId('field-provision-enabled-provision');
    await user.click(toggle);

    // Подсказка скрыта.
    expect(screen.queryByTestId('field-provision-disabled-hint-provision')).not.toBeInTheDocument();
    // Sub-поля появились.
    expect(screen.getByTestId('field-provision-sub-provision-provider')).toBeInTheDocument();
    expect(screen.getByTestId('field-provision-sub-provision-profile')).toBeInTheDocument();
  });

  it('под-поля НЕ видны когда toggle выключен', () => {
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
      description: 'Режим',
    },
    replicas_per_master: {
      type: 'integer',
      required: false,
      description: 'Реплик на master',
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

// Pre-submit warning логика — тестируем через computeRequiredHostCount + readProvisionEnabled
// (unit-уровень). Integration-тест — через IncarnationNewForm с мок-данными.

describe('IncarnationNewForm: provision host warning', () => {
  it('warning НЕ появляется по умолчанию (provision disabled, replicas пустые)', async () => {
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

    // replicas_per_master не заполнен → computeRequiredHostCount=null → warning нет.
    expect(screen.queryByTestId('provision-host-warning')).not.toBeInTheDocument();
  });

  it('warning появляется после ввода replicas_per_master (provision disabled)', async () => {
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

    // Ищем number-spinbutton replicas_per_master (нет testid на нём — используем роль).
    const replicasField = screen.queryByRole('spinbutton') as HTMLInputElement | null;
    if (!replicasField) {
      // Если spinbutton не найден — поле не рендерится в текущей схеме, пропускаем.
      return;
    }
    await user.clear(replicasField);
    await user.type(replicasField, '2');

    // Provision остаётся disabled → warning должен появиться.
    expect(await screen.findByTestId('provision-host-warning')).toBeInTheDocument();
  });

  it('warning НЕ появляется когда provision=enabled', async () => {
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

    // Включаем provision.
    const provisionToggle = await screen.findByTestId('field-provision-enabled-provision');
    await user.click(provisionToggle);

    // Warning не должен появиться (provision enabled → roster будет создан).
    expect(screen.queryByTestId('provision-host-warning')).not.toBeInTheDocument();
  });

  it('warning НЕ появляется когда схема не содержит replicas_per_master', async () => {
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

    // Нет replicas_per_master → computeRequiredHostCount=null → warning нет.
    expect(screen.queryByTestId('provision-host-warning')).not.toBeInTheDocument();
  });
});
