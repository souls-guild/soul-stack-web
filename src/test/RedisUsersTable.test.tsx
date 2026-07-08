/**
 * NIM-74: reveal-глаз для redis-юзеров в State-вьюхе.
 * 1. Глаз рендерится только для юзеров из revealable.keys (default — без глаза).
 * 2. Клик → reveal → пароль виден инлайн + кнопка copy (пишет в clipboard).
 * 3. 403 на reveal → тост «недостаточно прав», пароль НЕ показан.
 *
 * Безопасность-инвариант: значение фетчится лениво по клику и живёт только в
 * локальном стейте (регресс на префетч/кэш сломал бы контракт).
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
const REVEALABLE = ['alice', 'bob']; // default — системный, не раскрывается

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
    // Право-гейт глаза детерминирован: cluster-admin (wildcard).
    vi.spyOn(keeperApi.permissions, 'listMy').mockResolvedValue({
      permissions: [{ wildcard: true }],
    } as Awaited<ReturnType<typeof keeperApi.permissions.listMy>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('глаз рендерится для revealable-юзеров и отсутствует для системного', async () => {
    renderTable();
    expect(await screen.findByTestId('reveal-eye-alice')).toBeInTheDocument();
    expect(screen.getByTestId('reveal-eye-bob')).toBeInTheDocument();
    // default не в revealableKeys → глаза нет.
    expect(screen.queryByTestId('reveal-eye-default')).not.toBeInTheDocument();
  });

  it('клик по глазу раскрывает пароль инлайн + copy пишет в clipboard', async () => {
    const spy = vi
      .spyOn(keeperApi.incarnations, 'revealSecret')
      .mockResolvedValue({ value: 's3cr3t-alice' });
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByTestId('reveal-eye-alice'));

    const field = await screen.findByTestId('reveal-value-alice');
    expect(field).toHaveValue('s3cr3t-alice');
    expect(spy).toHaveBeenCalledWith('redis-prod', { secret_id: 'user_password', key: 'alice' });
    // Пароль запрошен ровно один раз (lazy, без префетча).
    expect(spy).toHaveBeenCalledTimes(1);

    // copy → clipboard-стаб userEvent резолвится → тост «Скопировано».
    await user.click(screen.getByTestId('reveal-copy-alice'));
    expect(await screen.findByTestId('state-toast')).toHaveTextContent('Скопировано');
    expect(await navigator.clipboard.readText()).toBe('s3cr3t-alice');
  });

  it('403 → тост «недостаточно прав», пароль НЕ показан', async () => {
    vi.spyOn(keeperApi.incarnations, 'revealSecret').mockRejectedValue(
      new ApiError(403, 'about:blank', 'Forbidden', 'forbidden'),
    );
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByTestId('reveal-eye-alice'));

    await waitFor(() => {
      expect(screen.getByTestId('state-toast')).toHaveTextContent('Недостаточно прав');
    });
    expect(screen.queryByTestId('reveal-value-alice')).not.toBeInTheDocument();
  });

  it('404 → тост «Значение не найдено», пароль НЕ показан', async () => {
    vi.spyOn(keeperApi.incarnations, 'revealSecret').mockRejectedValue(
      new ApiError(404, 'about:blank', 'Not Found', 'no such key'),
    );
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByTestId('reveal-eye-alice'));

    await waitFor(() => {
      expect(screen.getByTestId('state-toast')).toHaveTextContent('Значение не найдено');
    });
    expect(screen.queryByTestId('reveal-value-alice')).not.toBeInTheDocument();
  });

  it('[ГЕЙТ] без права incarnation.view-secrets глаз не рендерится', async () => {
    // Право, не покрывающее incarnation.view-secrets → canView=false после резолва.
    vi.spyOn(keeperApi.permissions, 'listMy').mockResolvedValue({
      permissions: [{ wildcard: false, resource: 'soul', action: 'list' }],
    } as Awaited<ReturnType<typeof keeperApi.permissions.listMy>>);
    renderTable();

    // Оптимистично глаз может мелькнуть на время загрузки прав, но после резолва — исчезает.
    await waitFor(() => {
      expect(screen.queryByTestId('reveal-eye-alice')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('reveal-eye-bob')).not.toBeInTheDocument();
  });

  it('[ИНВАРИАНТ] авто-скрытие: раскрытый пароль исчезает через 30с', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(keeperApi.incarnations, 'revealSecret').mockResolvedValue({ value: 's3cr3t-alice' });
      renderTable();

      // Глаз виден оптимистично (право грузится) — кликаем сразу.
      await act(async () => {
        fireEvent.click(screen.getByTestId('reveal-eye-alice'));
      });
      await act(async () => {}); // добить микротаски reveal-промиса

      expect(screen.getByTestId('reveal-value-alice')).toHaveValue('s3cr3t-alice');

      // Секрет не живёт вечно: 30с → значение стёрто.
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
