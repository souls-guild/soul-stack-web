import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { AuditLog } from '../pages/audit/AuditLog';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('AuditLog', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит ленту audit-events с source-badge и expandable payload', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/audit',
        body: {
          items: [
            {
              id: '01HZAUDIT00000000000000001',
              type: 'scenario.applied',
              source: 'api',
              archon_aid: 'archon-alice',
              correlation_id: '01HZAPPLY00000000000000001',
              created_at: '2026-05-26T10:00:00Z',
              payload: { name: 'redis-prod', status: 'success' },
            },
            {
              id: '01HZAUDIT00000000000000002',
              type: 'errand.invoked',
              source: 'mcp',
              archon_aid: 'archon-bob',
              correlation_id: null,
              created_at: '2026-05-26T10:05:00Z',
              payload: { module: 'core.cmd.shell' },
            },
          ],
          offset: 0,
          limit: 50,
          total: 2,
        },
      },
    ]);
    renderWithProviders(<AuditLog />, '/audit');
    await waitFor(() => {
      expect(screen.getByText('scenario.applied')).toBeInTheDocument();
      expect(screen.getByText('errand.invoked')).toBeInTheDocument();
    });
    // source-badge видны (в карточках, не в toggle-кнопках).
    // 6 toggle-кнопок source + 2 badge → каждое source-имя присутствует ≥2 раз
    // для api/mcp в этом ответе (1 в toggle + 1 в badge). Достаточно подсчёта.
    expect(screen.getAllByText('api').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('mcp').length).toBeGreaterThanOrEqual(2);
    // Pagination footer показывает total.
    expect(screen.getByText(/1–2 of 2/)).toBeInTheDocument();
  });

  it('применяет type / source / archon_aid фильтры в query', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    renderWithProviders(<AuditLog />, '/audit');
    const user = userEvent.setup();

    // Type CSV multi-value.
    await user.type(
      screen.getByPlaceholderText(/scenario.applied/i),
      'scenario.applied,push.applied',
    );
    // Source toggle.
    await user.click(screen.getByRole('button', { name: 'api', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'mcp', pressed: false }));
    // Archon AID.
    await user.type(screen.getByPlaceholderText('archon-alice'), 'archon-alice');

    await waitFor(() => {
      // Multi-value type — два повторения параметра.
      expect(lastUrl).toMatch(/type=scenario\.applied/);
      expect(lastUrl).toMatch(/type=push\.applied/);
      expect(lastUrl).toMatch(/source=api/);
      expect(lastUrl).toMatch(/source=mcp/);
      expect(lastUrl).toMatch(/archon_aid=archon-alice/);
    });
  });

  it('expandable card раскрывает payload в JsonViewer', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/audit',
        body: {
          items: [
            {
              id: '01HZAUDIT00000000000000003',
              type: 'cluster.degraded_set',
              source: 'keeper_internal',
              archon_aid: null,
              correlation_id: null,
              created_at: '2026-05-26T11:00:00Z',
              payload: { reason: 'redis_unreachable', acolytes: 1 },
            },
          ],
          offset: 0,
          limit: 50,
          total: 1,
        },
      },
    ]);
    renderWithProviders(<AuditLog />, '/audit');
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('cluster.degraded_set')).toBeInTheDocument();
    });
    const expandBtn = screen.getByRole('button', { expanded: false });
    await user.click(expandBtn);
    await waitFor(() => {
      expect(screen.getByText(/redis_unreachable/)).toBeInTheDocument();
    });
  });

  it('подхватывает archon_aid из URL search params (deep-link из ArchonDetail)', async () => {
    let lastUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    renderWithProviders(<AuditLog />, '/audit?archon_aid=archon-bootstrap');
    await waitFor(() => {
      expect(lastUrl).toMatch(/archon_aid=archon-bootstrap/);
    });
    // Поле в форме тоже заполнено.
    expect(screen.getByDisplayValue('archon-bootstrap')).toBeInTheDocument();
  });
});
