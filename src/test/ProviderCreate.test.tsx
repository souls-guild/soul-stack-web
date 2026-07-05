/**
 * Provider create dual-mode credentials (ADR-064, NIM-11):
 *   1. credentials в режиме «значение» (KV) → POST несёт credentials-объект, без credentials_ref.
 *   2. credentials в режиме «путь» (default) → POST несёт credentials_ref, без credentials.
 *   3. submit disabled, пока не заполнены name/type/region + credentials (заполни ровно одно).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { ProvidersList } from '../pages/providers/ProvidersList';
import { tokenStore } from '../api/tokenStore';

const EMPTY = { items: [], offset: 0, limit: 200, total: 0 };

function setupMock() {
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });
    if (url.startsWith('/v1/me/permissions')) {
      return new Response(JSON.stringify({ permissions: [{ wildcard: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('/v1/providers') && method === 'GET') {
      return new Response(JSON.stringify(EMPTY), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/v1/providers' && method === 'POST') {
      return new Response(JSON.stringify({
        name: 'aws-eu', type: 'community-aws', region: 'eu-central-1', credentials_ref: 'vault:secret/x',
        created_at: new Date().toISOString(),
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 599 });
  });
  return calls;
}

function renderList() {
  return renderWithProviders(
    <Routes><Route path="/providers" element={<ProvidersList />} /></Routes>,
    '/providers',
  );
}

async function openCreate() {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByTestId('provider-create-btn')).not.toBeDisabled());
  await user.click(screen.getByTestId('provider-create-btn'));
  const dialog = await screen.findByRole('dialog', { name: /Создать Cloud-Provider/i });
  return { dialog, user };
}

async function fillBase(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  await user.type(within(dialog).getByTestId('provider-name-input'), 'aws-eu');
  await user.type(within(dialog).getByTestId('provider-type-input'), 'community-aws');
  await user.type(within(dialog).getByTestId('provider-region-input'), 'eu-central-1');
}

beforeEach(() => { tokenStore.clear(); });

describe('Provider create dual-mode credentials (NIM-11)', () => {
  it('режим «значение» (KV) → POST несёт credentials-объект, без credentials_ref', async () => {
    const calls = setupMock();
    renderList();
    const { dialog, user } = await openCreate();

    await fillBase(dialog, user);
    await user.click(within(dialog).getByTestId('provider-credentials-mode-value'));
    const kv = within(dialog).getByTestId('provider-credentials-value');
    await user.type(kv, 'access_key: AKIA123{enter}secret_key: SEKRET');

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/providers' && c.method === 'POST');
      expect(post).toBeDefined();
      const parsed = JSON.parse(post!.body ?? '{}') as { credentials?: Record<string, unknown>; credentials_ref?: string };
      expect(parsed.credentials).toMatchObject({ access_key: 'AKIA123', secret_key: 'SEKRET' });
      expect(parsed.credentials_ref).toBeUndefined();
    });
  });

  it('режим «путь» (default) → POST несёт credentials_ref, без credentials', async () => {
    const calls = setupMock();
    renderList();
    const { dialog, user } = await openCreate();

    await fillBase(dialog, user);
    await user.type(within(dialog).getByTestId('provider-credentials-ref'), 'vault:secret/cloud/aws');

    await user.click(within(dialog).getByRole('button', { name: /Создать/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/v1/providers' && c.method === 'POST');
      const parsed = JSON.parse(post!.body ?? '{}') as { credentials?: Record<string, unknown>; credentials_ref?: string };
      expect(parsed.credentials_ref).toBe('vault:secret/cloud/aws');
      expect(parsed.credentials).toBeUndefined();
    });
  });

  it('submit disabled, пока не заполнены name/type/region + credentials', async () => {
    setupMock();
    renderList();
    const { dialog, user } = await openCreate();

    const submit = within(dialog).getByRole('button', { name: /Создать/i });
    expect(submit).toBeDisabled();

    await fillBase(dialog, user);
    // Без credentials — всё ещё disabled.
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByTestId('provider-credentials-ref'), 'vault:secret/x');
    await waitFor(() => expect(submit).not.toBeDisabled());
  });
});
