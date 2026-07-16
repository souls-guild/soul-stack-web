/**
 * NIM-74 guard: State-вьюха деградирует gracefully, если discovery раскрываемых
 * секретов недоступен (403 / 404 / ошибка). Таблица redis_users НЕ рендерится,
 * ключ redis_users показывается обычным JSON-фильтром, глазов нет, UI не падает.
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
    ['403 (вне scope права)', 403],
    ['404 (инкарнация вне scope)', 404],
  ])('discovery %s → таблицы нет, redis_users через JSON-фильтр, глазов нет', async (_label, status) => {
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

  it('discovery с пустым items → таблицы нет, redis_users через JSON-фильтр', async () => {
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
