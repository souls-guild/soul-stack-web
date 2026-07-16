import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ErrandsList } from '../pages/errands/ErrandsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('ErrandsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('рендерит список errand-ов из GET /v1/errands', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/errands',
        body: {
          items: [
            {
              errand_id: '01HZAA0000000000000000000D',
              sid: 'host01',
              module: 'core.cmd.shell',
              status: 'success',
              exit_code: 0,
              duration_ms: 5,
              stdout: 'ok',
              started_by_aid: 'archon-alice',
              started_at: '2026-05-26T10:00:00Z',
              finished_at: '2026-05-26T10:00:00Z',
            },
            {
              errand_id: '01HZAA0000000000000000000E',
              sid: 'host02',
              module: 'core.exec.run',
              status: 'failed',
              exit_code: 1,
              duration_ms: 10,
              started_by_aid: 'archon-bob',
              started_at: '2026-05-26T10:01:00Z',
              finished_at: '2026-05-26T10:01:00Z',
            },
          ],
          offset: 0,
          limit: 50,
          total: 2,
        },
      },
    ]);

    renderWithProviders(<ErrandsList />, '/errands');
    await waitFor(() => {
      expect(screen.getByText('host01')).toBeInTheDocument();
      expect(screen.getByText('host02')).toBeInTheDocument();
    });
    // Link to detail (take the first of two).
    const links = screen.getAllByText(/01HZAA0000/);
    expect(links[0].closest('a')?.getAttribute('href')).toMatch(/\/errands\/01HZAA/);
  });

  // -- Guard tests: clickable links --------------------------------------------

  it('[LINKS] sid в строке таблицы — ссылка на /souls/:sid', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/errands',
        body: {
          items: [
            {
              errand_id: '01HZAA0000000000000000000D',
              sid: 'host01',
              module: 'core.cmd.shell',
              status: 'success',
              exit_code: 0,
              duration_ms: 5,
              stdout: 'ok',
              started_by_aid: 'archon-alice',
              started_at: '2026-05-26T10:00:00Z',
              finished_at: '2026-05-26T10:00:00Z',
            },
          ],
          offset: 0,
          limit: 50,
          total: 1,
        },
      },
    ]);

    renderWithProviders(<ErrandsList />, '/errands');
    await waitFor(() => expect(screen.getByText('host01')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'host01' });
    expect(link).toHaveAttribute('href', '/souls/host01');
  });

  it('[LINKS] при пустом списке errand-ов ссылок на souls нет', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/errands',
        body: { items: [], offset: 0, limit: 50, total: 0 },
      },
    ]);

    renderWithProviders(<ErrandsList />, '/errands');
    await waitFor(() => expect(screen.queryByRole('link', { name: /^host/ })).not.toBeInTheDocument());
  });

  it('module CSV-фильтр уходит в query как multi-value ?module=', async () => {
    let lastUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderWithProviders(<ErrandsList />, '/errands');
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/core.cmd.shell, core.exec.run/i),
      'core.cmd.shell,core.exec.run',
    );
    await waitFor(() => {
      expect(lastUrl).toMatch(/module=core\.cmd\.shell/);
      expect(lastUrl).toMatch(/module=core\.exec\.run/);
    });
  });
});
