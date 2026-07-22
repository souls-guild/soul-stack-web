import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { AddHostModal } from '../pages/incarnations/AddHostModal';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SOULS = {
  items: [
    { sid: 'host-a.local', transport: 'agent', status: 'connected', registered_at: '2026-05-27T00:00:00Z' },
    { sid: 'host-b.local', transport: 'agent', status: 'connected', registered_at: '2026-05-27T00:00:00Z' },
  ],
  offset: 0,
  limit: 500,
  total: 2,
};

describe('AddHostModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('select excludes already-declared SIDs', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/souls', body: SOULS }]);
    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={['host-a.local']} onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /host-b.local/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: /host-a.local/ })).not.toBeInTheDocument();
  });

  it('submit → PATCH .../hosts mode=append with selected SID + role', async () => {
    let lastUrl = '';
    let lastBody: unknown = null;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH') {
        lastUrl = url;
        lastBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ name: 'redis-prod' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(SOULS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={[]} onClose={() => {}} />,
    );
    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('option', { name: /host-a.local/ }));
    await user.selectOptions(screen.getByLabelText('host SID'), 'host-a.local');
    await user.type(screen.getByPlaceholderText('master / replica / …'), 'master');
    // Force-add requires confirming the dangerous operation.
    await user.click(screen.getByLabelText('Confirm force-add'));
    await user.click(screen.getByTestId('force-add-confirm'));

    await waitFor(() => {
      expect(lastUrl).toMatch(/\/v1\/incarnations\/redis-prod\/hosts/);
    });
    expect(lastBody).toEqual({ mode: 'append', hosts: [{ sid: 'host-a.local', role: 'master' }] });
  });

  it('422 unknown-SID → pretty-error', async () => {
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH') {
        return new Response(
          JSON.stringify({ title: 'unprocessable', detail: 'unknown sid host-a.local' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(SOULS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={[]} onClose={() => {}} />,
    );
    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('option', { name: /host-a.local/ }));
    await user.selectOptions(screen.getByLabelText('host SID'), 'host-a.local');
    await user.click(screen.getByLabelText('Confirm force-add'));
    await user.click(screen.getByTestId('force-add-confirm'));

    await waitFor(() => {
      expect(screen.getByText(/Unknown SID/)).toBeInTheDocument();
    });
  });

  it('empty SID → form-error without request', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/souls', body: SOULS }]);
    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={[]} onClose={() => {}} />,
    );
    const user = userEvent.setup();
    await waitFor(() => screen.getByLabelText('host SID'));
    // Confirm (otherwise the button is disabled), then submit without SID.
    await user.click(screen.getByLabelText('Confirm force-add'));
    await user.click(screen.getByTestId('force-add-confirm'));
    expect(screen.getByText('Select a host SID.')).toBeInTheDocument();
  });

  it('force-add: danger-warning + button disabled without confirmation', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/souls', body: SOULS }]);
    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={[]} onClose={() => {}} />,
    );
    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('option', { name: /host-a.local/ }));

    // Warning block is visible.
    expect(screen.getByTestId('force-add-warning')).toBeInTheDocument();
    expect(screen.getByTestId('force-add-warning').textContent).toMatch(/inconsistent state/);

    // Button is disabled before confirmation.
    const addBtn = screen.getByTestId('force-add-confirm');
    expect(addBtn).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('host SID'), 'host-a.local');
    expect(addBtn).toBeDisabled();

    // After confirmation -- enabled.
    await user.click(screen.getByLabelText('Confirm force-add'));
    expect(addBtn).not.toBeDisabled();
  });
});
