import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { ArchonDetail } from '../pages/archons/ArchonDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

function withParamRoute() {
  return (
    <Routes>
      <Route path="/archons/:aid" element={<ArchonDetail />} />
    </Routes>
  );
}

describe('ArchonDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('рендерит профиль активного Архонта', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-alice',
        body: {
          aid: 'archon-alice',
          display_name: 'Alice Ops',
          auth_method: 'jwt',
          created_via: 'user',
          created_at: '2026-05-10T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: { team: 'platform' },
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('archon-bootstrap')).toBeInTheDocument();
    // Metadata JsonViewer.
    expect(screen.getByText(/platform/)).toBeInTheDocument();
    // created_via badge — устойчивый матч по data-testid
    expect(screen.getByTestId('created-via-archon-alice')).toHaveTextContent('user');
  });

  it('показывает revoked + bootstrap initial badges', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-bootstrap',
        body: {
          aid: 'archon-bootstrap',
          display_name: 'Bootstrap',
          auth_method: 'jwt',
          created_via: 'bootstrap',
          created_at: '2026-05-01T00:00:00Z',
          created_by_aid: null,
          revoked_at: '2026-05-20T00:00:00Z',
          bootstrap_initial: true,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-bootstrap');
    await waitFor(() => {
      expect(screen.getByText('revoked')).toBeInTheDocument();
    });
    // «bootstrap initial» — badge в шапке (Info-tab активен по умолчанию;
    // строка «Bootstrap initial» в meta — другой регистр).
    expect(screen.getAllByText(/bootstrap initial/i).length).toBeGreaterThanOrEqual(1);
    // empty metadata → placeholder.
    expect(screen.getByText(/metadata пустой/i)).toBeInTheDocument();
  });

  // ── Guard-тесты: created_via badge ────────────────────────────────────────

  it.each([
    ['oidc', 'archon-oidc'],
    ['system', 'archon-system'],
  ] as const)('created_via=%s отображается в Badge по data-testid', async (createdVia, aid) => {
    installFetchMock([
      {
        method: 'GET',
        url: `/v1/operators/${aid}`,
        body: {
          aid,
          display_name: `${createdVia} Archon`,
          auth_method: 'jwt',
          created_via: createdVia,
          created_at: '2026-06-01T00:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), `/archons/${aid}`);
    await waitFor(() => {
      expect(screen.getByTestId(`created-via-${aid}`)).toHaveTextContent(createdVia);
    });
  });

  it('created_via=null/undefined → показывает «—» в badge-ячейке', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-no-via',
        body: {
          aid: 'archon-no-via',
          display_name: 'No Via',
          auth_method: 'jwt',
          created_via: null,
          created_at: '2026-06-01T00:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-no-via');
    await waitFor(() => {
      expect(screen.getByTestId('created-via-archon-no-via')).toHaveTextContent('—');
    });
  });

  it('Revoke-кнопка отсутствует для уже-отозванного Архонта', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-old',
        body: {
          aid: 'archon-old',
          display_name: 'Old',
          auth_method: 'jwt',
          created_via: 'user',
          created_at: '2026-04-01T00:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: '2026-05-20T00:00:00Z',
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-old');
    await waitFor(() => {
      expect(screen.getByText('revoked')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^Revoke$/ })).not.toBeInTheDocument();
  });

  it('Revoke-flow: клик на Revoke → Modal → POST /v1/operators/archon-alice/revoke', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const detailBody = {
      aid: 'archon-alice',
      display_name: 'Alice',
      auth_method: 'jwt',
      created_via: 'user',
      created_at: '2026-05-10T10:00:00Z',
      created_by_aid: 'archon-bootstrap',
      revoked_at: null,
      bootstrap_initial: false,
      metadata: {},
    };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      if (url === '/v1/operators/archon-alice' && method === 'GET') {
        return new Response(JSON.stringify(detailBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/v1/operators/archon-alice/revoke' && method === 'POST') {
        return new Response('', { status: 204 });
      }
      return new Response('{}', { status: 599 });
    });

    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice/i })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('revoke-archon'));
    expect(await screen.findByRole('dialog', { name: /Отозвать archon-alice/i })).toBeInTheDocument();
    await user.click(screen.getByTestId('revoke-submit'));
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/v1/operators/archon-alice/revoke' && c.method === 'POST')).toBe(true);
    });
  });

  // ── Guard-тесты: назначение и снятие ролей ─────────────────────────────────

  // Базовые данные для role-тестов
  const ALICE_OP = {
    aid: 'archon-alice',
    display_name: 'Alice Ops',
    auth_method: 'jwt',
    created_via: 'user',
    created_at: '2026-05-10T10:00:00Z',
    created_by_aid: 'archon-bootstrap',
    revoked_at: null,
    bootstrap_initial: false,
    metadata: {},
  };

  const ROLES_WITH_ALICE = {
    items: [
      { name: 'cluster-admin', description: '', builtin: true, permissions: ['*'], operators: ['archon-alice'] },
      { name: 'soul-operator', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
    ],
  };

  const ROLES_NO_ALICE = {
    items: [
      { name: 'cluster-admin', description: '', builtin: true, permissions: ['*'], operators: [] },
      { name: 'soul-operator', description: '', builtin: false, permissions: ['soul.list'], operators: [] },
    ],
  };

  // Гибкий mock с записью вызовов для role-тестов
  function roleRecordingFetch(opts: {
    op: typeof ALICE_OP;
    roles: typeof ROLES_WITH_ALICE;
    grantStatus?: number;
    revokeStatus?: number;
    revokeType?: string;
    revokeDetail?: string;
  }): { calls: Array<{ url: string; method: string; body: string | null }> } {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, body });

      if (url.startsWith('/v1/operators/') && method === 'GET') {
        return new Response(JSON.stringify(opts.op), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify(opts.roles), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (/\/v1\/roles\/[^/]+\/operators$/.test(url) && method === 'POST') {
        const status = opts.grantStatus ?? 204;
        // jsdom не принимает пустое тело для 204, используем 200 с пустым телом в mock
        return new Response(null, { status });
      }
      if (/\/v1\/roles\/[^/]+\/operators\/[^/]+$/.test(url) && method === 'DELETE') {
        const status = opts.revokeStatus ?? 204;
        if (status !== 204) {
          return new Response(
            JSON.stringify({ type: opts.revokeType ?? 'about:blank', status, detail: opts.revokeDetail ?? 'error' }),
            { status, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 599 });
    });
    return { calls };
  }

  it('Guard: кнопка «Назначить роль» открывает AssignRoleModal с правильным aid', async () => {
    roleRecordingFetch({ op: ALICE_OP, roles: ROLES_WITH_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });

    const assignBtn = await screen.findByTestId('assign-role-btn');
    const user = userEvent.setup();
    await user.click(assignBtn);

    // Модалка открылась с aid текущего архонта
    const dialog = await screen.findByRole('dialog', { name: /Назначить роль: archon-alice/i });
    expect(dialog).toBeInTheDocument();
  });

  it('Guard: успешное назначение роли вызывает POST /v1/roles/{name}/operators и закрывает модалку', async () => {
    const { calls } = roleRecordingFetch({ op: ALICE_OP, roles: ROLES_NO_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    const user = userEvent.setup();
    const assignBtn = await screen.findByTestId('assign-role-btn');
    await user.click(assignBtn);

    const dialog = await screen.findByRole('dialog', { name: /Назначить роль: archon-alice/i });
    await user.selectOptions(dialog.querySelector('select')!, 'soul-operator');
    await user.click(screen.getByRole('button', { name: /^Назначить$/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/roles/soul-operator/operators');
      expect(post).toBeDefined();
      expect(post!.body).toContain('archon-alice');
    });
    // После успеха модалка закрывается (invalidateQueries отработал)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Назначить роль/i })).not.toBeInTheDocument();
    });
  });

  it('Guard: кнопка «×» рядом с ролью вызывает revokeOperator(role, aid) + рефетч', async () => {
    // window.confirm автоматически подтверждаем
    vi.stubGlobal('confirm', () => true);
    const { calls } = roleRecordingFetch({ op: ALICE_OP, roles: ROLES_WITH_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    // Ждём появления чипа с ролью
    const revokeBtn = await screen.findByRole('button', { name: /снять роль cluster-admin/i });
    const user = userEvent.setup();
    await user.click(revokeBtn);

    await waitFor(() => {
      const del = calls.find(
        (c) => c.method === 'DELETE' && c.url === '/v1/roles/cluster-admin/operators/archon-alice',
      );
      expect(del).toBeDefined();
    });
    // Ошибки нет — inline-error не показывается
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Guard: 409 lockout → inline-ошибка видна, роль НЕ исчезает из списка', async () => {
    vi.stubGlobal('confirm', () => true);
    roleRecordingFetch({
      op: ALICE_OP,
      roles: ROLES_WITH_ALICE,
      revokeStatus: 409,
      revokeType: 'https://soul-stack.io/errors/would-lock-out-cluster',
      revokeDetail: 'last cluster-admin cannot be removed',
    });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    const revokeBtn = await screen.findByRole('button', { name: /снять роль cluster-admin/i });
    const user = userEvent.setup();
    await user.click(revokeBtn);

    // Inline-ошибка появляется
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/lock-?out|self-lockout|admin/i);

    // Роль всё ещё в DOM (не пропала)
    expect(screen.getByRole('button', { name: /снять роль cluster-admin/i })).toBeInTheDocument();
  });

  it('Guard: 403 при снятии роли → понятное сообщение об ошибке', async () => {
    vi.stubGlobal('confirm', () => true);
    roleRecordingFetch({
      op: ALICE_OP,
      roles: ROLES_WITH_ALICE,
      revokeStatus: 403,
      revokeDetail: 'forbidden',
    });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    const revokeBtn = await screen.findByRole('button', { name: /снять роль cluster-admin/i });
    const user = userEvent.setup();
    await user.click(revokeBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/недостаточно прав|forbidden/i);
  });

  it('Activity-tab показывает link на /audit?archon_aid=<aid>', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-alice',
        body: {
          aid: 'archon-alice',
          display_name: 'Alice',
          auth_method: 'jwt',
          created_via: 'user',
          created_at: '2026-05-10T10:00:00Z',
          created_by_aid: 'archon-bootstrap',
          revoked_at: null,
          bootstrap_initial: false,
          metadata: {},
        },
      },
    ]);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice/i })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Activity/i }));
    const link = screen.getByRole('link', { name: /Открыть Audit/i });
    expect(link).toHaveAttribute('href', '/audit?archon_aid=archon-alice');
  });

  // ── Guard-тесты: секция Синодов ─────────────────────────────────────────────

  const SYNODS_WITH_ALICE = {
    items: [
      { name: 'ops-team', description: 'Ops group', builtin: false, roles: ['soul-operator'], operators: ['archon-alice'] },
      { name: 'admins', description: '', builtin: true, roles: ['cluster-admin'], operators: ['archon-alice', 'archon-bob'] },
      { name: 'dev-team', description: '', builtin: false, roles: [], operators: ['archon-bob'] },
    ],
  };

  const SYNODS_NO_ALICE = {
    items: [
      { name: 'ops-team', description: '', builtin: false, roles: [], operators: ['archon-bob'] },
      { name: 'dev-team', description: '', builtin: false, roles: [], operators: [] },
    ],
  };

  function synodFetch(op: typeof ALICE_OP, synods: typeof SYNODS_WITH_ALICE) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.startsWith('/v1/operators/') && method === 'GET') {
        return new Response(JSON.stringify(op), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/v1/roles') && method === 'GET') {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === '/v1/synods' && method === 'GET') {
        return new Response(JSON.stringify(synods), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 599 });
    });
  }

  it('Guard: синоды-члены отображаются в секции, не-члены не показываются', async () => {
    synodFetch(ALICE_OP, SYNODS_WITH_ALICE);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });

    // Секция синодов видна
    const section = await screen.findByRole('region', { name: /synods/i });
    expect(section).toBeInTheDocument();

    // archon-alice — член ops-team и admins
    expect(await screen.findByRole('link', { name: /ops-team/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /admins/i })).toBeInTheDocument();

    // dev-team — alice не член, не должен быть
    expect(screen.queryByRole('link', { name: /dev-team/i })).not.toBeInTheDocument();
  });

  it('Guard: ссылки на синоды ведут на /synods/:name', async () => {
    synodFetch(ALICE_OP, SYNODS_WITH_ALICE);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    const link = await screen.findByRole('link', { name: /ops-team/i });
    expect(link).toHaveAttribute('href', '/synods/ops-team');
  });

  it('Guard: empty-state если архонт не в ни одной группе', async () => {
    synodFetch(ALICE_OP, SYNODS_NO_ALICE);
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument();
    });

    // Ждём пока загрузка синодов завершится и появится empty-state
    await waitFor(() => {
      expect(screen.getByText(/не состоит ни в одной группе/i)).toBeInTheDocument();
    });
    // Никаких ссылок на синоды нет
    expect(screen.queryByRole('link', { name: /ops-team/i })).not.toBeInTheDocument();
  });

  // ── Guard-тесты: ссылки на роли ─────────────────────────────────────────────

  it('[LINKS] роли архонта рендерятся ссылками на /rbac', async () => {
    roleRecordingFetch({ op: ALICE_OP, roles: ROLES_WITH_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    // Ждём появления секции ролей — archon-alice состоит в cluster-admin
    const link = await screen.findByRole('link', { name: 'cluster-admin' });
    expect(link).toHaveAttribute('href', '/rbac');
  });

  it('[LINKS] при отсутствии ролей ссылок в секции ролей нет', async () => {
    roleRecordingFetch({ op: ALICE_OP, roles: ROLES_NO_ALICE });
    renderWithProviders(withParamRoute(), '/archons/archon-alice');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Alice Ops/i })).toBeInTheDocument());

    // Дожидаемся загрузки ролей (секция перестанет быть loading)
    await waitFor(() => {
      const section = screen.getByRole('region', { name: /^roles$/i });
      expect(section).not.toHaveTextContent(/Загрузка/i);
    });

    // Ни одна из ролей не назначена alice — ссылок на /rbac нет
    const rbacLinks = screen.queryAllByRole('link', { name: /cluster-admin|soul-operator/i });
    expect(rbacLinks).toHaveLength(0);
  });
});
