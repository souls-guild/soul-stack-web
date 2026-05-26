import { describe, it, expect, beforeEach } from 'vitest';
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

  it('Activity-tab показывает link на /audit?archon_aid=<aid>', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/operators/archon-alice',
        body: {
          aid: 'archon-alice',
          display_name: 'Alice',
          auth_method: 'jwt',
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
});
