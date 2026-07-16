import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { CadencesList } from '../pages/cadences/CadencesList';
import { CadenceDetail } from '../pages/cadences/CadenceDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const CADENCE_INTERVAL = {
  cadence_id: 'cad-01',
  name: 'redis-hourly',
  enabled: true,
  schedule_kind: 'interval',
  interval_seconds: 3600,
  overlap_policy: 'skip',
  kind: 'scenario',
  scenario_name: 'restart',
  created_by_aid: 'archon-alice',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  next_run_at: new Date(Date.now() + 3600_000).toISOString(),
};

const CADENCE_CRON = {
  cadence_id: 'cad-02',
  name: 'db-backup',
  enabled: false,
  schedule_kind: 'cron',
  cron_expr: '0 3 * * *',
  overlap_policy: 'queue',
  kind: 'command',
  module: 'core.cmd.shell',
  created_by_aid: 'archon-alice',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const VOYAGE_CHILD = {
  voyage_id: 'voy-01',
  kind: 'scenario',
  status: 'succeeded',
  scope_size: 3,
  batch_size: null,
  batch_mode: 'barrier',
  dry_run: false,
  total_batches: 1,
  current_batch_index: 1,
  on_failure: 'abort',
  require_alive: false,
  attempt: 1,
  started_by_aid: 'archon-alice',
  created_at: new Date().toISOString(),
  started_at: new Date(Date.now() - 60_000).toISOString(),
  finished_at: new Date().toISOString(),
};

function setupMocks(opts: { items?: unknown[]; runs?: unknown[]; deleteStatus?: number } = {}) {
  const items = opts.items ?? [CADENCE_INTERVAL, CADENCE_CRON];
  const runs = opts.runs ?? [VOYAGE_CHILD];
  installFetchMock([
    // Order matters: more specific paths FIRST.
    { method: 'GET', url: '/v1/cadences/cad-01/runs', body: { items: runs, offset: 0, limit: 50, total: runs.length } },
    { method: 'GET', url: '/v1/cadences/cad-01', body: CADENCE_INTERVAL },
    { method: 'POST', url: '/v1/cadences/cad-01/enable', body: { cadence_id: 'cad-01', enabled: true } },
    { method: 'POST', url: '/v1/cadences/cad-01/disable', body: { cadence_id: 'cad-01', enabled: false } },
    { method: 'POST', url: '/v1/cadences/cad-02/enable', body: { cadence_id: 'cad-02', enabled: true } },
    { method: 'POST', url: '/v1/cadences/cad-02/disable', body: { cadence_id: 'cad-02', enabled: false } },
    { method: 'DELETE', url: '/v1/cadences/cad-01', status: opts.deleteStatus ?? 204, body: null },
    { method: 'GET', url: '/v1/cadences', body: { items, offset: 0, limit: 100, total: items.length } },
  ]);
}

beforeEach(() => {
  tokenStore.set('tok-test');
});

describe('CadencesList', () => {
  it('рендерит список cadences из API', async () => {
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences" element={<CadencesList />} />
        <Route path="/cadences/:id" element={<CadenceDetail />} />
        <Route path="/run" element={<div data-testid="run-wizard" />} />
      </Routes>,
      '/cadences',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());
    expect(screen.getByText('db-backup')).toBeInTheDocument();
    // Interval schedule label
    expect(screen.getByText('every 1h')).toBeInTheDocument();
    // Cron schedule label
    expect(screen.getByText('cron: 0 3 * * *')).toBeInTheDocument();
  });

  it('пустой список — показывает empty-state', async () => {
    setupMocks({ items: [] });
    renderWithProviders(
      <Routes>
        <Route path="/cadences" element={<CadencesList />} />
      </Routes>,
      '/cadences',
    );

    await waitFor(() =>
      expect(screen.getByText(/Расписаний нет/)).toBeInTheDocument(),
    );
  });

  it('клик disable-тоггла открывает модалку, не вызывает mutate сразу', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences" element={<CadencesList />} />
      </Routes>,
      '/cadences',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());

    // redis-hourly enabled=true - toggle button for disable
    const disableBtn = screen.getByRole('button', { name: /Выключить/i });
    await user.click(disableBtn);

    // Modal opened - no immediate mutate
    await waitFor(() =>
      expect(screen.getByText('Выключить расписание?')).toBeInTheDocument(),
    );
    // Text warning about the consequence
    expect(screen.getByText(/ПЕРЕСТАНЕТ спавнить прогоны/)).toBeInTheDocument();
    // Name appears
    expect(screen.getAllByText(/redis-hourly/).length).toBeGreaterThan(0);

    // disable request has NOT been sent yet
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const disableCallBefore = calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return url.includes('/disable') && (init?.method ?? 'GET').toUpperCase() === 'POST';
    });
    expect(disableCallBefore).toBeUndefined();
  });

  it('подтверждение disable → POST /disable', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences" element={<CadencesList />} />
      </Routes>,
      '/cadences',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Выключить/i }));
    await waitFor(() => expect(screen.getByText('Выключить расписание?')).toBeInTheDocument());

    // Confirm
    await user.click(screen.getByRole('button', { name: /Подтвердить/i }));

    await waitFor(() => {
      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const disableCall = calls.find(([input, init]) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        return url.includes('/v1/cadences/cad-01/disable') && (init?.method ?? 'GET').toUpperCase() === 'POST';
      });
      expect(disableCall).toBeDefined();
    });
  });

  it('отмена disable → нет POST /disable', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences" element={<CadencesList />} />
      </Routes>,
      '/cadences',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Выключить/i }));
    await waitFor(() => expect(screen.getByText('Выключить расписание?')).toBeInTheDocument());

    // Cancel
    await user.click(screen.getByRole('button', { name: /Отмена/i }));

    // Modal closed
    await waitFor(() =>
      expect(screen.queryByText('Выключить расписание?')).not.toBeInTheDocument(),
    );

    // disable request was never sent
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const disableCall = calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return url.includes('/disable') && (init?.method ?? 'GET').toUpperCase() === 'POST';
    });
    expect(disableCall).toBeUndefined();
  });

  it('клик enable-тоггла открывает модалку, подтверждение → POST /enable', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences" element={<CadencesList />} />
      </Routes>,
      '/cadences',
    );

    await waitFor(() => expect(screen.getByText('db-backup')).toBeInTheDocument());

    // db-backup enabled=false - toggle button for enable
    const enableBtn = screen.getByRole('button', { name: /Включить/i });
    await user.click(enableBtn);

    // Modal opened with correct text
    await waitFor(() =>
      expect(screen.getByText('Включить расписание?')).toBeInTheDocument(),
    );
    expect(screen.getByText(/начнёт спавнить прогоны/)).toBeInTheDocument();
    expect(screen.getAllByText(/db-backup/).length).toBeGreaterThan(0);

    // enable request was not sent yet
    const callsBefore = vi.mocked(globalThis.fetch).mock.calls;
    const enableCallBefore = callsBefore.find(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return url.includes('/enable') && (init?.method ?? 'GET').toUpperCase() === 'POST';
    });
    expect(enableCallBefore).toBeUndefined();

    // Confirm
    await user.click(screen.getByRole('button', { name: /Подтвердить/i }));

    await waitFor(() => {
      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const enableCall = calls.find(([input, init]) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        return url.includes('/v1/cadences/cad-02/enable') && (init?.method ?? 'GET').toUpperCase() === 'POST';
      });
      expect(enableCall).toBeDefined();
    });
  });

  it('delete кнопка открывает подтверждение', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences" element={<CadencesList />} />
      </Routes>,
      '/cadences',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());

    // Click delete button of the first row
    const deleteBtns = screen.getAllByRole('button', { name: /Удалить/i });
    await user.click(deleteBtns[0]);

    // Modal opened with a title
    await waitFor(() =>
      expect(screen.getByText('Удалить Cadence?')).toBeInTheDocument(),
    );
    // Cadence name appears in the confirmation
    expect(screen.getAllByText(/redis-hourly/).length).toBeGreaterThan(0);

    // Cancel button closes the modal
    await user.click(screen.getByRole('button', { name: /Отменить|Отмена/i }));
    await waitFor(() =>
      expect(screen.queryByText('Удалить Cadence?')).not.toBeInTheDocument(),
    );
  });
});

describe('CadenceDetail', () => {
  it('показывает метаданные Cadence и список runs', async () => {
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences/:id" element={<CadenceDetail />} />
        <Route path="/voyages/:id" element={<div data-testid="voyage-detail" />} />
        <Route path="/cadences" element={<div data-testid="cadences-list" />} />
      </Routes>,
      '/cadences/cad-01',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());
    // Metadata
    expect(screen.getByText('every 1h')).toBeInTheDocument();
    // Child Voyages
    await waitFor(() => expect(screen.getByText('voy-01')).toBeInTheDocument());
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('runs — пустой список — empty-state', async () => {
    setupMocks({ runs: [] });
    renderWithProviders(
      <Routes>
        <Route path="/cadences/:id" element={<CadenceDetail />} />
        <Route path="/cadences" element={<div />} />
      </Routes>,
      '/cadences/cad-01',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Прогонов ещё нет/)).toBeInTheDocument());
  });

  // -- Guard tests: clickable links --------------------------------------

  it('[LINKS] created_by_aid рендерится ссылкой на /archons/:aid', async () => {
    setupMocks();
    renderWithProviders(
      <Routes>
        <Route path="/cadences/:id" element={<CadenceDetail />} />
        <Route path="/cadences" element={<div data-testid="cadences-list" />} />
        <Route path="/archons/:aid" element={<div data-testid="archon-detail" />} />
        <Route path="/voyages/:id" element={<div data-testid="voyage-detail" />} />
      </Routes>,
      '/cadences/cad-01',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'archon-alice' });
    expect(link).toHaveAttribute('href', '/archons/archon-alice');
  });

  it('[LINKS] created_by_aid с спецсимволами корректно URL-кодируется', async () => {
    const specialCadence = {
      ...CADENCE_INTERVAL,
      created_by_aid: 'archon-special+one',
    };
    installFetchMock([
      { method: 'GET', url: '/v1/cadences/cad-01/runs', body: { items: [], offset: 0, limit: 50, total: 0 } },
      { method: 'GET', url: '/v1/cadences/cad-01', body: specialCadence },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/cadences/:id" element={<CadenceDetail />} />
        <Route path="/cadences" element={<div />} />
        <Route path="/archons/:aid" element={<div data-testid="archon-detail" />} />
      </Routes>,
      '/cadences/cad-01',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'archon-special+one' });
    expect(link).toHaveAttribute('href', `/archons/${encodeURIComponent('archon-special+one')}`);
  });
});
