/**
 * NIM-74 guard: the State view degrades gracefully when discovery of revealable
 * secrets is unavailable (403 / 404 / error). The redis_users table is NOT rendered,
 * the redis_users key is shown via the regular JSON filter, there are no eyes, the UI does not crash.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { StateTab } from '../pages/incarnations/StateTab';
import { keeperApi } from '../api/keeper';
import { ApiError } from '../api/client';

const STATE = {
  redis_users: [
    { name: 'alice', perms: '~* +@all', state: 'present' },
    { name: 'bob', perms: '~app:* +@read', state: 'present' },
  ],
  redis_version: '7.2',
};

describe('StateTab — graceful discovery redis_users', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['403 (out-of-scope permissions)', 403],
    ['404 (incarnation out of scope)', 404],
  ])('discovery %s → no table, redis_users via JSON filter, no eyes', async (_label, status) => {
    const spy = vi
      .spyOn(keeperApi.incarnations, 'revealableSecrets')
      .mockRejectedValue(new ApiError(status, 'about:blank', 'err', 'err'));

    renderWithProviders(
      <StateTab state={STATE} stateSchemaVersion={14} incarnationName="redis-prod" />,
    );

    // discovery was called (state.redis_users present -> query enabled).
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // The special table does NOT render, no reveal eyes.
    expect(screen.queryByTestId('redis-users-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reveal-eye-alice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reveal-eye-bob')).not.toBeInTheDocument();

    // redis_users remains accessible as a regular top-level key (JsonKeyFilter).
    expect(screen.getByText('redis_users')).toBeInTheDocument();
    // UI is alive.
    expect(screen.getByText('Runtime State')).toBeInTheDocument();
  });

  it('discovery with empty items → no table, redis_users via JSON filter', async () => {
    const spy = vi
      .spyOn(keeperApi.incarnations, 'revealableSecrets')
      .mockResolvedValue({ items: [] });

    renderWithProviders(
      <StateTab state={STATE} stateSchemaVersion={14} incarnationName="redis-prod" />,
    );

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('redis-users-table')).not.toBeInTheDocument();
    expect(screen.getByText('redis_users')).toBeInTheDocument();
  });
});
