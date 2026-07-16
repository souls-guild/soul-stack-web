/**
 * Dual-mode приём секрета Herald (ADR-064, NIM-11):
 *   1. Config-секрет (telegram bot_token) в режиме «значение» → POST config несёт
 *      plaintext `bot_token`, БЕЗ `bot_token_ref` (XOR).
 *   2. Config-секрет в режиме «путь» (default) → POST config несёт `bot_token_ref`.
 *   3. Top-level webhook secret в режиме «значение» → POST несёт `secret`, без `secret_ref`.
 *   4. accept_plaintext выключен (422) → форма показывает pretty-error, не крашится.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { tokenStore } from '../api/tokenStore';

const CATALOG = {
  types: [
    {
      type: 'webhook',
      secret_required: true,
      fields: [
        { name: 'url', label: 'URL', required: true, secret: false, kind: 'url' },
      ],
    },
    {
      type: 'telegram',
      secret_required: false,
      fields: [
        { name: 'bot_token_ref', label: 'Vault-ref токена бота', required: true, secret: true, kind: 'vault_ref' },
        { name: 'chat_id', label: 'ID чата', required: true, secret: false, kind: 'string' },
      ],
    },
  ],
};

const EMPTY = { items: [], offset: 0, limit: 200, total: 0 };

function setupMock(opts: { postStatus?: number; postDetail?: string } = {}) {
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
      return new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/event-types')) {
      return new Response(JSON.stringify({ areas: [], point_events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if ((url.startsWith('/v1/heralds') || url.startsWith('/v1/tidings')) && method === 'GET') {
      return new Response(JSON.stringify(EMPTY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/v1/heralds' && method === 'POST') {
      if (opts.postStatus && opts.postStatus >= 400) {
        return new Response(
          JSON.stringify({ type: 'about:blank', title: 'Unprocessable Entity', status: opts.postStatus, detail: opts.postDetail ?? 'invalid' }),
          { status: opts.postStatus, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      return new Response(JSON.stringify({
        name: 'x', type: 'telegram', config: {}, secret_ref: null, enabled: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by_aid: null,
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderNotif() {
  return renderWithProviders(
    <Routes><Route path="/notifications" element={<NotificationsPage />} /></Routes>,
    '/notifications',
  );
}

async function openCreate() {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByTestId('herald-create-btn')).toBeInTheDocument());
  await user.click(screen.getByTestId('herald-create-btn'));
  const dialog = await screen.findByRole('dialog', { name: /Создать Herald/i });
  return { dialog, user };
}

beforeEach(() => { tokenStore.clear(); });

describe('Herald dual-mode secret (NIM-11)', () => {
  it('config-секрет в режиме «значение» → POST config несёт plaintext bot_token, без bot_token_ref', async () => {
    const calls = setupMock();
    renderNotif();
    const { dialog, user } = await openCreate();

    await user.type(within(dialog).getByTestId('herald-name-input'), 'tg1');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');

    // Switch secret field bot_token to "value" mode.
    await user.click(within(dialog).getByTestId('herald-secret-bot_token-mode-value'));
    await user.type(within(dialog).getByTestId('herald-secret-bot_token-value'), '123456:ABC-PLAINTEXT');
    await user.type(within(dialog).getByTestId('herald-field-chat_id'), '777');

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/heralds' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}') as { config: Record<string, unknown> };
      expect(parsed.config.bot_token).toBe('123456:ABC-PLAINTEXT');
      expect(parsed.config.bot_token_ref).toBeUndefined();
    });
  });

  it('config-секрет в режиме «путь» (default) → POST config несёт bot_token_ref, без plaintext', async () => {
    const calls = setupMock();
    renderNotif();
    const { dialog, user } = await openCreate();

    await user.type(within(dialog).getByTestId('herald-name-input'), 'tg2');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');

    await user.type(within(dialog).getByTestId('herald-field-bot_token_ref'), 'vault:secret/tg');
    await user.type(within(dialog).getByTestId('herald-field-chat_id'), '777');
    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/heralds' && c.method === 'POST');
      const parsed = JSON.parse(post!.body ?? '{}') as { config: Record<string, unknown> };
      expect(parsed.config.bot_token_ref).toBe('vault:secret/tg');
      expect(parsed.config.bot_token).toBeUndefined();
    });
  });

  it('top-level webhook secret в режиме «значение» → POST несёт plaintext secret, без secret_ref', async () => {
    const calls = setupMock();
    renderNotif();
    const { dialog, user } = await openCreate();

    await user.type(within(dialog).getByTestId('herald-name-input'), 'wh1');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'webhook' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'webhook');
    await user.type(within(dialog).getByTestId('herald-field-url'), 'https://example.com/hook');

    // Top-level signing secret: switch to "value" mode.
    await user.click(within(dialog).getByTestId('herald-secret-mode-value'));
    await user.type(within(dialog).getByTestId('herald-secret-value'), 'plain-signing-token');

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/heralds' && c.method === 'POST');
      const parsed = JSON.parse(post!.body ?? '{}') as { secret?: string; secret_ref?: string };
      expect(parsed.secret).toBe('plain-signing-token');
      expect(parsed.secret_ref).toBeUndefined();
    });
  });

  it('accept_plaintext выключен (422) → показывает pretty-error, форма не крашится', async () => {
    setupMock({ postStatus: 422, postDetail: 'plaintext secret ingestion disabled (enable secret_ingest.accept_plaintext ...)' });
    renderNotif();
    const { dialog, user } = await openCreate();

    await user.type(within(dialog).getByTestId('herald-name-input'), 'tg3');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'telegram' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByTestId('herald-type-select'), 'telegram');
    await user.click(within(dialog).getByTestId('herald-secret-bot_token-mode-value'));
    await user.type(within(dialog).getByTestId('herald-secret-bot_token-value'), 'plain');
    await user.type(within(dialog).getByTestId('herald-field-chat_id'), '777');
    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    const err = await within(dialog).findByTestId('herald-form-error');
    expect(err.textContent ?? '').toMatch(/Путь \(Vault\)/);
    expect(dialog).toBeInTheDocument();
  });
});
