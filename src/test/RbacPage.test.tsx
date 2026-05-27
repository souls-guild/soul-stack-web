import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RbacPage } from '../pages/rbac/RbacPage';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const SAMPLE = {
  items: [
    {
      name: 'cluster-admin',
      description: 'Полные права',
      builtin: true,
      permissions: ['*'],
      operators: ['archon-bootstrap', 'archon-alice'],
    },
    {
      name: 'soul-operator',
      description: 'Управление Soul-ами',
      builtin: false,
      permissions: ['soul.list', 'soul.read', 'soul.exec'],
      operators: ['archon-alice'],
    },
  ],
};

describe('RbacPage', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит список ролей из /v1/roles', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: SAMPLE }]);
    renderWithProviders(<RbacPage />, '/rbac');
    expect(screen.getByRole('heading', { name: /RBAC/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('cluster-admin')).toBeInTheDocument();
      expect(screen.getByText('soul-operator')).toBeInTheDocument();
    });
  });

  it('переключение на Role permissions показывает permission-чипы', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: SAMPLE }]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Role permissions/i }));
    await waitFor(() => {
      expect(screen.getByText('soul.list')).toBeInTheDocument();
      expect(screen.getByText('soul.exec')).toBeInTheDocument();
    });
  });

  it('Operator assignments сводит роли по AID', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: SAMPLE }]);
    renderWithProviders(<RbacPage />, '/rbac');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('cluster-admin')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: /Operator assignments/i }));
    await waitFor(() => {
      // archon-alice должен числиться в двух ролях.
      expect(screen.getByText('archon-alice')).toBeInTheDocument();
      expect(screen.getByText('archon-bootstrap')).toBeInTheDocument();
    });
  });

  it('empty-state при пустом ответе', async () => {
    installFetchMock([{ method: 'GET', url: '/v1/roles', body: { items: [] } }]);
    renderWithProviders(<RbacPage />, '/rbac');
    await waitFor(() => {
      expect(screen.getByText(/Ролей в кластере нет/i)).toBeInTheDocument();
    });
  });
});
