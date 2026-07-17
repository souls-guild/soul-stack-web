import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { UpgradeModal } from '../pages/incarnations/UpgradeModal';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

const REFS: FetchRoute = {
  method: 'GET',
  url: '/v1/services/redis/refs',
  body: {
    refs: [
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

// Selecting the target version in the dropdown -> triggers the upgrade-paths fetch.
async function pickTarget() {
  const user = userEvent.setup();
  await waitFor(() => screen.getByRole('option', { name: /v2\.0\.0/ }));
  await user.selectOptions(screen.getByRole('combobox'), 'v2.0.0');
}

describe('UpgradeModal — upgrade-paths preview (NIM-34)', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('found target → found badge + migration list', async () => {
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

  it('legacy target → legacy badge', async () => {
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
    // Empty migration chain -> "no migrations" string.
    expect(screen.getByTestId('upgrade-migrations')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-submit')).not.toBeDisabled();
  });

  it('reachable=false → red banner with reason + submit disabled', async () => {
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

  it('404 → panel hidden, modal still works', async () => {
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

    // Let the fetch run (error), then make sure there's no preview content.
    await waitFor(() => {
      expect(screen.queryByTestId('upgrade-direction')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('upgrade-mode-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-unreachable')).not.toBeInTheDocument();
    // Submit is available -- the modal functions as before.
    expect(screen.getByTestId('upgrade-submit')).not.toBeDisabled();
  });
});

// upgrade-paths for found/legacy -- so submit is unblocked (reachable=true).
const FOUND_PATHS = {
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
};
const LEGACY_PATHS = {
  ...FOUND_PATHS,
  target: { ...FOUND_PATHS.target, target_state_schema_version: 1, direction: 'same-schema', mode: 'legacy', state_migrations: [] },
};

// Runs apply: pick target -> submit -> wait for success footer (Close button).
async function runUpgrade(pathsBody: unknown, reply: Record<string, unknown>) {
  installFetchMock([
    REFS,
    { method: 'GET', url: '/v1/incarnations/redis-prod/upgrade-paths', body: pathsBody },
    { method: 'POST', url: '/v1/incarnations/redis-prod/upgrade', body: reply },
  ]);
}

describe('UpgradeModal — «Track run» (NIM-34)', () => {
  beforeEach(() => {
    tokenStore.clear();
    navigateSpy.mockClear();
  });

  it('success with run_apply_id → BOTH buttons shown (Track + Close)', async () => {
    runUpgrade(FOUND_PATHS, { apply_id: '01APPLYMIGRATE0000000000AA', run_apply_id: '01RUNHOSTS00000000000000AA' });
    renderModal();
    const user = userEvent.setup();
    await pickTarget();
    await user.click(screen.getByTestId('upgrade-submit'));

    await waitFor(() => expect(screen.getByTestId('upgrade-close')).toBeInTheDocument());
    expect(screen.getByTestId('upgrade-track-run')).toBeInTheDocument();
  });

  it('success without run_apply_id (migration without host-Run) → Close only', async () => {
    runUpgrade(LEGACY_PATHS, { apply_id: '01APPLYMIGRATE0000000000BB' });
    renderModal();
    const user = userEvent.setup();
    await pickTarget();
    await user.click(screen.getByTestId('upgrade-submit'));

    await waitFor(() => expect(screen.getByTestId('upgrade-close')).toBeInTheDocument());
    expect(screen.queryByTestId('upgrade-track-run')).not.toBeInTheDocument();
  });

  it('click Track → navigate to RunDetail by run_apply_id + close modal', async () => {
    const RUN = '01RUNHOSTS00000000000000CC';
    runUpgrade(FOUND_PATHS, { apply_id: '01APPLYMIGRATE0000000000CC', run_apply_id: RUN });
    const onClose = vi.fn();
    renderWithProviders(
      <UpgradeModal open incarnationName="redis-prod" serviceName="redis" currentRef="v1.0.0" onClose={onClose} />,
    );
    const user = userEvent.setup();
    await pickTarget();
    await user.click(screen.getByTestId('upgrade-submit'));
    await waitFor(() => screen.getByTestId('upgrade-track-run'));

    await user.click(screen.getByTestId('upgrade-track-run'));
    expect(navigateSpy).toHaveBeenCalledWith(`/incarnations/redis-prod/runs/${RUN}`);
    expect(onClose).toHaveBeenCalled();
  });
});
