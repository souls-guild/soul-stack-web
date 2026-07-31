// Guard tests for the roster picker (NIM-371 / ADR-081): a create scenario declares which
// input field carries the souls it deploys onto (`source: { roster: true }`), and the form
// collects them BEFORE the incarnation is created.
//
// What these pin, in the order the ticket cares about:
//
//  1. THE CATALOG IS THE SCOPED SOULS LIST, and it narrows by ONE thing: `connected`.
//     Not form-prep, which needs an incarnation that does not exist yet on a create
//     form. An operator must never be offered a host they could not otherwise see, and
//     reusing the scoped list is what makes that structural instead of re-stated.
//     ★ The two narrower filters this started with are BOTH wrong and are pinned as
//     such below: an incarnation's covens are inherited only once a host belongs to it
//     (ADR-080), so a candidate cannot carry them; and membership is M:N (NIM-124), so
//     serving one incarnation is no reason to hide a host from another.
//  2. THE COUNT COMES FROM THE TOPOLOGY, never a literal — it moves when shards or
//     replicas move, and the picker closes once it is met.
//  3. NO DECLARATION, NO PICKER: a plain sid field is untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import type { ScenarioInputSchema } from '../api/keeper';
import type { ScenarioFieldsState } from '../pages/incarnations/scenarioInputFields.helpers';

const soulsList = vi.fn();
const formPrep = vi.fn();

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
      modules: {
        ...((orig.keeperApi as { modules: object }).modules ?? {}),
        formPrep: (...args: unknown[]) => formPrep(...args),
      },
    },
  };
});

const ROSTER_SCHEMA: ScenarioInputSchema = {
  hosts: {
    type: 'array',
    required: true,
    items: { type: 'string', format: 'sid', source: { roster: true } },
  },
  redis_type: { type: 'string', enum: ['sentinel', 'cluster'] },
  replicas_per_master: { type: 'integer' },
  shards: { type: 'integer' },
};

function StatefulFields({
  schema,
  initial,
}: {
  schema: ScenarioInputSchema;
  initial?: ScenarioFieldsState;
}) {
  const [state, setState] = useState<ScenarioFieldsState>(initial ?? {});
  return <ScenarioInputFields schema={schema} value={state} onChange={setState} moduleName="" />;
}

beforeEach(() => {
  soulsList.mockReset();
  formPrep.mockReset();
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
  formPrep.mockResolvedValue({ sids: [], truncated: false });
});

describe('roster picker — catalog', () => {
  it('asks the scoped souls list for online hosts, and narrows by nothing else', async () => {
    render(<StatefulFields schema={ROSTER_SCHEMA} />);

    const picker = await screen.findByTestId('field-sid-multi-hosts');
    fireEvent.focus(picker.querySelector('input')!);

    await waitFor(() => expect(soulsList).toHaveBeenCalled());
    const q = soulsList.mock.calls[0][0] as Record<string, unknown>;
    // `connected` IS an invariant — the keeper refuses to bind anything else, so
    // offering it would be offering a 422.
    expect(q.status).toBe('connected');
    // Membership is M:N: a host serving another incarnation is a legitimate candidate,
    // and hiding it silently shrinks the pool the operator is choosing from.
    expect(q.unassigned).toBeUndefined();
    // An incarnation's covens reach its hosts by INHERITANCE, once they belong to it —
    // a candidate for an incarnation that does not exist yet cannot carry them. Asking
    // for them would demand the label that being picked would grant.
    expect(q.coven).toBeUndefined();

    // form-prep is the OTHER catalog and must stay out of this path: it is addressed per
    // module and both its sources need an existing incarnation.
    expect(formPrep).not.toHaveBeenCalled();
  });

  // The regression this replaced: with `unassigned` on, a fleet of six where three
  // already served an incarnation offered only three — and nothing on screen explained
  // where the others went.
  it('offers hosts that already belong to another incarnation', async () => {
    soulsList.mockResolvedValue({
      items: [
        { sid: 'free-1.example.com', status: 'connected', covens: [] },
        { sid: 'busy-1.example.com', status: 'connected', covens: ['redis-other'] },
      ],
      total: 2,
      offset: 0,
      limit: 50,
    });
    render(<StatefulFields schema={ROSTER_SCHEMA} />);

    const input = (await screen.findByTestId('field-sid-multi-hosts')).querySelector('input')!;
    fireEvent.focus(input);

    expect(await screen.findByTestId('sid-option-busy-1.example.com')).toBeInTheDocument();
    expect(await screen.findByTestId('sid-option-free-1.example.com')).toBeInTheDocument();
  });

  it('sends the typed prefix as sid_prefix so the server does the narrowing', async () => {
    render(<StatefulFields schema={ROSTER_SCHEMA} />);

    const input = (await screen.findByTestId('field-sid-multi-hosts')).querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'node-1' } });

    await waitFor(() => {
      const last = soulsList.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(last?.sid_prefix).toBe('node-1');
    });
  });

  // Filtering client-side would mean fetching a page of hosts and hiding some — the
  // operator would see a short list with no explanation, and the page boundary would
  // decide what they can pick. The server owns every filter.
  it('offers exactly what the server returned', async () => {
    soulsList.mockResolvedValue({
      items: [{ sid: 'only-one.example.com', status: 'connected', covens: ['prod'] }],
      total: 1,
      offset: 0,
      limit: 50,
    });
    render(<StatefulFields schema={ROSTER_SCHEMA} />);

    const input = (await screen.findByTestId('field-sid-multi-hosts')).querySelector('input')!;
    fireEvent.focus(input);

    expect(await screen.findByTestId('sid-option-only-one.example.com')).toBeInTheDocument();
    expect(screen.queryByTestId('sid-option-node-1.example.com')).not.toBeInTheDocument();
  });

});

describe('roster picker — count from the topology', () => {
  it('shows the count the topology asks for and moves with it', async () => {
    // sentinel with 2 replicas = 1 master + 2 = 3 souls.
    render(
      <StatefulFields
        schema={ROSTER_SCHEMA}
        initial={{ redis_type: 'sentinel', replicas_per_master: '2' }}
      />,
    );
    expect(await screen.findByTestId('sid-picker-count')).toHaveTextContent('selected 0 of 3');
  });

  it('follows the cluster formula, not a hardcoded number', async () => {
    // cluster: shards * (1 + replicas) = 3 * 2 = 6.
    render(
      <StatefulFields
        schema={ROSTER_SCHEMA}
        initial={{ redis_type: 'cluster', shards: '3', replicas_per_master: '1' }}
      />,
    );
    expect(await screen.findByTestId('sid-picker-count')).toHaveTextContent('selected 0 of 6');
  });

  it('shows no count while the topology pins no number', async () => {
    render(<StatefulFields schema={ROSTER_SCHEMA} initial={{ redis_type: 'cluster' }} />);
    await screen.findByTestId('field-sid-multi-hosts');
    expect(screen.queryByTestId('sid-picker-count')).not.toBeInTheDocument();
  });

  it('counts up as souls are picked and closes the input at capacity', async () => {
    // 1 master + 0 replicas = exactly one soul wanted.
    render(
      <StatefulFields
        schema={ROSTER_SCHEMA}
        initial={{ redis_type: 'sentinel', replicas_per_master: '0' }}
      />,
    );
    const input = (await screen.findByTestId('field-sid-multi-hosts')).querySelector('input')!;
    fireEvent.focus(input);

    const option = await screen.findByTestId('sid-option-node-1.example.com');
    fireEvent.mouseDown(option);

    await waitFor(() =>
      expect(screen.getByTestId('sid-picker-count')).toHaveTextContent('selected 1 of 1'),
    );
    // At capacity the input closes — picking an extra host would only earn a 422, since
    // the count the topology needs is exact rather than a minimum.
    expect(screen.getByTestId('sid-picker-multi-input')).toBeDisabled();
  });

  it('re-opens the input when a soul is removed', async () => {
    render(
      <StatefulFields
        schema={ROSTER_SCHEMA}
        initial={{ redis_type: 'sentinel', replicas_per_master: '0', hosts: '["node-1.example.com"]' }}
      />,
    );
    expect(await screen.findByTestId('sid-picker-multi-input')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'remove' }));

    await waitFor(() => expect(screen.getByTestId('sid-picker-multi-input')).not.toBeDisabled());
  });
});

describe('roster picker — declaration is what summons it', () => {
  it('leaves a sid field without a source as a plain text input', async () => {
    render(
      <StatefulFields
        schema={{ host: { type: 'string', format: 'sid' } }}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId('field-sid-single-host')).not.toBeInTheDocument());
    expect(soulsList).not.toHaveBeenCalled();
  });

  // An incarnation-scoped source still goes to form-prep: the two catalogs answer
  // different questions and must not be swapped by adding a third variant.
  it('keeps incarnation_hosts on form-prep', async () => {
    formPrep.mockResolvedValue({ sids: ['member.example.com'], truncated: false });
    render(
      <ScenarioInputFields
        schema={{
          peers: {
            type: 'array',
            items: { type: 'string', format: 'sid', source: { incarnation_hosts: true } },
          },
        }}
        value={{}}
        onChange={() => {}}
        incarnationContext="redis-prod"
        moduleName="core.exec.run"
      />,
    );
    const input = (await screen.findByTestId('field-sid-multi-peers')).querySelector('input')!;
    fireEvent.focus(input);

    await waitFor(() => expect(formPrep).toHaveBeenCalled());
    expect(soulsList).not.toHaveBeenCalled();
  });
});
