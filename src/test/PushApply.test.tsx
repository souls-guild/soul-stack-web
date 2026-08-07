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
  it('submit → 202 → poll to success, renders per-host summary', async () => {
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
        // success Badge appears after the second poll.
        const badges = screen.queryAllByText('success');
        expect(badges.length).toBeGreaterThan(0);
      },
      // Must clear the 2000ms refetchInterval in PushApply.tsx with room to spare:
      // the first poll goes out as soon as the query is enabled and answers
      // "running", so the badge cannot appear before the second one an interval
      // later -- roughly two seconds of wall clock that no amount of CPU shortens.
      // This was 5000ms, exactly the test timeout it sits inside, so it could never
      // actually fire: a genuinely broken poll reported itself as a bare "Test timed
      // out in 5000ms" with nothing about polling in it. Kept strictly under the
      // `it` budget below so the diagnostic that names the badge is the one that wins.
      { timeout: 6000 },
    );
    // host01 appears both in the textarea-inventory and the host table -- hence getAll.
    const occurrences = screen.getAllByText('host01');
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    // One real interval -- two polls, ~2s -- plus form entry leaves too little of the
    // 5000ms default to be comfortable, so this `it` gets 8000 rather than the suite
    // getting a raised testTimeout. It is also the one cost in this suite that the
    // worker-pool cap in vite.config.ts cannot reduce, because it is wall clock and
    // not CPU (NIM-467/NIM-468).
    //
    // Driving the interval with fake timers instead was tried and does not currently
    // work here; it is a real piece of work, not a one-liner, and is deferred rather
    // than dismissed. Measured, in order of how far each got:
    //   - `waitFor` under fake timers hangs by construction. @testing-library/dom
    //     gates fake-timer detection on `typeof jest !== 'undefined'`, false under
    //     vitest, so it polls a clock nobody advances.
    //   - userEvent under fake timers hangs too, with `advanceTimers` and with
    //     `delay: null` alike -- which is why every fake-timer test in this suite
    //     drives the DOM with fireEvent instead (RedisUsersTable.test.tsx:122).
    //   - fireEvent under fake timers gets furthest and still fails: the second poll
    //     demonstrably goes out, and its reply is dropped rather than rendered, the
    //     panel staying on "running". React commits that update on a macrotask the
    //     fake clock does not own, so `act` has already returned by the time it
    //     lands. Finishing it means solving that, not adding another flush.
  }, 8000);
});
