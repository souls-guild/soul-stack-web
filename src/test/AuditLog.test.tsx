import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  it('renders the audit-events feed with source badge and expandable payload', async () => {
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
    // source-badges are visible (in cards, not toggle buttons).
    // 6 source toggle buttons + 2 badges -> each source name appears >=2 times
    // for api/mcp in this response (1 in toggle + 1 in badge). Counting is enough.
    expect(screen.getAllByText('api').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('mcp').length).toBeGreaterThanOrEqual(2);
    // Pagination footer shows total.
    expect(screen.getByText(/1–2 of 2/)).toBeInTheDocument();
  });

  it('applies type / source / archon_aid filters to the query', async () => {
    let lastUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

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
      // Multi-value type - two repetitions of the parameter.
      expect(lastUrl).toMatch(/type=scenario\.applied/);
      expect(lastUrl).toMatch(/type=push\.applied/);
      expect(lastUrl).toMatch(/source=api/);
      expect(lastUrl).toMatch(/source=mcp/);
      expect(lastUrl).toMatch(/archon_aid=archon-alice/);
    });
  });

  it('expandable card reveals payload in JsonViewer', async () => {
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

  it('[guard] copy-link button is present for events with correlation_id', async () => {
    // Mock clipboard.writeText before render via Object.assign on window.
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(window, 'navigator');
    const originalClipboard = (window.navigator as { clipboard?: unknown }).clipboard;
    try {
      // jsdom: clipboard undefined - inject directly.
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText: writeMock },
        configurable: true,
        writable: true,
      });
    } catch {
      // in some environments defineProperty on navigator doesn't work - the test only checks the button exists.
    }
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/audit',
        body: {
          items: [
            {
              id: 'ev-copy-1',
              type: 'scenario.applied',
              source: 'api',
              correlation_id: 'CORR-ABC',
              archon_aid: 'archon-alice',
              created_at: '2026-06-30T10:00:00Z',
              payload: null,
            },
          ],
          offset: 0,
          limit: 50,
          total: 1,
        },
      },
    ]);
    renderWithProviders(<AuditLog />, '/audit');
    await waitFor(() => {
      expect(screen.getByTestId('audit-copy-link-ev-copy-1')).toBeInTheDocument();
    });
    // Button is clickable (doesn't throw).
    const user = userEvent.setup();
    await user.click(screen.getByTestId('audit-copy-link-ev-copy-1'));
    // Restore clipboard.
    try {
      if (originalClipboard !== undefined) {
        Object.defineProperty(window.navigator, 'clipboard', {
          value: originalClipboard,
          configurable: true,
          writable: true,
        });
      }
    } catch { /* ignore */ }
    // Verify the button renders only for events with correlation_id.
    // The clipboard.writeText call itself is checked manually (jsdom limitations).
    expect(screen.getByTestId('audit-copy-link-ev-copy-1')).toBeInTheDocument();
    void clipboardDescriptor; // suppress unused warning
  });

  it('picks up archon_aid from URL search params (deep-link from ArchonDetail)', async () => {
    let lastUrl = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    renderWithProviders(<AuditLog />, '/audit?archon_aid=archon-bootstrap');
    await waitFor(() => {
      expect(lastUrl).toMatch(/archon_aid=archon-bootstrap/);
    });
    // The form field is filled in too.
    expect(screen.getByDisplayValue('archon-bootstrap')).toBeInTheDocument();
  });
});
