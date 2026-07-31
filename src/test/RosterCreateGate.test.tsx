// Guard tests for the create form's roster gate (NIM-371 / ADR-081): a roster short of
// what the topology needs must not be submitted.
//
// The gate exists on THREE layers, each answering the same question earlier than the
// last: this form, the scenario's `validate:` rules (422 on the request), and the
// render-time `assert` over the real roster. What is pinned here is the cheapest one —
// the operator learns before pressing Create, instead of reading a 422.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationNewForm } from '../pages/incarnations/IncarnationNewForm';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const soulsList = vi.fn();

vi.mock('../api/keeper', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/keeper')>();
  return {
    ...orig,
    keeperApi: {
      ...(orig.keeperApi as object),
      souls: {
        ...((orig.keeperApi as { souls: object }).souls ?? {}),
        list: (...args: unknown[]) => soulsList(...args),
      },
    },
  };
});

// A scenario in the shape of redis create_from_souls: a declared roster plus the topology
// fields the count is derived from.
const ROSTER_SCENARIO = {
  name: 'create_from_souls',
  kind: 'lifecycle',
  path: 'scenario/create_from_souls/main.yml',
  description: 'deploy onto ready souls',
  create: true,
  input_schema: {
    hosts: {
      type: 'array',
      required: true,
      items: { type: 'string', format: 'sid', source: { roster: true } },
    },
    redis_type: { type: 'string', enum: ['sentinel', 'cluster'], default: 'sentinel' },
    replicas_per_master: { type: 'integer', default: 2 },
  },
};

function mockApi() {
  installFetchMock([
    {
      method: 'GET',
      url: /\/v1\/services\/redis\/scenarios$/,
      body: { service: 'redis', ref: 'v2.0.0', scenarios: [ROSTER_SCENARIO] },
    },
    {
      method: 'GET',
      url: '/v1/services',
      body: { items: [{ name: 'redis', git: 'git@…', ref: 'v2.0.0', created_at: '', updated_at: '' }] },
    },
    {
      method: 'POST',
      url: '/v1/incarnations',
      status: 202,
      body: { incarnation: 'redis-roster', apply_id: '01J' },
    },
  ]);
}

beforeEach(() => {
  tokenStore.set('test-token');
  soulsList.mockReset();
  soulsList.mockResolvedValue({
    items: [
      { sid: 'node-1.example.com', status: 'connected', covens: ['prod'] },
      { sid: 'node-2.example.com', status: 'connected', covens: ['prod'] },
      { sid: 'node-3.example.com', status: 'connected', covens: ['prod'] },
    ],
    total: 3,
    offset: 0,
    limit: 50,
  });
});

async function openForm() {
  mockApi();
  renderWithProviders(
    <Routes>
      <Route path="/incarnations/new" element={<IncarnationNewForm />} />
    </Routes>,
    '/incarnations/new',
  );
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('option', { name: /redis/ })).toBeInTheDocument());
  await user.selectOptions(screen.getAllByRole('combobox')[0], 'redis');
  return user;
}

describe('create form — roster gate', () => {
  it('warns while the roster is short of the topology', async () => {
    await openForm();

    // Defaults: sentinel + 2 replicas = 3 souls wanted, none picked yet.
    const warning = await screen.findByTestId('roster-count-warning');
    expect(warning).toHaveTextContent('exactly 3');
    expect(warning).toHaveTextContent('0 selected');
  });

  // A PARTIALLY filled roster is the interesting case: the field is non-empty, so the
  // ordinary required-field gate is satisfied and the count gate is the only thing left
  // to catch it. An empty roster is caught earlier, by requiredness.
  it('blocks submit on a partially filled roster and names both numbers', async () => {
    const user = await openForm();
    await screen.findByTestId('roster-count-warning');

    const input = (await screen.findByTestId('field-sid-multi-hosts')).querySelector('input')!;
    for (const sid of ['node-1.example.com', 'node-2.example.com']) {
      await user.click(input);
      await user.click(await screen.findByTestId(`sid-option-${sid}`));
    }
    await user.type(screen.getByLabelText(/name/i), 'redis-roster');

    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    const box = await screen.findByTestId('incarnation-create-error');
    expect(box).toHaveTextContent('exactly 3');
    expect(box).toHaveTextContent('2 selected');
    // Nothing was posted — the create request never left the form.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const posted = calls.some(
      (c) => String(c[0]).includes('/v1/incarnations') && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posted).toBe(false);
  });

  it('clears the warning once the roster matches, and posts the roster inside input', async () => {
    const user = await openForm();
    await screen.findByTestId('roster-count-warning');

    const input = (await screen.findByTestId('field-sid-multi-hosts')).querySelector('input')!;
    for (const sid of ['node-1.example.com', 'node-2.example.com', 'node-3.example.com']) {
      await user.click(input);
      const option = await screen.findByTestId(`sid-option-${sid}`);
      await user.click(option);
    }

    await waitFor(() =>
      expect(screen.queryByTestId('roster-count-warning')).not.toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText(/name/i), 'redis-roster');
    await user.click(screen.getByRole('button', { name: /Create incarnation/i }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const post = calls.find(
        (c) => String(c[0]).includes('/v1/incarnations') && (c[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      // The roster travels INSIDE input — the create contract has no hosts field, and the
      // keeper finds the roster by the scenario's own declaration.
      expect(body.input.hosts).toEqual([
        'node-1.example.com',
        'node-2.example.com',
        'node-3.example.com',
      ]);
      expect(body.hosts).toBeUndefined();
    });
  });

  it('re-warns when the topology changes under a filled roster', async () => {
    const user = await openForm();

    const input = (await screen.findByTestId('field-sid-multi-hosts')).querySelector('input')!;
    for (const sid of ['node-1.example.com', 'node-2.example.com', 'node-3.example.com']) {
      await user.click(input);
      await user.click(await screen.findByTestId(`sid-option-${sid}`));
    }
    await waitFor(() =>
      expect(screen.queryByTestId('roster-count-warning')).not.toBeInTheDocument(),
    );

    // One replica fewer → the topology now wants 2, and the 3 already picked are too many.
    // A count derived from the topology catches this; a literal one would not.
    const replicas = screen.getByLabelText(/replicas_per_master/i);
    await user.clear(replicas);
    await user.type(replicas, '1');

    const warning = await screen.findByTestId('roster-count-warning');
    expect(warning).toHaveTextContent('exactly 2');
    expect(warning).toHaveTextContent('3 selected');
  });
});
