import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { HeraldDetail } from '../pages/notifications/HeraldDetail';
import { TidingDetail } from '../pages/notifications/TidingDetail';
import { tokenStore } from '../api/tokenStore';

// --- Sample data ---

const HERALD_WEBHOOK = {
  name: 'ops-webhook',
  type: 'webhook',
  config: { url: 'https://hooks.example.com/notify', headers: { 'Authorization': 'Bearer tok' } },
  secret_ref: 'vault:secret/my-token',
  enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: 'archon-alice',
};

const HERALD_DISABLED = {
  name: 'dev-webhook',
  type: 'webhook',
  config: { url: 'http://dev.internal/notify', http_allowed: true },
  secret_ref: null,
  enabled: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: null,
};

const TIDING_SCENARIOS = {
  name: 'run-failures',
  herald: 'ops-webhook',
  event_types: ['scenario_run.*', 'voyage.*'],
  only_failures: true,
  only_changes: false,
  incarnation: 'redis-prod',
  cadence: null,
  enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: 'archon-alice',
};

const TIDING_CADENCE = {
  name: 'cadence-alerts',
  herald: 'ops-webhook',
  event_types: ['cadence.*'],
  only_failures: false,
  only_changes: true,
  incarnation: null,
  cadence: 'redis-hourly',
  enabled: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: null,
};

const HERALDS_REPLY = { items: [HERALD_WEBHOOK, HERALD_DISABLED], offset: 0, limit: 200, total: 2 };
const HERALDS_EMPTY = { items: [], offset: 0, limit: 200, total: 0 };
const TIDINGS_REPLY = { items: [TIDING_SCENARIOS, TIDING_CADENCE], offset: 0, limit: 200, total: 2 };
const TIDINGS_EMPTY = { items: [], offset: 0, limit: 200, total: 0 };

const MY_PERMS_WILDCARD = { permissions: [{ wildcard: true }] };
const MY_PERMS_NO_CREATE = {
  permissions: [{ wildcard: false, resource: 'soul', action: 'list' }],
};
const MY_PERMS_NO_UPDATE = {
  permissions: [
    { wildcard: false, resource: 'herald', action: 'create' },
    { wildcard: false, resource: 'herald', action: 'delete' },
    { wildcard: false, resource: 'tiding', action: 'create' },
    { wildcard: false, resource: 'tiding', action: 'delete' },
  ],
};

interface MockOpts {
  heralds?: typeof HERALDS_REPLY | typeof HERALDS_EMPTY;
  tidings?: typeof TIDINGS_REPLY | typeof TIDINGS_EMPTY;
  heraldDetail?: typeof HERALD_WEBHOOK;
  tidingDetail?: typeof TIDING_SCENARIOS;
  myPerms?: typeof MY_PERMS_WILDCARD;
  conflict?: { path: RegExp; method: string; status: number; type?: string; detail?: string };
}

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function setupMock(opts: MockOpts = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });

    if (opts.conflict && opts.conflict.path.test(url) && method === opts.conflict.method) {
      return new Response(
        JSON.stringify({ type: opts.conflict.type ?? 'about:blank', title: 'Error', status: opts.conflict.status, detail: opts.conflict.detail ?? 'error' }),
        { status: opts.conflict.status, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }

    if (url.startsWith('/v1/me/permissions') && method === 'GET') {
      return new Response(JSON.stringify(opts.myPerms ?? MY_PERMS_WILDCARD), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/heralds\/[^/]+$/.test(url) && method === 'GET') {
      const name = url.split('/').pop();
      const h = [HERALD_WEBHOOK, HERALD_DISABLED].find((x) => x.name === name) ?? opts.heraldDetail ?? HERALD_WEBHOOK;
      return new Response(JSON.stringify(h), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/heralds') && method === 'GET') {
      return new Response(JSON.stringify(opts.heralds ?? HERALDS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/tidings\/[^/]+$/.test(url) && method === 'GET') {
      const name = url.split('/').pop();
      const td = [TIDING_SCENARIOS, TIDING_CADENCE].find((x) => x.name === name) ?? opts.tidingDetail ?? TIDING_SCENARIOS;
      return new Response(JSON.stringify(td), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/tidings') && method === 'GET') {
      return new Response(JSON.stringify(opts.tidings ?? TIDINGS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Мутации
    if (/^\/v1\/heralds$/.test(url) && method === 'POST') {
      return new Response(JSON.stringify({ ...HERALD_WEBHOOK, name: 'new-webhook' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/heralds\/[^/]+$/.test(url) && method === 'PUT') {
      return new Response(JSON.stringify(HERALD_WEBHOOK), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/heralds\/[^/]+$/.test(url) && method === 'DELETE') {
      return new Response('', { status: 204 });
    }
    if (/^\/v1\/tidings$/.test(url) && method === 'POST') {
      return new Response(JSON.stringify({ ...TIDING_SCENARIOS, name: 'new-tiding' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/tidings\/[^/]+$/.test(url) && method === 'PUT') {
      return new Response(JSON.stringify(TIDING_SCENARIOS), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/tidings\/[^/]+$/.test(url) && method === 'DELETE') {
      return new Response('', { status: 204 });
    }

    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderNotificationsPage(path = '/notifications') {
  return renderWithProviders(
    <Routes>
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/notifications/heralds/:name" element={<HeraldDetail />} />
      <Route path="/notifications/tidings/:name" element={<TidingDetail />} />
    </Routes>,
    path,
  );
}

describe('NotificationsPage — Heralds tab', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит список Herald-каналов', async () => {
    setupMock();
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByText('ops-webhook')).toBeInTheDocument();
      expect(screen.getByText('dev-webhook')).toBeInTheDocument();
    });
  });

  it('empty-state при пустом списке Heralds', async () => {
    setupMock({ heralds: HERALDS_EMPTY });
    renderNotificationsPage();
    await waitFor(() => {
      expect(screen.getByText(/Каналов нет/i)).toBeInTheDocument();
    });
  });

  it('кнопка «Создать канал» скрыта без herald.create', async () => {
    setupMock({ myPerms: MY_PERMS_NO_CREATE });
    renderNotificationsPage();
    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    const btn = screen.getByTestId('herald-create-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'herald.create');
  });

  it('кнопка «Изменить» скрыта без herald.update', async () => {
    setupMock({ myPerms: MY_PERMS_NO_UPDATE });
    renderNotificationsPage();
    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    const btn = screen.getByTestId('herald-edit-btn-ops-webhook');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'herald.update');
  });

  it('Create Herald — POST /v1/heralds с name+type+config', async () => {
    const calls = setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Herald/i });
    await user.type(within(dialog).getByTestId('herald-name-input'), 'new-webhook');
    await user.type(within(dialog).getByTestId('herald-url-input'), 'https://example.com/hook');
    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/heralds' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      expect(parsed).toMatchObject({ name: 'new-webhook', type: 'webhook' });
      expect(parsed.config).toMatchObject({ url: 'https://example.com/hook' });
    });

    // Модалка закрылась.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Создать Herald/i })).not.toBeInTheDocument();
    });
  });

  it('Create Herald с обязательным полем name — поле required', async () => {
    setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Herald/i });
    // name пусто → кнопка Создать не должна отправить (required на input).
    const nameInput = within(dialog).getByTestId('herald-name-input');
    expect(nameInput).toBeRequired();
  });

  it('Delete Herald — открывает confirm-модалку → DELETE /v1/heralds/{name}', async () => {
    const calls = setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-delete-btn-ops-webhook'));

    const dialog = await screen.findByRole('dialog', { name: /Удалить Herald/i });
    expect(within(dialog).getByText(/ops-webhook/)).toBeInTheDocument();
    await user.click(within(dialog).getByTestId('herald-delete-confirm-btn'));

    await waitFor(() => {
      const del = calls.find((c) => c.url === '/v1/heralds/ops-webhook' && c.method === 'DELETE');
      expect(del).toBeDefined();
    });
  });

  it('Delete Herald 422 → error в confirm-модалке', async () => {
    setupMock({
      conflict: {
        path: /^\/v1\/heralds\/ops-webhook$/,
        method: 'DELETE',
        status: 422,
        detail: 'cannot delete',
      },
    });
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-delete-btn-ops-webhook'));
    const dialog = await screen.findByRole('dialog', { name: /Удалить Herald/i });
    await user.click(within(dialog).getByTestId('herald-delete-confirm-btn'));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/422|cannot delete/i);
  });

  it('SSRF-warning показывается при включении http_allowed', async () => {
    setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Herald/i });
    // Открываем advanced.
    await user.click(within(dialog).getByTestId('herald-advanced-toggle'));
    const httpCheckbox = within(dialog).getByTestId('herald-http-allowed');
    await user.click(httpCheckbox);

    // Warning должен появиться.
    await waitFor(() => {
      const warnings = within(dialog).getAllByRole('alert');
      const hasWarn = warnings.some((el) => el.textContent?.includes('TLS'));
      expect(hasWarn).toBe(true);
    });
  });
});

describe('NotificationsPage — Tidings tab', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('переключение на таб Tidings', async () => {
    setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => {
      expect(screen.getByText('run-failures')).toBeInTheDocument();
    });
  });

  it('рендерит список Tiding-правил', async () => {
    setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => {
      expect(screen.getByText('run-failures')).toBeInTheDocument();
      expect(screen.getByText('cadence-alerts')).toBeInTheDocument();
    });
  });

  it('tiding→herald кросс-ссылка href корректна', async () => {
    setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());

    const link = screen.getByTestId('tiding-herald-link-run-failures');
    expect(link).toHaveAttribute('href', '/notifications/heralds/ops-webhook');
  });

  it('empty-state при пустом списке Tidings', async () => {
    setupMock({ tidings: TIDINGS_EMPTY });
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => {
      expect(screen.getByText(/Правил нет/i)).toBeInTheDocument();
    });
  });

  it('кнопка «Создать правило» задизейблена без tiding.create', async () => {
    setupMock({ myPerms: MY_PERMS_NO_CREATE });
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());

    const btn = screen.getByTestId('tiding-create-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'tiding.create');
  });

  it('кнопка «Изменить» задизейблена без tiding.update', async () => {
    setupMock({ myPerms: MY_PERMS_NO_UPDATE });
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());

    const btn = screen.getByTestId('tiding-edit-btn-run-failures');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'tiding.update');
  });

  it('Create Tiding — POST /v1/tidings с herald + event_types', async () => {
    const calls = setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });
    await user.type(within(dialog).getByTestId('tiding-name-input'), 'my-tiding');

    // Herald select.
    await waitFor(() => {
      const select = within(dialog).getByTestId('tiding-herald-select');
      expect(within(select).getByRole('option', { name: 'ops-webhook' })).toBeInTheDocument();
    });
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');

    // Выбрать event type.
    await user.click(within(dialog).getByTestId('event-type-chip-scenario_run.*'));

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/tidings' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      expect(parsed.name).toBe('my-tiding');
      expect(parsed.herald).toBe('ops-webhook');
      expect(parsed.event_types).toContain('scenario_run.*');
    });
  });

  it('Create Tiding — кнопка Создать disabled без event_types', async () => {
    setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });
    await user.type(within(dialog).getByTestId('tiding-name-input'), 'my-tiding');
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');
    // event_types пусто → Submit disabled.
    const submitBtn = within(dialog).getByRole('button', { name: /Создать/i });
    expect(submitBtn).toBeDisabled();
  });

  it('Custom event type — добавляется и попадает в body', async () => {
    const calls = setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));

    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });
    await user.type(within(dialog).getByTestId('tiding-name-input'), 'custom-tiding');
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');

    // Добавить произвольный тип.
    await user.type(within(dialog).getByTestId('tiding-custom-event-type-input'), 'my_domain.custom');
    await user.click(within(dialog).getByTestId('tiding-add-custom-type-btn'));

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/tidings' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      expect(parsed.event_types).toContain('my_domain.custom');
    });
  });

  it('Delete Tiding — DELETE /v1/tidings/{name}', async () => {
    const calls = setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-delete-btn-run-failures'));

    const dialog = await screen.findByRole('dialog', { name: /Удалить Tiding/i });
    await user.click(within(dialog).getByTestId('tiding-delete-confirm-btn'));

    await waitFor(() => {
      const del = calls.find((c) => c.url === '/v1/tidings/run-failures' && c.method === 'DELETE');
      expect(del).toBeDefined();
    });
  });
});

describe('HeraldDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит детали Herald и список связанных Tidings', async () => {
    setupMock();
    renderNotificationsPage('/notifications/heralds/ops-webhook');
    await waitFor(() => {
      expect(screen.getByText('ops-webhook')).toBeInTheDocument();
      // Tiding-ы этого Herald.
      expect(screen.getByText('run-failures')).toBeInTheDocument();
    });
  });

  it('кросс-ссылка назад на /notifications присутствует', async () => {
    setupMock();
    renderNotificationsPage('/notifications/heralds/ops-webhook');
    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());

    const breadcrumbs = screen.getAllByRole('link');
    const notifLink = breadcrumbs.find((l) => l.getAttribute('href') === '/notifications');
    expect(notifLink).toBeDefined();
  });
});

describe('TidingDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит детали Tiding со ссылкой на Herald', async () => {
    setupMock();
    renderNotificationsPage('/notifications/tidings/run-failures');
    await waitFor(() => {
      expect(screen.getByText('run-failures')).toBeInTheDocument();
    });
    const heraldLink = screen.getByTestId('tiding-detail-herald-link');
    expect(heraldLink).toHaveAttribute('href', '/notifications/heralds/ops-webhook');
  });

  it('кросс-ссылка на инкарнацию присутствует', async () => {
    setupMock();
    renderNotificationsPage('/notifications/tidings/run-failures');
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    // TIDING_SCENARIOS.incarnation = 'redis-prod'.
    const link = screen.getByRole('link', { name: 'redis-prod' });
    expect(link).toHaveAttribute('href', '/incarnations/redis-prod');
  });
});

// --- Guard-тесты: PUT replace-схема + deep-link ---

describe('PUT replace-схема — Herald edit', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('Edit Herald → PUT несёт полную replace-схему (type+config+secret_ref+enabled)', async () => {
    const calls = setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-edit-btn-ops-webhook'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Herald/i });
    // Меняем URL — очищаем и вводим новый.
    const urlInput = within(dialog).getByTestId('herald-url-input');
    await user.clear(urlInput);
    await user.type(urlInput, 'https://new.example.com/hook');

    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/heralds\/ops-webhook$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      // Полная replace-схема: type + config + secret_ref + enabled обязательны.
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('config');
      expect(Object.prototype.hasOwnProperty.call(parsed, 'secret_ref')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'enabled')).toBe(true);
    });
  });
});

describe('PUT replace-схема — Tiding edit', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('Edit Tiding → PUT несёт полную replace-схему (herald+event_types+only_*+incarnation+cadence+enabled)', async () => {
    const calls = setupMock();
    renderNotificationsPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-tidings'));
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-edit-btn-run-failures'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Tiding/i });
    // Меняем incarnation.
    const incInput = within(dialog).getByTestId('tiding-incarnation-input');
    await user.clear(incInput);
    await user.type(incInput, 'new-service');

    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/tidings\/run-failures$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      // Полная replace-схема.
      expect(parsed).toHaveProperty('herald');
      expect(parsed).toHaveProperty('event_types');
      expect(Object.prototype.hasOwnProperty.call(parsed, 'only_failures')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'only_changes')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'incarnation')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'cadence')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'enabled')).toBe(true);
    });
  });
});

describe('NotificationsPage — deep-link ?tab=tidings', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('?tab=tidings сразу открывает таб Tidings', async () => {
    setupMock();
    renderNotificationsPage('/notifications?tab=tidings');
    // Сразу должны быть tiding-ы, без клика по табу.
    await waitFor(() => {
      expect(screen.getByText('run-failures')).toBeInTheDocument();
    });
    // Таб Heralds не активен — содержимое HeraldsTab не отрисовано.
    expect(screen.queryByTestId('herald-create-btn')).not.toBeInTheDocument();
  });
});
