import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { PushApply } from '../pages/push/PushApply';
import { tokenStore } from '../api/tokenStore';

describe('PushApply', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('submit → 202 → poll до success, рендерит per-host summary', async () => {
    const seen: string[] = [];
    let pollCount = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      seen.push(`${method} ${url}`);
      if (method === 'POST' && url.includes('/v1/push/apply')) {
        return new Response(JSON.stringify({ apply_id: '01HZAA0000000000000000000A' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.includes('/v1/push/01HZAA0000000000000000000A')) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({
              apply_id: '01HZAA0000000000000000000A',
              inventory_sids: ['host01'],
              destiny_ref: 'redis@v1',
              cleanup_stale: false,
              status: 'running',
              started_at: '2026-05-26T10:00:00Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            apply_id: '01HZAA0000000000000000000A',
            inventory_sids: ['host01'],
            destiny_ref: 'redis@v1',
            cleanup_stale: false,
            status: 'success',
            started_at: '2026-05-26T10:00:00Z',
            finished_at: '2026-05-26T10:01:00Z',
            summary: {
              total: 1,
              success_count: 1,
              fail_count: 0,
              hosts: [{ sid: 'host01', status: 'success' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    renderWithProviders(<PushApply />, '/push');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/redis-cluster@v2.0.0/i), 'redis@v1');
    await user.type(screen.getByPlaceholderText(/host01.example.com/i), 'host01');

    const submitBtn = screen.getByRole('button', { name: /Push apply/i });
    await waitFor(() => expect(submitBtn).not.toBeDisabled());
    await user.click(submitBtn);

    await waitFor(() => {
      expect(seen.some((s) => s.startsWith('POST') && s.includes('/v1/push/apply'))).toBe(true);
    });

    await waitFor(
      () => {
        // success-Badge появится после второго poll.
        const badges = screen.queryAllByText('success');
        expect(badges.length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    // host01 встречается и в textarea-inventory, и в host-таблице — поэтому getAll.
    const occurrences = screen.getAllByText('host01');
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
  });
});
