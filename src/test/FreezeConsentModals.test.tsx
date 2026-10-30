import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useFreezeConsent } from '../pages/incarnations/useFreezeConsent';
import { windowsKey } from '../pages/incarnations/maintenance';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock, type FetchRoute } from './fetchMock';
import { tokenStore } from '../api/tokenStore';
import { DestroyModal } from '../pages/incarnations/DestroyModal';
import { RerunLastModal } from '../pages/incarnations/RerunLastModal';
import { UpgradeModal } from '../pages/incarnations/UpgradeModal';

// Destroy, rerun-last and the upgrade are never deferred: during a freeze they take
// consent only, and their button stays disabled until it is given (ADR-0093 §4–§5).
vi.mock('../pages/incarnations/maintenance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../pages/incarnations/maintenance')>();
  return { ...mod, browserTimeZone: () => 'Europe/Moscow' };
});
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

const BASE = '/v1/incarnations/df-prod';
const SALE = {
  id: 'f-sale',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2099-12-02T21:00:00Z',
  comment: 'Sale',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const FROZEN: FetchRoute = {
  method: 'GET',
  url: `${BASE}/maintenance-windows`,
  body: { items: [], status: { open_now: false, next_start: '2099-12-02T21:00:00Z', active_freeze: SALE } },
};
const OPEN: FetchRoute = {
  method: 'GET',
  url: `${BASE}/maintenance-windows`,
  body: { items: [], status: { open_now: true, next_start: '2026-10-27T10:00:00Z' } },
};
const REFUSED = {
  type: 'https://soul-stack.com/errors/freeze-active',
  title: 'Conflict',
  status: 409,
  detail: 'freeze-active: incarnation df-prod frozen until 2099-12-02T21:00:00Z ("Sale"); send confirm_freeze: true to destroy during the freeze',
};

function calls(method: string, prefix: string): Array<{ url: string; body: unknown }> {
  const all = (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  return all
    .filter(([u, i]) => (i?.method ?? 'GET') === method && u.startsWith(prefix))
    .map(([u, i]) => ({ url: u, body: i?.body ? JSON.parse(String(i.body)) : undefined }));
}

async function fillDestroy(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByTestId('destroy-confirm-input'), 'df-prod');
}

describe('freeze consent on destroy, rerun-last and upgrade', () => {
  beforeEach(() => tokenStore.clear());

  it('[GUARD] destroy during a freeze: disabled until consent, then DELETE carries confirm_freeze=true', async () => {
    installFetchMock([FROZEN, { method: 'DELETE', url: BASE, status: 202, body: { apply_id: 'ap-1' } }]);
    renderWithProviders(<DestroyModal open incarnationName="df-prod" onClose={() => {}} />);
    const user = userEvent.setup();

    const block = await screen.findByTestId('freeze-consent-block');
    expect(block.textContent).toContain('A freeze is in force until Thu 03.12.2099 00:00 · Sale');
    await fillDestroy(user);
    expect(screen.getByTestId('destroy-submit')).toBeDisabled();

    await user.click(screen.getByTestId('freeze-consent'));
    await user.click(screen.getByTestId('destroy-submit'));
    await waitFor(() => expect(calls('DELETE', BASE)).toHaveLength(1));
    expect(new URL(calls('DELETE', BASE)[0].url, 'http://x').searchParams.get('confirm_freeze')).toBe('true');
  });

  it('destroy outside a freeze asks nothing and sends no consent', async () => {
    installFetchMock([OPEN, { method: 'DELETE', url: BASE, status: 202, body: { apply_id: 'ap-1' } }]);
    renderWithProviders(<DestroyModal open incarnationName="df-prod" onClose={() => {}} />);
    const user = userEvent.setup();

    await fillDestroy(user);
    await waitFor(() => expect(calls('GET', `${BASE}/maintenance-windows`)).toHaveLength(1));
    expect(screen.queryByTestId('freeze-consent-block')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('destroy-submit'));
    await waitFor(() => expect(calls('DELETE', BASE)).toHaveLength(1));
    expect(new URL(calls('DELETE', BASE)[0].url, 'http://x').searchParams.has('confirm_freeze')).toBe(false);
  });

  it('a 409 freeze-active on destroy opens the consent instead of a bare error', async () => {
    installFetchMock([OPEN, { method: 'DELETE', url: BASE, status: 409, body: REFUSED }]);
    renderWithProviders(<DestroyModal open incarnationName="df-prod" onClose={() => {}} />);
    const user = userEvent.setup();

    await fillDestroy(user);
    await user.click(screen.getByTestId('destroy-submit'));
    const block = await screen.findByTestId('freeze-consent-block');
    expect(block.textContent).toContain('Keeper refused: freeze-active');
    expect(screen.queryByTestId('destroy-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('destroy-submit')).toBeDisabled();
    await user.click(screen.getByTestId('freeze-consent'));
    expect(screen.getByTestId('destroy-submit')).toBeEnabled();
  });

  it('rerun-last during a freeze sends confirm_freeze only after consent', async () => {
    installFetchMock([
      FROZEN,
      { method: 'POST', url: `${BASE}/rerun-last`, status: 202, body: { apply_id: 'ap-2', scenario: 'restart', incarnation: 'df-prod' } },
    ]);
    renderWithProviders(<RerunLastModal open incarnationName="df-prod" onClose={() => {}} />);
    const user = userEvent.setup();

    await screen.findByTestId('freeze-consent-block');
    await user.type(screen.getByTestId('rerun-reason-input'), 'disk replaced');
    expect(screen.getByTestId('rerun-submit')).toBeDisabled();
    await user.click(screen.getByTestId('freeze-consent'));
    await user.click(screen.getByTestId('rerun-submit'));
    await waitFor(() => expect(calls('POST', `${BASE}/rerun-last`)).toHaveLength(1));
    expect(calls('POST', `${BASE}/rerun-last`)[0].body).toEqual({ reason: 'disk replaced', confirm_freeze: true });
  });

  it('a migrations-only (legacy) upgrade during a freeze asks no consent, as Keeper asks none', async () => {
    installFetchMock([
      FROZEN,
      { method: 'GET', url: '/v1/services/redis/refs', body: { refs: [{ name: 'v2.0.0', type: 'tag', is_default: false }] } },
      {
        method: 'GET',
        url: `${BASE}/upgrade-paths`,
        body: {
          current_version: 'v1.0.0',
          current_state_schema_version: 1,
          target: { ref: 'v2.0.0', direction: 'up', downgrade: false, mode: 'legacy', reachable: true, resolved_commit: 'abc', state_migrations: [] },
        },
      },
      { method: 'POST', url: `${BASE}/upgrade`, status: 202, body: { apply_id: 'ap-4' } },
    ]);
    renderWithProviders(
      <UpgradeModal open incarnationName="df-prod" serviceName="redis" currentRef="v1.0.0" onClose={() => {}} />,
    );
    const user = userEvent.setup();

    await waitFor(() => screen.getByRole('option', { name: /v2\.0\.0/ }));
    await user.selectOptions(screen.getByRole('combobox'), 'v2.0.0');
    await screen.findByTestId('upgrade-mode-badge');
    expect(screen.queryByTestId('freeze-consent-block')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('upgrade-submit'));
    await waitFor(() => expect(calls('POST', `${BASE}/upgrade`)).toHaveLength(1));
    expect(calls('POST', `${BASE}/upgrade`)[0].body).toEqual({ to_version: 'v2.0.0' });
  });

  it('[GUARD] consent given for one freeze does not cover the next one a refetch brings', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const status = (freeze: typeof SALE) => ({ items: [], status: { open_now: false, next_start: freeze.ends_at, active_freeze: freeze } });
    qc.setQueryData(windowsKey('df-prod'), status(SALE));
    installFetchMock([FROZEN]);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useFreezeConsent('df-prod', false), { wrapper });

    act(() => result.current.setConsent(true));
    expect(result.current.confirmFreeze).toBe(true);

    // The cache notifies its observers on a later tick, as a real refetch would.
    act(() => qc.setQueryData(windowsKey('df-prod'), status({ ...SALE, id: 'f-audit', comment: 'Audit' })));
    await waitFor(() => expect(result.current.freeze?.id).toBe('f-audit'));
    expect(result.current.consent).toBe(false);
    expect(result.current.blocked).toBe(true);
    expect(result.current.confirmFreeze).toBe(false);
  });

  it('upgrade during a freeze sends confirm_freeze only after consent', async () => {
    installFetchMock([
      FROZEN,
      { method: 'GET', url: '/v1/services/redis/refs', body: { refs: [{ name: 'v2.0.0', type: 'tag', is_default: false }] } },
      { method: 'GET', url: `${BASE}/upgrade-paths`, body: { current_version: 'v1.0.0', current_state_schema_version: 1 } },
      { method: 'POST', url: `${BASE}/upgrade`, status: 202, body: { apply_id: 'ap-3' } },
    ]);
    renderWithProviders(
      <UpgradeModal open incarnationName="df-prod" serviceName="redis" currentRef="v1.0.0" onClose={() => {}} />,
    );
    const user = userEvent.setup();

    await screen.findByTestId('freeze-consent-block');
    await waitFor(() => screen.getByRole('option', { name: /v2\.0\.0/ }));
    await user.selectOptions(screen.getByRole('combobox'), 'v2.0.0');
    expect(screen.getByTestId('upgrade-submit')).toBeDisabled();
    await user.click(screen.getByTestId('freeze-consent'));
    await user.click(screen.getByTestId('upgrade-submit'));
    await waitFor(() => expect(calls('POST', `${BASE}/upgrade`)).toHaveLength(1));
    expect(calls('POST', `${BASE}/upgrade`)[0].body).toEqual({ to_version: 'v2.0.0', confirm_freeze: true });
  });
});
