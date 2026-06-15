/**
 * Тесты для:
 * 1. TidingModal — поле task (рендер/ввод/в payload/omit==clear на edit).
 * 2. Cadence-навигация ведёт в Notifications с ?cadence=<name>.
 * 3. eventTypes — incarnation.run_completed присутствует в чипах.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { HeraldDetail } from '../pages/notifications/HeraldDetail';
import { TidingDetail } from '../pages/notifications/TidingDetail';
import { CadenceDetail } from '../pages/cadences/CadenceDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';
import type { Tiding } from '../api/keeper';
import { KNOWN_EVENT_TYPE_AREAS } from '../pages/notifications/eventTypes';

// ── Sample data ──────────────────────────────────────────────────────────────

const HERALD = {
  name: 'ops-webhook',
  type: 'webhook',
  config: { url: 'https://hooks.example.com/notify' },
  secret_ref: null,
  enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: 'archon-alice',
};

const TIDING_BASE: Tiding = {
  name: 'run-failures',
  herald: 'ops-webhook',
  event_types: ['incarnation.run_completed'],
  only_failures: false,
  only_changes: false,
  incarnation: undefined,
  cadence: 'redis-hourly',
  task: 'redis_conf',
  enabled: true,
  ephemeral: false,
  voyage_id: undefined,
  annotations: undefined,
  projection: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: 'archon-alice',
};

const CADENCE = {
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

function setupNotifMock(opts: { tidingDetail?: Tiding } = {}) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });

    if (url.startsWith('/v1/me/permissions')) {
      return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/tidings\/[^/]+$/.test(url) && method === 'GET') {
      const td = opts.tidingDetail ?? TIDING_BASE;
      return new Response(JSON.stringify(td), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/tidings') && method === 'GET') {
      return new Response(JSON.stringify({ items: [TIDING_BASE], offset: 0, limit: 200, total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/tidings$/.test(url) && method === 'POST') {
      return new Response(JSON.stringify({ ...TIDING_BASE, name: 'new-tiding' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/tidings\/[^/]+$/.test(url) && method === 'PUT') {
      return new Response(JSON.stringify(TIDING_BASE), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/heralds') && method === 'GET') {
      return new Response(JSON.stringify({ items: [HERALD], offset: 0, limit: 200, total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/event-types') && method === 'GET') {
      // Возвращаем каталог с incarnation.run_completed в point_events.
      return new Response(JSON.stringify({
        areas: [
          { name: 'scenario_run.*' },
          { name: 'command_run.*' },
          { name: 'voyage.*' },
          { name: 'cadence.*' },
        ],
        point_events: [
          { name: 'incarnation.drift_checked' },
          { name: 'incarnation.run_completed' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/audit') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderNotif(path = '/notifications') {
  return renderWithProviders(
    <Routes>
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/notifications/heralds/:name" element={<HeraldDetail />} />
      <Route path="/notifications/tidings/:name" element={<TidingDetail />} />
    </Routes>,
    path,
  );
}

beforeEach(() => {
  tokenStore.clear();
});

// ── 1. incarnation.run_completed в списке eventTypes ─────────────────────────

describe('eventTypes — incarnation.run_completed', () => {
  it('присутствует в KNOWN_EVENT_TYPE_AREAS', () => {
    expect(KNOWN_EVENT_TYPE_AREAS).toContain('incarnation.run_completed');
  });

  it('чип incarnation.run_completed рендерится в форме TidingModal', async () => {
    setupNotifMock();
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));

    await screen.findByRole('dialog', { name: /Создать Tiding/i });
    await waitFor(() => {
      expect(screen.getByTestId('event-type-chip-incarnation.run_completed')).toBeInTheDocument();
    });
  });
});

// ── 2. TidingModal — поле task ───────────────────────────────────────────────

describe('TidingModal — поле task', () => {
  it('рендерит поле task при создании', async () => {
    setupNotifMock();
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });
    expect(within(dialog).getByTestId('tiding-task-input')).toBeInTheDocument();
  });

  it('Create Tiding — task попадает в POST payload', async () => {
    const calls = setupNotifMock();
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });

    await user.type(within(dialog).getByTestId('tiding-name-input'), 'task-tiding');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'ops-webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');
    await user.click(within(dialog).getByTestId('event-type-chip-incarnation.run_completed'));

    await user.type(within(dialog).getByTestId('tiding-task-input'), 'redis_conf');
    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/tidings' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      expect(parsed.task).toBe('redis_conf');
    });
  });

  it('Create Tiding — пустое task → отсутствует в payload (undefined=omit)', async () => {
    const calls = setupNotifMock();
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });

    await user.type(within(dialog).getByTestId('tiding-name-input'), 'no-task-tiding');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'ops-webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');
    await user.click(within(dialog).getByTestId('event-type-chip-voyage.*'));
    // task не заполняем
    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/tidings' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      // PUT/POST replace-семантика: пустое поле → отсутствует в JSON (undefined omit),
      // backend трактует отсутствие как "очистить" (комментарий в спеке: "отсутствие очищает").
      expect(Object.prototype.hasOwnProperty.call(parsed, 'task')).toBe(false);
    });
  });

  it('Edit Tiding — task из editing.task предзаполняет поле', async () => {
    setupNotifMock({ tidingDetail: TIDING_BASE });
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-edit-btn-run-failures'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Tiding/i });
    const taskInput = within(dialog).getByTestId('tiding-task-input');
    expect((taskInput as HTMLInputElement).value).toBe('redis_conf');
  });

  it('Edit Tiding — PUT несёт task в payload', async () => {
    const calls = setupNotifMock({ tidingDetail: TIDING_BASE });
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-edit-btn-run-failures'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Tiding/i });
    const taskInput = within(dialog).getByTestId('tiding-task-input');
    await user.clear(taskInput);
    await user.type(taskInput, 'new_task');
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/tidings\/run-failures$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      expect(parsed.task).toBe('new_task');
    });
  });

  it('Edit Tiding — стёр task → PUT отправляет task: omit (undefined==clear)', async () => {
    const calls = setupNotifMock({ tidingDetail: TIDING_BASE });
    renderNotif('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-edit-btn-run-failures'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Tiding/i });
    const taskInput = within(dialog).getByTestId('tiding-task-input');
    await user.clear(taskInput);
    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/tidings\/run-failures$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      // PUT replace-семантика: пустое поле → отсутствует в JSON (backend: "отсутствие очищает").
      expect(Object.prototype.hasOwnProperty.call(parsed, 'task')).toBe(false);
    });
  });
});

// ── 3. Cadence-навигация на Notifications с ?cadence=<name> ─────────────────

describe('CadenceDetail — навигация на Notifications', () => {
  beforeEach(() => {
    tokenStore.set('tok-test');
  });

  it('ссылка «Настроить уведомления» ведёт на /notifications?tab=tidings&cadence=<name>', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/cadences/cad-01/runs', body: { items: [], offset: 0, limit: 50, total: 0 } },
      { method: 'GET', url: '/v1/cadences/cad-01', body: CADENCE },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/cadences/:id" element={<CadenceDetail />} />
        <Route path="/cadences" element={<div data-testid="cadences-list" />} />
        <Route path="/notifications" element={<div data-testid="notifications-page" />} />
      </Routes>,
      '/cadences/cad-01',
    );

    await waitFor(() => expect(screen.getByText('redis-hourly')).toBeInTheDocument());

    const link = screen.getByTestId('cadence-notifications-link');
    expect(link).toHaveAttribute(
      'href',
      `/notifications?tab=tidings&cadence=${encodeURIComponent('redis-hourly')}`,
    );
  });
});

// ── 4. TidingModal — prefillCadence при навигации из CadenceDetail ───────────

describe('TidingsTab — prefillCadence из URL', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('?cadence=redis-hourly предзаполняет cadence в форме создания', async () => {
    setupNotifMock();
    renderNotif('/notifications?tab=tidings&cadence=redis-hourly');

    // Modal должен открыться автоматически.
    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });
    await waitFor(() => {
      const cadenceInput = within(dialog).getByTestId('tiding-cadence-input');
      expect((cadenceInput as HTMLInputElement).value).toBe('redis-hourly');
    });
  });
});
