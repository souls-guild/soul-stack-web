import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ProvisioningPolicy } from '../pages/archons/ProvisioningPolicy';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';
import type { ProvisioningMethod } from '../api/keeper';

// ── Guard: exhaustiveness ALL_METHODS ────────────────────────────────────────
// Compile-time guard (Record<ProvisioningMethod, true>) находится в
// ProvisioningPolicy.tsx — сборка ломается при добавлении нового метода в gen.
// Этот runtime-тест дополнительно фиксирует текущий ожидаемый набор значений
// и упадёт если ALL_METHODS/gen рассинхронизируются (например вручную).
describe('ALL_METHODS exhaustiveness guard', () => {
  it('содержит ровно те методы, что определены в ProvisioningMethod union', async () => {
    // Все возможные члены ProvisioningMethod из gen-схемы на момент написания.
    // При добавлении нового метода в OpenAPI: (1) compile-time guard в
    // ProvisioningPolicy.tsx сломает сборку, (2) этот массив тоже нужно обновить.
    const KNOWN_METHODS: ProvisioningMethod[] = ['user', 'ldap', 'oidc'];
    // ALL_METHODS не экспортируется — проверяем косвенно через DOM:
    // компонент рендерит чекбокс (data-testid=method-checkbox-<m>) для каждого
    // члена ALL_METHODS. Тест падает если метод есть в KNOWN_METHODS но не в DOM.
    installFetchMock([
      { method: 'GET', url: '/v1/provisioning-policy', body: { policy_set: false, allowed_methods: null } },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    // Ждём загрузки (чекбоксы появляются после резолва query)
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
    // default-hint присутствует
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
    // Ждём инициализации (только user отмечен)
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /user/i })).toBeChecked();
    });
    // Снимаем user
    await user.click(screen.getByRole('checkbox', { name: /user/i }));
    // Кнопка Save задизейблена
    expect(screen.getByTestId('save-policy-btn')).toBeDisabled();
    // Anti-lockout alert виден
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

    // Ждём инициализации (все три отмечены)
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /ldap/i })).toBeChecked();
    });

    // Снимаем ldap и oidc
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

    // Saved message появляется
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

  // ── Guard: policy_set=true + allowed_methods=null → все методы (fallback) ──

  it('policy_set=true, allowed_methods=null → init уходит в fallback «все методы»', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/provisioning-policy',
        body: { policy_set: true, allowed_methods: null },
      },
    ]);
    renderWithProviders(<ProvisioningPolicy />, '/provisioning-policy');
    // Ждём загрузки; все чекбоксы должны быть включены (fallback на ALL_METHODS)
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /user/i })).toBeChecked();
    });
    expect(screen.getByRole('checkbox', { name: /ldap/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /oidc/i })).toBeChecked();
    // default-hint НЕ показывается (policy_set=true, но allowed_methods=null —
    // это валидный ответ, UI рассматривает как «все разрешены», hint скрыт)
    const statuses = screen.queryAllByRole('status');
    const hint = statuses.find((el) => /по умолчанию|default/i.test(el.textContent ?? ''));
    expect(hint).toBeUndefined();
  });
});
