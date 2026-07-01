/**
 * Тесты динамического рендера HeraldModal по каталогу GET /v1/herald-types
 * (ADR-052 amendment, ADR-042 no-hardcode).
 *
 * Проверяет:
 *   1. GET /v1/herald-types фетчится при открытии HeraldModal.
 *   2. Выбор типа канала рендерит ИМЕННО его поля из каталога (не хардкод).
 *   3. Смена типа сбрасывает значения полей предыдущего типа.
 *   4. kind=bool/map/list_string/vault_ref/enum маппятся на соответствующий контрол.
 *   5. Fallback при ошибке фетча каталога: форма без краша, submit недоступен
 *      (нечем рендерить поля конкретного типа без каталога).
 *   6. Submit disabled, пока не заполнены required-поля выбранного типа.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { tokenStore } from '../api/tokenStore';

const HERALD_TYPES_CATALOG = {
  types: [
    {
      type: 'webhook',
      secret_required: true,
      fields: [
        { name: 'url', label: 'URL', required: true, secret: false, kind: 'url' },
        { name: 'headers', label: 'HTTP-заголовки', required: false, secret: false, kind: 'map' },
        { name: 'http_allowed', label: 'Разрешить http://', required: false, secret: false, kind: 'bool' },
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

const HERALDS_EMPTY = { items: [], offset: 0, limit: 200, total: 0 };
const TIDINGS_EMPTY = { items: [], offset: 0, limit: 200, total: 0 };

const HERALD_TELEGRAM_EXISTING = {
  name: 'ops-telegram',
  type: 'telegram',
  config: { chat_id: '-100555', bot_token_ref: 'vault:secret/tg-bot' },
  secret_ref: null,
  enabled: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  created_by_aid: 'archon-alice',
};
const HERALDS_WITH_TELEGRAM = { items: [HERALD_TELEGRAM_EXISTING], offset: 0, limit: 200, total: 1 };

function setupMock(opts: { heraldTypesFail?: boolean; heralds?: typeof HERALDS_EMPTY | typeof HERALDS_WITH_TELEGRAM } = {}) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });

    if (url.startsWith('/v1/me/permissions')) {
      return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/herald-types')) {
      if (opts.heraldTypesFail) {
        return new Response(JSON.stringify({ type: 'about:blank', title: 'Error', status: 500, detail: 'internal' }), { status: 500, headers: { 'Content-Type': 'application/problem+json' } });
      }
      return new Response(JSON.stringify(HERALD_TYPES_CATALOG), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/event-types')) {
      return new Response(JSON.stringify({ areas: [], point_events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/heralds') && method === 'GET') {
      return new Response(JSON.stringify(opts.heralds ?? HERALDS_EMPTY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/tidings') && method === 'GET') {
      return new Response(JSON.stringify(TIDINGS_EMPTY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/v1/heralds' && method === 'POST') {
      return new Response(JSON.stringify({
        name: 'my-telegram', type: 'telegram', config: { chat_id: '123', bot_token_ref: 'vault:secret/tok' },
        secret_ref: null, enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by_aid: null,
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^\/v1\/heralds\/ops-telegram$/.test(url) && method === 'PUT') {
      return new Response(JSON.stringify(HERALD_TELEGRAM_EXISTING), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderNotif(path = '/notifications') {
  return renderWithProviders(
    <Routes>
      <Route path="/notifications" element={<NotificationsPage />} />
    </Routes>,
    path,
  );
}

async function openCreateModal() {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByTestId('herald-create-btn')).toBeInTheDocument());
  await user.click(screen.getByTestId('herald-create-btn'));
  const dialog = await screen.findByRole('dialog', { name: /Создать Herald/i });
  return { dialog, user };
}

beforeEach(() => {
  tokenStore.clear();
});

describe('HeraldModal — динамический рендер по каталогу GET /v1/herald-types', () => {
  it('GET /v1/herald-types вызывается при открытии HeraldModal', async () => {
    const calls = setupMock();
    renderNotif();
    await openCreateModal();

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/v1/herald-types'))).toBe(true);
    });
  });

  it('селектор типа предлагает все типы из каталога (не хардкод)', async () => {
    setupMock();
    renderNotif();
    const { dialog } = await openCreateModal();

    await waitFor(() => {
      const select = within(dialog).getByTestId('herald-type-select');
      expect(within(select).getByRole('option', { name: 'webhook' })).toBeInTheDocument();
      expect(within(select).getByRole('option', { name: 'telegram' })).toBeInTheDocument();
      expect(within(select).getByRole('option', { name: 'email' })).toBeInTheDocument();
    });
  });

  it('выбор telegram рендерит ИМЕННО его поля (bot_token_ref/chat_id/parse_mode), не webhook-поля', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');

    expect(within(dialog).getByTestId('herald-field-bot_token_ref')).toBeInTheDocument();
    expect(within(dialog).getByTestId('herald-field-chat_id')).toBeInTheDocument();
    expect(within(dialog).getByTestId('herald-field-parse_mode')).toBeInTheDocument();
    // webhook-специфичные поля отсутствуют.
    expect(within(dialog).queryByTestId('herald-field-url')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('herald-field-headers')).not.toBeInTheDocument();
  });

  it('kind=vault_ref рендерится как password-input (секрет не виден на экране)', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');

    const tokenInput = within(dialog).getByTestId('herald-field-bot_token_ref');
    expect(tokenInput).toHaveAttribute('type', 'password');
  });

  it('kind=list_string рендерится как textarea (email.to)', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'email' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'email');

    const toField = within(dialog).getByTestId('herald-field-to');
    expect(toField.tagName).toBe('TEXTAREA');
  });

  it('kind=int рендерится как number-input (email.smtp_port)', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'email' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'email');

    const portField = within(dialog).getByTestId('herald-field-smtp_port');
    expect(portField).toHaveAttribute('type', 'number');
  });

  it('kind=enum с enum_values из каталога рендерится как select с опциями (не хардкод)', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');

    const parseMode = within(dialog).getByTestId('herald-field-parse_mode');
    expect(parseMode.tagName).toBe('SELECT');
    expect(within(parseMode).getByRole('option', { name: 'MarkdownV2' })).toBeInTheDocument();
    expect(within(parseMode).getByRole('option', { name: 'HTML' })).toBeInTheDocument();
    // Пустая строка в enum_values — читаемая "не задано"-опция, не голый "" в списке.
    expect(within(parseMode).getByRole('option', { name: '— не задано —' })).toBeInTheDocument();

    await user.selectOptions(parseMode, 'HTML');
    expect(parseMode).toHaveValue('HTML');
  });

  it('kind=enum без enum_values в каталоге (пусто/absent) — fallback на текстовый ввод, форма не крашится', async () => {
    const calls: { url: string }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      calls.push({ url });
      if (url.startsWith('/v1/me/permissions')) {
        return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/herald-types')) {
        return new Response(JSON.stringify({
          types: [{
            type: 'telegram',
            secret_required: false,
            fields: [
              { name: 'chat_id', label: 'ID чата/канала', required: true, secret: false, kind: 'string' },
              { name: 'parse_mode', label: 'Формат текста', required: false, secret: false, kind: 'enum' },
            ],
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/event-types')) {
        return new Response(JSON.stringify({ areas: [], point_events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/heralds') || url.startsWith('/v1/tidings')) {
        return new Response(JSON.stringify(HERALDS_EMPTY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 599 });
    });
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');

    const parseMode = within(dialog).getByTestId('herald-field-parse_mode');
    expect(parseMode.tagName).toBe('INPUT');
    expect(parseMode).not.toHaveAttribute('type', 'password');
  });

  it('смена типа сбрасывает значения полей предыдущего типа', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'webhook');
    await user.type(within(dialog).getByTestId('herald-field-url'), 'https://example.com/hook');

    // Переключаемся на telegram — webhook-поля пропадают вместе со значением.
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');
    expect(within(dialog).queryByTestId('herald-field-url')).not.toBeInTheDocument();

    // Возврат на webhook — url снова пуст (не сохранил старое значение).
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'webhook');
    expect(within(dialog).getByTestId('herald-field-url')).toHaveValue('');
  });

  it('submit disabled, пока required-поля выбранного типа не заполнены', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await user.type(within(dialog).getByTestId('herald-name-input'), 'my-telegram');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');

    const submitBtn = within(dialog).getByRole('button', { name: /Создать/i });
    expect(submitBtn).toBeDisabled();

    await user.type(within(dialog).getByTestId('herald-field-bot_token_ref'), 'vault:secret/tok');
    await user.type(within(dialog).getByTestId('herald-field-chat_id'), '12345');

    await waitFor(() => expect(submitBtn).not.toBeDisabled());
  });

  it('Create с типом telegram — POST несёт config с bot_token_ref/chat_id, БЕЗ top-level secret_ref', async () => {
    const calls = setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await user.type(within(dialog).getByTestId('herald-name-input'), 'my-telegram');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');
    await user.type(within(dialog).getByTestId('herald-field-bot_token_ref'), 'vault:secret/tg-token');
    await user.type(within(dialog).getByTestId('herald-field-chat_id'), '98765');

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/heralds' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}') as {
        name: string; type: string; config: Record<string, unknown>; secret_ref?: string;
      };
      expect(parsed.name).toBe('my-telegram');
      expect(parsed.type).toBe('telegram');
      expect(parsed.config).toMatchObject({ bot_token_ref: 'vault:secret/tg-token', chat_id: '98765' });
      // telegram — secret_required=false в каталоге — не должно быть в body.
      expect(parsed.secret_ref).toBeUndefined();
    });
  });

  it('top-level Vault-ref для подписи показывается для secret_required=true (webhook), не для secret_required=false (telegram)', async () => {
    setupMock();
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'webhook');
    expect(within(dialog).getByTestId('herald-secret-ref-input')).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');
    expect(within(dialog).queryByTestId('herald-secret-ref-input')).not.toBeInTheDocument();
  });

  it('secret_ref-поле driven от entry.secret_required каталога, не от хардкода type==="webhook"', async () => {
    // Второй (гипотетический) тип с secret_required=true, отличный от webhook —
    // доказывает, что показ поля читается из каталога, а не завязан на имя типа.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.startsWith('/v1/me/permissions')) {
        return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/herald-types')) {
        return new Response(JSON.stringify({
          types: [
            { type: 'telegram', secret_required: false, fields: [{ name: 'chat_id', label: 'ID чата', required: true, secret: false, kind: 'string' }] },
            { type: 'custom', secret_required: true, fields: [{ name: 'url', label: 'URL', required: true, secret: false, kind: 'url' }] },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/event-types')) {
        return new Response(JSON.stringify({ areas: [], point_events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/heralds') || url.startsWith('/v1/tidings')) {
        return new Response(JSON.stringify(HERALDS_EMPTY), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 599 });
    });
    renderNotif();
    const { dialog, user } = await openCreateModal();

    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'custom' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'custom');
    expect(within(dialog).getByTestId('herald-secret-ref-input')).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');
    expect(within(dialog).queryByTestId('herald-secret-ref-input')).not.toBeInTheDocument();
  });

  it('fallback при ошибке фетча каталога: форма открывается без краша, error-state показан', async () => {
    setupMock({ heraldTypesFail: true });
    renderNotif();
    const { dialog } = await openCreateModal();

    expect(dialog).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByTestId('herald-type-catalog-error')).toBeInTheDocument();
    });
    // Без каталога типов селектор не предлагает вариантов кроме placeholder.
    const select = within(dialog).getByTestId('herald-type-select');
    expect(within(select).queryAllByRole('option')).toHaveLength(1);
  });
});

describe('HeraldModal — редактирование non-webhook типа (telegram)', () => {
  it('editing предзаполняет тип и поля из существующего config', async () => {
    setupMock({ heralds: HERALDS_WITH_TELEGRAM });
    renderNotif();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-telegram')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-edit-btn-ops-telegram'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Herald/i });
    await waitFor(() => {
      expect(within(dialog).getByTestId('herald-type-select')).toHaveValue('telegram');
    });
    await waitFor(() => {
      expect(within(dialog).getByTestId('herald-field-chat_id')).toHaveValue('-100555');
      expect(within(dialog).getByTestId('herald-field-bot_token_ref')).toHaveValue('vault:secret/tg-bot');
    });
  });

  it('Edit telegram — PUT несёт заменённый config, без top-level secret_ref', async () => {
    const calls = setupMock({ heralds: HERALDS_WITH_TELEGRAM });
    renderNotif();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('ops-telegram')).toBeInTheDocument());
    await user.click(screen.getByTestId('herald-edit-btn-ops-telegram'));

    const dialog = await screen.findByRole('dialog', { name: /Редактировать Herald/i });
    const chatIdInput = await within(dialog).findByTestId('herald-field-chat_id');
    await waitFor(() => expect(chatIdInput).toHaveValue('-100555'));
    await user.clear(chatIdInput);
    await user.type(chatIdInput, '-100999');

    await user.click(within(dialog).getByRole('button', { name: /Сохранить/i }));

    await waitFor(() => {
      const put = calls.find((c) => /^\/v1\/heralds\/ops-telegram$/.test(c.url) && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}') as { type: string; config: Record<string, unknown>; secret_ref?: string };
      expect(parsed.type).toBe('telegram');
      expect(parsed.config).toMatchObject({ chat_id: '-100999', bot_token_ref: 'vault:secret/tg-bot' });
      expect(parsed.secret_ref).toBeUndefined();
    });
  });
});
