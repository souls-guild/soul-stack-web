import { describe, it, expect, beforeEach } from 'vitest';
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

  it('select исключает уже-declared SID-ы', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/souls', body: SOULS }]);
    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={['host-a.local']} onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /host-b.local/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: /host-a.local/ })).not.toBeInTheDocument();
  });

  it('submit → PATCH .../hosts mode=append с выбранным SID + role', async () => {
    let lastUrl = '';
    let lastBody: unknown = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
    }) as typeof fetch;

    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={[]} onClose={() => {}} />,
    );
    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('option', { name: /host-a.local/ }));
    await user.selectOptions(screen.getByLabelText('SID хоста'), 'host-a.local');
    await user.type(screen.getByPlaceholderText('master / replica / …'), 'master');
    await user.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => {
      expect(lastUrl).toMatch(/\/v1\/incarnations\/redis-prod\/hosts/);
    });
    expect(lastBody).toEqual({ mode: 'append', hosts: [{ sid: 'host-a.local', role: 'master' }] });
  });

  it('422 unknown-SID → pretty-error', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
    }) as typeof fetch;

    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={[]} onClose={() => {}} />,
    );
    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('option', { name: /host-a.local/ }));
    await user.selectOptions(screen.getByLabelText('SID хоста'), 'host-a.local');
    await user.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => {
      expect(screen.getByText(/Неизвестный SID/)).toBeInTheDocument();
    });
  });

  it('пустой SID → form-error без запроса', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/souls', body: SOULS }]);
    renderWithProviders(
      <AddHostModal open incarnationName="redis-prod" existingSids={[]} onClose={() => {}} />,
    );
    const user = userEvent.setup();
    await waitFor(() => screen.getByLabelText('SID хоста'));
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByText('Выберите SID хоста.')).toBeInTheDocument();
  });
});
