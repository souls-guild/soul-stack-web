import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { UpgradeModal } from '../pages/incarnations/UpgradeModal';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const REFS: FetchRoute = {
  method: 'GET',
  url: '/v1/services/redis/refs',
  body: {
    items: [
      { name: 'v1.0.0', type: 'tag', is_default: false },
      { name: 'v2.0.0', type: 'tag', is_default: false },
    ],
  },
};

function renderModal() {
  return renderWithProviders(
    <UpgradeModal
      open
      incarnationName="redis-prod"
      serviceName="redis"
      currentRef="v1.0.0"
      onClose={() => {}}
    />,
  );
}

// Выбор целевой версии в дропдауне → срабатывает upgrade-paths-фетч.
async function pickTarget() {
  const user = userEvent.setup();
  await waitFor(() => screen.getByRole('option', { name: /v2\.0\.0/ }));
  await user.selectOptions(screen.getByRole('combobox'), 'v2.0.0');
}

describe('UpgradeModal — upgrade-paths preview (NIM-34)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('found-цель → badge found + список миграций', async () => {
    installFetchMock([
      REFS,
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/upgrade-paths',
        body: {
          current_version: 'v1.0.0',
          current_state_schema_version: 1,
          target: {
            to: 'v2.0.0',
            resolved_commit: 'abc1234',
            target_state_schema_version: 2,
            direction: 'forward',
            downgrade: false,
            reachable: true,
            mode: 'found',
            state_migrations: [{ from: 1, to: 2, path: 'migrations/1_to_2' }],
          },
        },
      },
    ]);
    renderModal();
    await pickTarget();

    await waitFor(() => expect(screen.getByTestId('upgrade-mode-badge')).toHaveTextContent('found'));
    expect(screen.getByTestId('upgrade-direction')).toHaveTextContent('forward');
    expect(screen.getByTestId('upgrade-migrations')).toHaveTextContent('1→2');
    expect(screen.queryByTestId('upgrade-unreachable')).not.toBeInTheDocument();
    expect(screen.getByTestId('upgrade-submit')).not.toBeDisabled();
  });

  it('legacy-цель → badge legacy', async () => {
    installFetchMock([
      REFS,
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/upgrade-paths',
        body: {
          current_version: 'v1.0.0',
          current_state_schema_version: 1,
          target: {
            to: 'v2.0.0',
            resolved_commit: 'abc1234',
            target_state_schema_version: 1,
            direction: 'same-schema',
            downgrade: false,
            reachable: true,
            mode: 'legacy',
            state_migrations: [],
          },
        },
      },
    ]);
    renderModal();
    await pickTarget();

    await waitFor(() => expect(screen.getByTestId('upgrade-mode-badge')).toHaveTextContent('legacy'));
    // Пустая цепочка миграций → строка «миграций нет».
    expect(screen.getByTestId('upgrade-migrations')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-submit')).not.toBeDisabled();
  });

  it('reachable=false → красный баннер с reason + submit заблокирован', async () => {
    installFetchMock([
      REFS,
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/upgrade-paths',
        body: {
          current_version: 'v1.0.0',
          current_state_schema_version: 2,
          target: {
            to: 'v2.0.0',
            resolved_commit: 'abc1234',
            target_state_schema_version: 4,
            direction: 'forward',
            downgrade: false,
            reachable: false,
            unreachable_reason: 'broken migration chain 2→4 (no 2_to_3)',
          },
        },
      },
    ]);
    renderModal();
    await pickTarget();

    await waitFor(() => expect(screen.getByTestId('upgrade-unreachable')).toBeInTheDocument());
    expect(screen.getByTestId('upgrade-unreachable')).toHaveTextContent('broken migration chain 2→4');
    expect(screen.getByTestId('upgrade-submit')).toBeDisabled();
  });

  it('404 → панель скрыта, модалка работает', async () => {
    installFetchMock([
      REFS,
      {
        method: 'GET',
        url: '/v1/incarnations/redis-prod/upgrade-paths',
        status: 404,
        body: { title: 'not found', detail: 'no upgrade-paths' },
      },
    ]);
    renderModal();
    await pickTarget();

    // Даём фетчу отработать (ошибка), затем убеждаемся, что превью-контента нет.
    await waitFor(() => {
      expect(screen.queryByTestId('upgrade-direction')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('upgrade-mode-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-unreachable')).not.toBeInTheDocument();
    // Submit доступен — модалка функционирует как раньше.
    expect(screen.getByTestId('upgrade-submit')).not.toBeDisabled();
  });
});
