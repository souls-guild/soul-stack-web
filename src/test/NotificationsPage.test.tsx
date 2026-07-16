import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { HeraldDetail } from '../pages/notifications/HeraldDetail';
import { TidingDetail } from '../pages/notifications/TidingDetail';
import { tokenStore } from '../api/tokenStore';
import type { Tiding } from '../api/keeper';

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

const TIDING_SCENARIOS: Tiding = {
  name: 'run-failures',
  herald: 'ops-webhook',
  event_types: ['scenario_run.*', 'voyage.*'],
  only_failures: true,
  only_changes: false,
  incarnation: 'redis-prod',
  cadence: undefined,
  enabled: true,
  ephemeral: false,
  voyage_id: undefined,
  annotations: undefined,
  projection: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: 'archon-alice',
};

const TIDING_CADENCE: Tiding = {
  name: 'cadence-alerts',
  herald: 'ops-webhook',
  event_types: ['cadence.*'],
  only_failures: false,
  only_changes: true,
  incarnation: undefined,
  cadence: 'redis-hourly',
  enabled: false,
  ephemeral: false,
  voyage_id: undefined,
  annotations: undefined,
  projection: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: undefined,
};

// Ephemeral rule (one-off, bound to a Voyage).
const TIDING_EPHEMERAL: Tiding = {
  name: 'ephemeral-01hz',
  herald: 'ops-webhook',
  event_types: ['voyage.*'],
  only_failures: false,
  only_changes: false,
  incarnation: undefined,
  cadence: undefined,
  enabled: true,
  ephemeral: true,
  voyage_id: '01HZ00000000EPHEMERAL',
  annotations: { env: 'prod' },
  projection: ['summary.succeeded', 'voyage_id'],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: undefined,
};

const HERALDS_REPLY = { items: [HERALD_WEBHOOK, HERALD_DISABLED], offset: 0, limit: 200, total: 2 };
const HERALDS_EMPTY = { items: [], offset: 0, limit: 200, total: 0 };

// Herald channel type catalog (GET /v1/herald-types, ADR-052 amendment) -
// a subset of fields sufficient for form tests (webhook - full set,
// the rest - one representative field each).
const HERALD_TYPES_CATALOG = {
  types: [
    {
      type: 'webhook',
      secret_required: true,
      fields: [
        { name: 'url', label: 'URL', required: true, secret: false, kind: 'url' },
        { name: 'headers', label: 'HTTP-заголовки', required: false, secret: false, kind: 'map' },
        { name: 'http_allowed', label: 'Разрешить http://', required: false, secret: false, kind: 'bool' },
        { name: 'allow_private', label: 'Разрешить приватные IP', required: false, secret: false, kind: 'bool' },
      ],
    },
    {
      type: 'telegram',
      secret_required: false,
      fields: [
        { name: 'bot_token_ref', label: 'Vault-ref токена бота', required: true, secret: true, kind: 'vault_ref' },
        { name: 'chat_id', label: 'ID чата/канала', required: true, secret: false, kind: 'string' },
        { name: 'parse_mode', label: 'Формат текста', required: false, secret: false, kind: 'enum', enum_values: ['', 'MarkdownV2', 'HTML'] },
      ],
    },
    {
      type: 'slack',
      secret_required: false,
      fields: [
        { name: 'webhook_url_ref', label: 'Vault-ref URL incoming-webhook', required: true, secret: true, kind: 'vault_ref' },
      ],
    },
    {
      type: 'mattermost',
      secret_required: false,
      fields: [
        { name: 'webhook_url_ref', label: 'Vault-ref URL incoming-webhook', required: true, secret: true, kind: 'vault_ref' },
        { name: 'channel', label: 'Канал (override)', required: false, secret: false, kind: 'string' },
      ],
    },
    {
      type: 'discord',
      secret_required: false,
      fields: [
        { name: 'webhook_url_ref', label: 'Vault-ref URL webhook', required: true, secret: true, kind: 'vault_ref' },
      ],
    },
    {
      type: 'custom',
      secret_required: false,
      fields: [
        { name: 'url', label: 'URL', required: true, secret: false, kind: 'url' },
        { name: 'method', label: 'HTTP-метод', required: false, secret: false, kind: 'enum', enum_values: ['', 'POST', 'PUT', 'PATCH'] },
      ],
    },
    {
      type: 'email',
      secret_required: false,
      fields: [
        { name: 'smtp_host', label: 'SMTP-хост', required: true, secret: false, kind: 'string' },
        { name: 'smtp_port', label: 'SMTP-порт', required: true, secret: false, kind: 'int' },
        { name: 'to', label: 'Получатели', required: true, secret: false, kind: 'list_string' },
      ],
    },
  ],
};
const TIDINGS_REPLY: TidingsListReply = { items: [TIDING_SCENARIOS, TIDING_CADENCE], offset: 0, limit: 200, total: 2 };
const TIDINGS_EMPTY: TidingsListReply = { items: [], offset: 0, limit: 200, total: 0 };

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

interface TidingsListReply {
  items: Tiding[];
  offset: number;
  limit: number;
  total: number;
}

interface MockOpts {
  heralds?: typeof HERALDS_REPLY | typeof HERALDS_EMPTY;
  tidings?: TidingsListReply;
  heraldDetail?: typeof HERALD_WEBHOOK;
  tidingDetail?: Tiding;
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
    if (url.startsWith('/v1/event-types') && method === 'GET') {
      return new Response(JSON.stringify({
        areas: [
          { name: 'scenario_run.*' },
          { name: 'command_run.*' },
          { name: 'voyage.*' },
          { name: 'cadence.*' },
          { name: 'incarnation.drift_checked' },
        ],
        point_events: [{ name: 'incarnation.run_completed' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/herald-types') && method === 'GET') {
      return new Response(JSON.stringify(HERALD_TYPES_CATALOG), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/heralds') && method === 'GET') {
      return new Response(JSON.stringify(opts.heralds ?? HERALDS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/tidings\/[^/]+$/.test(url) && method === 'GET') {
      const name = url.split('/').pop();
      // opts.tidingDetail takes priority - allows overriding data for a specific test.
      if (opts.tidingDetail && opts.tidingDetail.name === name) {
        return new Response(JSON.stringify(opts.tidingDetail), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const td = [TIDING_SCENARIOS, TIDING_CADENCE, TIDING_EPHEMERAL].find((x) => x.name === name) ?? opts.tidingDetail ?? TIDING_SCENARIOS;
      return new Response(JSON.stringify(td), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/tidings') && method === 'GET') {
      return new Response(JSON.stringify(opts.tidings ?? TIDINGS_REPLY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Mutations
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
    if (url.startsWith('/v1/audit') && method === 'GET') {
      return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'webhook');
    await user.type(within(dialog).getByTestId('herald-field-url'), 'https://example.com/hook');
    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/heralds' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      expect(parsed).toMatchObject({ name: 'new-webhook', type: 'webhook' });
      expect(parsed.config).toMatchObject({ url: 'https://example.com/hook' });
    });

    // Modal closed.
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
    // name empty -> Create button should not submit (required on input).
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
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'webhook');
    const httpCheckbox = within(dialog).getByTestId('herald-field-http_allowed');
    await user.click(httpCheckbox);

    // Warning should appear.
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

    // Select event type.
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
    // event_types empty -> Submit disabled.
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

    // Add a custom type.
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
      // Tidings of this Herald.
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

// --- Guard tests: PUT replace schema + deep-link ---

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
    // Change URL - clear and enter a new one.
    const urlInput = await within(dialog).findByTestId('herald-field-url');
    await user.clear(urlInput);
    await user.type(urlInput, 'https://new.example.com/hook');

    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/heralds\/ops-webhook$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      // Full replace schema: type + config + secret_ref + enabled are required.
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
    // Change incarnation.
    const incInput = within(dialog).getByTestId('tiding-incarnation-input');
    await user.clear(incInput);
    await user.type(incInput, 'new-service');

    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/tidings\/run-failures$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      // Full replace schema.
      expect(parsed).toHaveProperty('herald');
      expect(parsed).toHaveProperty('event_types');
      expect(Object.prototype.hasOwnProperty.call(parsed, 'only_failures')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'only_changes')).toBe(true);
      // incarnation is set to 'new-service' - present in JSON.
      expect(Object.prototype.hasOwnProperty.call(parsed, 'incarnation')).toBe(true);
      // cadence is empty -> absent from JSON (undefined omit = "clear" per replace semantics).
      expect(Object.prototype.hasOwnProperty.call(parsed, 'cadence')).toBe(false);
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
    // Tidings should be present immediately, without clicking the tab.
    await waitFor(() => {
      expect(screen.getByText('run-failures')).toBeInTheDocument();
    });
    // Heralds tab is not active - HeraldsTab content is not rendered.
    expect(screen.queryByTestId('herald-create-btn')).not.toBeInTheDocument();
  });
});

// --- New tests: TidingsTab without ephemeral + annotations/projection ---

// Tiding with annotations+projection for edit tests.
const TIDING_WITH_ANNOT: Tiding = {
  name: 'run-failures',
  herald: 'ops-webhook',
  event_types: ['scenario_run.*', 'voyage.*'],
  only_failures: true,
  only_changes: false,
  incarnation: 'redis-prod',
  cadence: undefined,
  enabled: true,
  ephemeral: false,
  voyage_id: undefined,
  annotations: { env: 'prod' },
  projection: ['summary.succeeded', 'voyage_id'],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: 'archon-alice',
};

describe('TidingsTab — без ephemeral', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('toggle ephemeral отсутствует — backend скрывает разовые по умолчанию', async () => {
    setupMock({ tidings: TIDINGS_REPLY });
    renderNotificationsPage('/notifications?tab=tidings');
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    // Ephemeral toggle button removed.
    expect(screen.queryByTestId('tiding-show-ephemeral-btn')).not.toBeInTheDocument();
  });

  it('постоянные правила отображаются без ephemeral-бейджа', async () => {
    setupMock({ tidings: TIDINGS_REPLY });
    renderNotificationsPage('/notifications?tab=tidings');
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    // No ephemeral badge in the table.
    expect(screen.queryAllByTestId(/tiding-ephemeral-badge-/)).toHaveLength(0);
  });
});

describe('TidingDetail — annotations и projection', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('annotations и projection показаны в мета-блоке', async () => {
    setupMock({ tidingDetail: TIDING_WITH_ANNOT });
    renderNotificationsPage('/notifications/tidings/run-failures');
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    expect(screen.getByTestId('tiding-detail-annotations')).toBeInTheDocument();
    expect(screen.getByTestId('tiding-detail-projection')).toHaveTextContent('summary.succeeded');
  });

  it('ephemeral-бейдж и voyage-ссылка отсутствуют для постоянного правила', async () => {
    setupMock({ tidingDetail: TIDING_SCENARIOS });
    renderNotificationsPage('/notifications/tidings/run-failures');
    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    expect(screen.queryByTestId('tiding-detail-ephemeral-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tiding-detail-voyage-link')).not.toBeInTheDocument();
  });
});

describe('TidingModal — annotations и projection', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('Create Tiding — POST несёт annotations+projection при заполнении', async () => {
    const calls = setupMock();
    renderNotificationsPage('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-create-btn'));
    const dialog = await screen.findByRole('dialog', { name: /Создать Tiding/i });

    await user.type(within(dialog).getByTestId('tiding-name-input'), 'annot-tiding');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'ops-webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('tiding-herald-select'), 'ops-webhook');
    await user.click(within(dialog).getByTestId('event-type-chip-voyage.*'));

    // Add annotation.
    await user.click(within(dialog).getByTestId('tiding-annotation-add'));
    const keyInputs = within(dialog).getAllByLabelText(/^annotation key/);
    const valInputs = within(dialog).getAllByLabelText(/^annotation value/);
    await user.type(keyInputs[0], 'env');
    await user.type(valInputs[0], 'prod');

    // Add projection path.
    await user.click(within(dialog).getByTestId('tiding-projection-add'));
    const pathInputs = within(dialog).getAllByTestId(/^tiding-projection-path-/);
    await user.type(pathInputs[0], 'voyage_id');

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/tidings' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}');
      expect(parsed.annotations).toMatchObject({ env: 'prod' });
      expect(parsed.projection).toContain('voyage_id');
    });
  });

  it('Edit Tiding — PUT несёт annotations+projection', async () => {
    // Use TIDING_WITH_ANNOT (a persistent rule with annotations and projection).
    const calls = setupMock({ tidings: TIDINGS_REPLY, tidingDetail: TIDING_WITH_ANNOT });
    renderNotificationsPage('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-edit-btn-run-failures'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Tiding/i });

    // Form loads existing annotation/projection - add one more annotation.
    await user.click(within(dialog).getByTestId('tiding-annotation-add'));
    const keyInputs = within(dialog).getAllByLabelText(/^annotation key/);
    const valInputs = within(dialog).getAllByLabelText(/^annotation value/);
    // First pair from editing (env=prod), new one is last.
    const lastIdx = keyInputs.length - 1;
    await user.type(keyInputs[lastIdx], 'team');
    await user.type(valInputs[lastIdx], 'ops');

    // Add one more projection path.
    await user.click(within(dialog).getByTestId('tiding-projection-add'));
    const pathInputs = within(dialog).getAllByTestId(/^tiding-projection-path-/);
    await user.type(pathInputs[pathInputs.length - 1], 'summary.failed');

    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/tidings\/run-failures$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      expect(parsed).toHaveProperty('annotations');
      expect(parsed.annotations).toMatchObject({ team: 'ops' });
      expect(parsed).toHaveProperty('projection');
      expect(parsed.projection).toContain('summary.failed');
    });
  });

  it('Edit Tiding — стёр все пути → PUT без projection (omit == clear)', async () => {
    // Open editing TIDING_WITH_ANNOT which has projection=['summary.succeeded','voyage_id'].
    const calls = setupMock({ tidings: TIDINGS_REPLY, tidingDetail: TIDING_WITH_ANNOT });
    renderNotificationsPage('/notifications?tab=tidings');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('run-failures')).toBeInTheDocument());
    await user.click(screen.getByTestId('tiding-edit-btn-run-failures'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Tiding/i });

    // Remove all projection paths.
    let removeBtns = within(dialog).queryAllByLabelText(/^remove projection/);
    while (removeBtns.length > 0) {
      await user.click(removeBtns[0]);
      removeBtns = within(dialog).queryAllByLabelText(/^remove projection/);
    }

    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/tidings\/run-failures$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}');
      // projection is absent from body (omit == clear: empty array is not sent).
      expect(Object.prototype.hasOwnProperty.call(parsed, 'projection')).toBe(false);
    });
  });
});

// --- Tests: delivery history in HeraldDetail ---

const AUDIT_DELIVERY_DELIVERED = {
  id: 'AUD01DLVD000000000000001',
  type: 'herald.delivered',
  source: 'keeper_internal',
  correlation_id: '01VAGE0000000000000000001',
  created_at: new Date().toISOString(),
  payload: { herald: 'ops-webhook', tiding: 'run-failures', status_code: 200, attempt: 1 },
};
const AUDIT_DELIVERY_FAILED = {
  id: 'AUD01FAIL000000000000001',
  type: 'herald.failed',
  source: 'keeper_internal',
  correlation_id: '01VAGE0000000000000000002',
  created_at: new Date().toISOString(),
  payload: { herald: 'ops-webhook', tiding: 'run-failures', status_code: 503, attempt: 3 },
};

describe('HeraldDetail — история доставок', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('пустой список доставок → empty-state', async () => {
    setupMock({ heraldDetail: HERALD_WEBHOOK });
    renderNotificationsPage('/notifications/heralds/ops-webhook');
    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('herald-deliveries-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('herald-deliveries-table')).not.toBeInTheDocument();
  });

  it('доставки отображаются: delivered (ok) и failed (danger)', async () => {
    // Override the audit mock for this test.
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });

      if (url.startsWith('/v1/me/permissions')) return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (/^\/v1\/heralds\/ops-webhook$/.test(url)) return new Response(JSON.stringify(HERALD_WEBHOOK), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/heralds')) return new Response(JSON.stringify({ items: [HERALD_WEBHOOK], offset: 0, limit: 200, total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/tidings')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/audit')) return new Response(JSON.stringify({ items: [AUDIT_DELIVERY_DELIVERED, AUDIT_DELIVERY_FAILED], offset: 0, limit: 50, total: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 599 });
    });

    renderNotificationsPage('/notifications/heralds/ops-webhook');
    await waitFor(() => expect(screen.getByTestId('herald-deliveries-table')).toBeInTheDocument());

    expect(screen.getByTestId(`delivery-row-${AUDIT_DELIVERY_DELIVERED.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`delivery-row-${AUDIT_DELIVERY_FAILED.id}`)).toBeInTheDocument();
    expect(screen.getByText('доставлено')).toBeInTheDocument();
    expect(screen.getByText('ошибка')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('503')).toBeInTheDocument();
  });

  it('ссылки на voyage из correlation_id в строке доставки', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/me/permissions')) return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (/^\/v1\/heralds\/ops-webhook$/.test(url)) return new Response(JSON.stringify(HERALD_WEBHOOK), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/heralds')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/tidings')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/audit')) return new Response(JSON.stringify({ items: [AUDIT_DELIVERY_DELIVERED], offset: 0, limit: 50, total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      void method;
      return new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } });
    });

    renderNotificationsPage('/notifications/heralds/ops-webhook');
    await waitFor(() => expect(screen.getByTestId('herald-deliveries-table')).toBeInTheDocument());

    const voyageLink = screen.getByTestId(`delivery-voyage-link-${AUDIT_DELIVERY_DELIVERED.id}`);
    expect(voyageLink).toHaveAttribute('href', `/voyages/${AUDIT_DELIVERY_DELIVERED.correlation_id}`);
  });

  it('audit-запрос использует payload_herald=herald-name', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') calls.push(url);
      if (url.startsWith('/v1/me/permissions')) return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (/^\/v1\/heralds\/ops-webhook$/.test(url)) return new Response(JSON.stringify(HERALD_WEBHOOK), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/heralds')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/tidings')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/v1/audit')) return new Response(JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 599 });
    });

    renderNotificationsPage('/notifications/heralds/ops-webhook');
    await waitFor(() => expect(screen.getByText('ops-webhook')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('herald-deliveries-empty')).toBeInTheDocument());

    const auditCall = calls.find((u) => u.startsWith('/v1/audit'));
    expect(auditCall).toBeDefined();
    expect(auditCall).toContain('payload_herald=ops-webhook');
    expect(auditCall).toContain('type=herald.delivered');
    expect(auditCall).toContain('type=herald.failed');
  });
});
