import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { ArchonDetail } from '../pages/archons/ArchonDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

function withParamRoute() {
  return (
    <Routes>
      <Route path="/archons/:aid" element={<ArchonDetail />} />
    </Routes>
  );
}

describe('ArchonDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит профиль активного Архонта', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-alice',
        body: {
          aid: 'archon-alice',
          display_name: 'Alice Ops',
          auth_method: 'jwt',
          created_at: '2026-05-10T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: { team: 'platform' },
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('archon-bootstrap')).toBeInTheDocument();
    // Metadata JsonViewer.
    expect(screen.getByText(/platform/)).toBeInTheDocument();
  });

  it('показывает revoked + bootstrap initial badges', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-bootstrap',
        body: {
          aid: 'archon-bootstrap',
          display_name: 'Bootstrap',
          auth_method: 'jwt',
          created_at: '2026-05-01T00:00:00Z',
          created_by_aid: null,
          revoked_at: '2026-05-20T00:00:00Z',
          bootstrap_initial: true,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-bootstrap');
    await waitFor(() => {
      expect(screen.getByText('revoked')).toBeInTheDocument();
    });
    // «bootstrap initial» — badge в шапке (Info-tab активен по умолчанию;
    // строка «Bootstrap initial» в meta — другой регистр).
    expect(screen.getAllByText(/bootstrap initial/i).length).toBeGreaterThanOrEqual(1);
    // empty metadata → placeholder.
    expect(screen.getByText(/metadata пустой/i)).toBeInTheDocument();
  });

  it('Revoke-кнопка отсутствует для уже-отозванного Архонта', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-old',
        body: {
          aid: 'archon-old',
          display_name: 'Old',
          auth_method: 'jwt',
          created_at: '2026-04-01T00:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: '2026-05-20T00:00:00Z',
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-old');
    await waitFor(() => {
      expect(screen.getByText('revoked')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^Revoke$/ })).not.toBeInTheDocument();
  });

  it('Revoke-flow: клик на Revoke → Modal → POST /v1/operators/archon-alice/revoke', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const detailBody = {
      aid: 'archon-alice',
      display_name: 'Alice',
      auth_method: 'jwt',
      created_at: '2026-05-10T10:00:00Z',
      created_by_aid: 'archon-bootstrap',
      revoked_at: null,
      bootstrap_initial: false,
      metadata: {},
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      if (url === '/v1/operators/archon-alice' && method === 'GET') {
        return new Response(JSON.stringify(detailBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators/archon-alice/revoke' && method === 'POST') {
        return new Response('', { status: 204 });
      }
      return new Response('{}', { status: 599 });
    }) as typeof fetch;

    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice/i })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('revoke-archon'));
    expect(await screen.findByRole('dialog', { name: /Отозвать archon-alice/i })).toBeInTheDocument();
    await user.click(screen.getByTestId('revoke-submit'));
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/v1/operators/archon-alice/revoke' && c.method === 'POST')).toBe(true);
    });
  });

  it('Activity-tab показывает link на /audit?archon_aid=<aid>', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-alice',
        body: {
          aid: 'archon-alice',
          display_name: 'Alice',
          auth_method: 'jwt',
          created_at: '2026-05-10T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice/i })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Activity/i }));
    const link = screen.getByRole('link', { name: /Открыть Audit/i });
    expect(link).toHaveAttribute('href', '/audit?archon_aid=archon-alice');
  });
});
