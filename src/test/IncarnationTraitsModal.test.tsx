import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders } from './renderWithProviders';
import { IncarnationTraitsModal } from '../pages/incarnations/IncarnationTraitsModal';
import { tokenStore } from '../api/tokenStore';

const noop = () => {};

function installPutMock() {
  const puts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT') {
      puts.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ name: 'redis-prod' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 599 });
  });
  return puts;
}

describe('IncarnationTraitsModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('prefill: current traits (scalar + list) shown on open', () => {
    renderWithProviders(
      <IncarnationTraitsModal
        open
        incarnationName="redis-prod"
        currentTraits={{ env: 'prod', regions: ['eu', 'us'] }}
        onClose={noop}
      />,
    );

    expect(screen.getAllByTestId('trait-row')).toHaveLength(2);
    const keys = screen.getAllByRole('textbox', { name: /trait key/i });
    expect(keys[0]).toHaveValue('env');
    expect(keys[1]).toHaveValue('regions');
    expect(screen.getByRole('textbox', { name: /trait value/i })).toHaveValue('prod');
    expect(screen.getByText('eu')).toBeInTheDocument();
    expect(screen.getByText('us')).toBeInTheDocument();
    expect(screen.getByText(/pre-filled with current values/)).toBeInTheDocument();
  });

  it('editor is empty without currentTraits', () => {
    renderWithProviders(
      <IncarnationTraitsModal open incarnationName="redis-prod" onClose={noop} />,
    );
    expect(screen.queryAllByTestId('trait-row')).toHaveLength(0);
    expect(screen.getByTestId('traits-add-row')).toBeInTheDocument();
  });

  it('adding a trait keeps prefilled values in the PUT (full set)', async () => {
    const puts = installPutMock();
    renderWithProviders(
      <IncarnationTraitsModal
        open
        incarnationName="redis-prod"
        currentTraits={{ env: 'prod', tier: 'gold' }}
        onClose={noop}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByTestId('traits-add-row'));
    const keys = screen.getAllByRole('textbox', { name: /trait key/i });
    await user.type(keys[keys.length - 1], 'owner');
    const vals = screen.getAllByRole('textbox', { name: /trait value/i });
    await user.type(vals[vals.length - 1], 'core');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Incarnation traits updated')).toBeInTheDocument();
    });
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toMatch(/\/v1\/incarnations\/redis-prod\/traits/);
    expect(puts[0].body).toEqual({ traits: { env: 'prod', tier: 'gold', owner: 'core' } });
  });

  it('removing a row explicitly deletes the trait from the PUT', async () => {
    const puts = installPutMock();
    renderWithProviders(
      <IncarnationTraitsModal
        open
        incarnationName="redis-prod"
        currentTraits={{ env: 'prod', tier: 'gold' }}
        onClose={noop}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: /Remove trait/i })[0]);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0].body).toEqual({ traits: { tier: 'gold' } });
  });

  it('save invalidates both the detail and the incarnations list', async () => {
    installPutMock();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <IncarnationTraitsModal
            open
            incarnationName="redis-prod"
            currentTraits={{ env: 'prod' }}
            onClose={noop}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByText('Incarnation traits updated')).toBeInTheDocument();
    });

    const keys = spy.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toContainEqual(['incarnation', 'redis-prod']);
    expect(keys).toContainEqual(['incarnations']);
  });

  it('reopen reseeds the form with fresh currentTraits', () => {
    const view = renderWithProviders(
      <IncarnationTraitsModal
        open={false}
        incarnationName="redis-prod"
        currentTraits={{ env: 'prod' }}
        onClose={noop}
      />,
    );
    expect(screen.queryByTestId('traits-editor')).not.toBeInTheDocument();

    view.rerender(
      <IncarnationTraitsModal
        open
        incarnationName="redis-prod"
        currentTraits={{ env: 'prod' }}
        onClose={noop}
      />,
    );
    expect(screen.getByRole('textbox', { name: /trait value/i })).toHaveValue('prod');

    view.rerender(
      <IncarnationTraitsModal
        open={false}
        incarnationName="redis-prod"
        currentTraits={{ env: 'stage' }}
        onClose={noop}
      />,
    );
    view.rerender(
      <IncarnationTraitsModal
        open
        incarnationName="redis-prod"
        currentTraits={{ env: 'stage' }}
        onClose={noop}
      />,
    );
    expect(screen.getByRole('textbox', { name: /trait value/i })).toHaveValue('stage');
  });
});
