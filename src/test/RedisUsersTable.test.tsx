/**
 * NIM-74: reveal-eye for redis users in the State view.
 * 1. Eye renders only for users in revealable.keys (default — no eye).
 * 2. Click → reveal → password shown inline + copy button (writes to clipboard).
 * 3. 403 on reveal → "insufficient permissions" toast, password NOT shown.
 *
 * Security invariant: the value is fetched lazily on click and lives only in
 * local state (a regression to prefetch/cache would break the contract).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RedisUsersTable } from '../pages/incarnations/RedisUsersTable';
import type { RedisUser } from '../pages/incarnations/redisUsers.helpers';
import { keeperApi } from '../api/keeper';
import { ApiError } from '../api/client';

const USERS: RedisUser[] = [
  { name: 'alice', perms: '~* +@all', state: 'present' },
  { name: 'bob', perms: '~app:* +@read', state: 'present' },
  { name: 'default', perms: 'off', state: 'system' },
];
const REVEALABLE = ['alice', 'bob']; // default -- system account, not revealable

function renderTable() {
  return renderWithProviders(
    <RedisUsersTable
      incarnationName="redis-prod"
      secretId="user_password"
      users={USERS}
      revealableKeys={REVEALABLE}
    />,
  );
}

describe('RedisUsersTable — reveal password', () => {
  beforeEach(() => {
    // Permission gate for the eye is deterministic: cluster-admin (wildcard).
    vi.spyOn(keeperApi.permissions, 'listMy').mockResolvedValue({
      permissions: [{ wildcard: true }],
    } as Awaited<ReturnType<typeof keeperApi.permissions.listMy>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders eye for revealable users and omits it for the system account', async () => {
    renderTable();
    expect(await screen.findByTestId('reveal-eye-alice')).toBeInTheDocument();
    expect(screen.getByTestId('reveal-eye-bob')).toBeInTheDocument();
    // default not in revealableKeys -> no eye.
    expect(screen.queryByTestId('reveal-eye-default')).not.toBeInTheDocument();
  });

  it('clicking the eye reveals the password inline + copy writes to clipboard', async () => {
    const spy = vi
      .spyOn(keeperApi.incarnations, 'revealSecret')
      .mockResolvedValue({ value: 's3cr3t-alice' });
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByTestId('reveal-eye-alice'));

    const field = await screen.findByTestId('reveal-value-alice');
    expect(field).toHaveValue('s3cr3t-alice');
    expect(spy).toHaveBeenCalledWith('redis-prod', { secret_id: 'user_password', key: 'alice' });
    // Password requested exactly once (lazy, no prefetch).
    expect(spy).toHaveBeenCalledTimes(1);

    // copy -> clipboard-stub userEvent resolves -> "Copied" toast.
    await user.click(screen.getByTestId('reveal-copy-alice'));
    expect(await screen.findByTestId('state-toast')).toHaveTextContent('Copied');
    expect(await navigator.clipboard.readText()).toBe('s3cr3t-alice');
  });

  it('403 → "insufficient permissions" toast, password NOT shown', async () => {
    vi.spyOn(keeperApi.incarnations, 'revealSecret').mockRejectedValue(
      new ApiError(403, 'about:blank', 'Forbidden', 'forbidden'),
    );
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByTestId('reveal-eye-alice'));

    await waitFor(() => {
      expect(screen.getByTestId('state-toast')).toHaveTextContent('Insufficient permissions');
    });
    expect(screen.queryByTestId('reveal-value-alice')).not.toBeInTheDocument();
  });

  it('404 → "Value not found" toast, password NOT shown', async () => {
    vi.spyOn(keeperApi.incarnations, 'revealSecret').mockRejectedValue(
      new ApiError(404, 'about:blank', 'Not Found', 'no such key'),
    );
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByTestId('reveal-eye-alice'));

    await waitFor(() => {
      expect(screen.getByTestId('state-toast')).toHaveTextContent('Value not found');
    });
    expect(screen.queryByTestId('reveal-value-alice')).not.toBeInTheDocument();
  });

  it('[GATE] without incarnation.view-secrets permission the eye does not render', async () => {
    // Permission not covering incarnation.view-secrets -> canView=false after resolve.
    vi.spyOn(keeperApi.permissions, 'listMy').mockResolvedValue({
      permissions: [{ wildcard: false, resource: 'soul', action: 'list' }],
    } as Awaited<ReturnType<typeof keeperApi.permissions.listMy>>);
    renderTable();

    // Optimistically the eye may flash while permissions load, but disappears after resolve.
    await waitFor(() => {
      expect(screen.queryByTestId('reveal-eye-alice')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('reveal-eye-bob')).not.toBeInTheDocument();
  });

  it('[INVARIANT] auto-hide: revealed password disappears after 30s', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(keeperApi.incarnations, 'revealSecret').mockResolvedValue({ value: 's3cr3t-alice' });
      renderTable();

      // Eye is optimistically visible (permission loading) -- click right away.
      await act(async () => {
        fireEvent.click(screen.getByTestId('reveal-eye-alice'));
      });
      await act(async () => {}); // flush microtasks of the reveal promise

      expect(screen.getByTestId('reveal-value-alice')).toHaveValue('s3cr3t-alice');

      // Secret doesn't live forever: 30s -> value cleared.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.queryByTestId('reveal-value-alice')).not.toBeInTheDocument();
      expect(screen.getByTestId('reveal-eye-alice')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
