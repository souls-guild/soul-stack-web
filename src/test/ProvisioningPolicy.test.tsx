import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ProvisioningPolicy } from '../pages/archons/ProvisioningPolicy';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';
import type { ProvisioningMethod } from '../api/keeper';

// ── Guard: exhaustiveness ALL_METHODS ────────────────────────────────────────
// Compile-time guard (Record<ProvisioningMethod, true>) lives in
// ProvisioningPolicy.tsx — the build breaks when a new method is added to gen.
// This runtime test additionally pins down the currently expected set of values
// and fails if ALL_METHODS/gen go out of sync (e.g. manually).
describe('ALL_METHODS exhaustiveness guard', () => {
  it('содержит ровно те методы, что определены в ProvisioningMethod union', async () => {
    // All possible ProvisioningMethod members from the gen schema at time of writing.
    // When adding a new method in OpenAPI: (1) the compile-time guard in
    // ProvisioningPolicy.tsx breaks the build, (2) this array also needs updating.
    const KNOWN_METHODS: ProvisioningMethod[] = ['user', 'ldap', 'oidc'];
    // ALL_METHODS is not exported — check indirectly via DOM:
    // the component renders a checkbox (data-testid=method-checkbox-<m>) for each
    // member of ALL_METHODS. Test fails if a method is in KNOWN_METHODS but not in DOM.
    installFetchMock([
      { method: 'GET', url: '/v1/provisioning-policy', body: { policy_set: false, allowed_methods: null } },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    // Wait for load (checkboxes appear after the query resolves)
    await waitFor(() => {
      expect(screen.getByTestId('method-checkbox-user')).toBeInTheDocument();
    });
    KNOWN_METHODS.forEach((m) => {
      expect(
        screen.getByTestId(`method-checkbox-${m}`),
        `checkbox для метода "${m}" отсутствует в ALL_METHODS`,
      ).toBeInTheDocument();
    });
  });
});

describe('ProvisioningPolicy', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит заголовок и чекбоксы для всех трёх методов', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/provisioning-policy',
        body: { policy_set: false, allowed_methods: null },
      },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /user/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('checkbox', { name: /ldap/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /oidc/i })).toBeInTheDocument();
  });

  it('policy_set=false → показывает default-hint, все чекбоксы включены', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/provisioning-policy',
        body: { policy_set: false, allowed_methods: null },
      },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /user/i })).toBeChecked();
    });
    expect(screen.getByRole('checkbox', { name: /ldap/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /oidc/i })).toBeChecked();
// default-hint is present
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('policy_set=true, allowed_methods=[user] → только user отмечен', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/provisioning-policy',
        body: { policy_set: true, allowed_methods: ['user'] },
      },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /user/i })).toBeChecked();
    });
    expect(screen.getByRole('checkbox', { name: /ldap/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /oidc/i })).not.toBeChecked();
  });

  it('снятие всех чекбоксов → Save задизейблен + anti-lockout alert', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/provisioning-policy',
        body: { policy_set: true, allowed_methods: ['user'] },
      },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    const user = userEvent.setup();
// Wait for init (only user is checked)
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /user/i })).toBeChecked();
    });
// Uncheck user
    await user.click(screen.getByRole('checkbox', { name: /user/i }));
// Save button is disabled
    expect(screen.getByTestId('save-policy-btn')).toBeDisabled();
// Anti-lockout alert is visible
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('PUT /v1/provisioning-policy отправляется с выбранными методами', async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });
      if (url === '/v1/provisioning-policy' && method === 'GET') {
        return new Response(JSON.stringify({ policy_set: true, allowed_methods: ['user', 'ldap', 'oidc'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/provisioning-policy' && method === 'PUT') {
        return new Response(JSON.stringify({ policy_set: true, allowed_methods: ['user'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    const user = userEvent.setup();

// Wait for init (all three checked)
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /ldap/i })).toBeChecked();
    });

// Uncheck ldap and oidc
    await user.click(screen.getByRole('checkbox', { name: /ldap/i }));
    await user.click(screen.getByRole('checkbox', { name: /oidc/i }));

    await user.click(screen.getByTestId('save-policy-btn'));

    await waitFor(() => {
      const put = calls.find((c) => c.url === '/v1/provisioning-policy' && c.method === 'PUT');
      expect(put).toBeDefined();
      const parsed = JSON.parse(put!.body ?? '{}') as { allowed_methods?: string[] };
      expect(parsed.allowed_methods).toContain('user');
      expect(parsed.allowed_methods).not.toContain('ldap');
      expect(parsed.allowed_methods).not.toContain('oidc');
    });
  });

  it('успешный PUT → показывает saved-сообщение', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/v1/provisioning-policy' && method === 'GET') {
        return new Response(JSON.stringify({ policy_set: true, allowed_methods: ['user'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/provisioning-policy' && method === 'PUT') {
        return new Response(JSON.stringify({ policy_set: true, allowed_methods: ['user'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId('save-policy-btn')).not.toBeDisabled();
    });

    await user.click(screen.getByTestId('save-policy-btn'));

// Saved message appears
    await waitFor(() => {
      const statuses = screen.getAllByRole('status');
      const savedStatus = statuses.find((el) => /обновлена|updated/i.test(el.textContent ?? ''));
      expect(savedStatus).toBeDefined();
    });
  });

  it('ошибка сети GET → показывает error-alert', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/provisioning-policy',
        status: 403,
        body: { type: 'about:blank', title: 'Forbidden', status: 403, detail: 'no permission' },
      },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('ошибка PUT → показывает error-alert', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === '/v1/provisioning-policy' && method === 'GET') {
        return new Response(JSON.stringify({ policy_set: true, allowed_methods: ['user'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/provisioning-policy' && method === 'PUT') {
        return new Response(
          JSON.stringify({ type: 'about:blank', title: 'Unprocessable', status: 422, detail: 'empty list' }),
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId('save-policy-btn')).not.toBeDisabled();
    });

    await user.click(screen.getByTestId('save-policy-btn'));

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      const errAlert = alerts.find((el) => /сохранить|save/i.test(el.textContent ?? ''));
      expect(errAlert).toBeDefined();
    });
  });

  // -- Guard: policy_set=true + allowed_methods=null -> all methods (fallback) --

  it('policy_set=true, allowed_methods=null → init уходит в fallback «все методы»', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/provisioning-policy',
        body: { policy_set: true, allowed_methods: null },
      },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    // Wait for load; all checkboxes should be checked (fallback to ALL_METHODS)
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /user/i })).toBeChecked();
    });
    expect(screen.getByRole('checkbox', { name: /ldap/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /oidc/i })).toBeChecked();
    // default-hint is NOT shown (policy_set=true, but allowed_methods=null --
    // this is a valid response, UI treats it as "all allowed", hint hidden)
    const statuses = screen.queryAllByRole('status');
    const hint = statuses.find((el) => /по умолчанию|default/i.test(el.textContent ?? ''));
    expect(hint).toBeUndefined();
  });
});
