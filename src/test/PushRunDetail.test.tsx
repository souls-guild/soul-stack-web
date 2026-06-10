import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { PushRunDetail } from '../pages/pushRuns/PushRunDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const APPLY_ID = '01HZBB0000000000000000000P';

const SAMPLE_VIEW = {
  apply_id: APPLY_ID,
  inventory_sids: ['host01', 'host02'],
  destiny_ref: 'redis-cluster@v2.0.0',
  ssh_provider: 'default',
  input: { mode: 'normal' },
  cleanup_stale: false,
  status: 'partial_failed',
  started_at: '2026-05-27T12:00:00Z',
  finished_at: '2026-05-27T12:05:00Z',
  started_by_aid: 'archon-alice',
  summary: {
    hosts: [
      { sid: 'host01', status: 'success' },
      { sid: 'host02', status: 'failed', error_code: 'ssh_auth' },
    ],
    total: 2,
    success_count: 1,
    fail_count: 1,
  },
};

function renderAt(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/push-runs/:applyId" element={<PushRunDetail />} />
    </Routes>,
    path,
  );
}

describe('PushRunDetail', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит meta + per-host table', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/push/${APPLY_ID}`, body: SAMPLE_VIEW },
    ]);
    renderAt(`/push-runs/${APPLY_ID}`);
    await waitFor(() => {
      expect(screen.getByText('partial_failed')).toBeInTheDocument();
    });
    // destiny_ref + ssh_provider
    expect(screen.getByText('redis-cluster@v2.0.0')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    // per-host rows
    expect(screen.getByText('host01')).toBeInTheDocument();
    expect(screen.getByText('host02')).toBeInTheDocument();
    expect(screen.getByText('ssh_auth')).toBeInTheDocument();
  });

  // ── Guard-тесты: кликабельные ссылки ──────────────────────────────────────

  it('[LINKS] sid в per-host таблице — ссылка на /souls/:sid', async () => {
    installFetchMock([
      { method: 'GET', url: `/v1/push/${APPLY_ID}`, body: SAMPLE_VIEW },
    ]);
    renderAt(`/push-runs/${APPLY_ID}`);

    await waitFor(() => expect(screen.getByText('host01')).toBeInTheDocument());

    const linkHost01 = screen.getByRole('link', { name: 'host01' });
    expect(linkHost01).toHaveAttribute('href', '/souls/host01');

    const linkHost02 = screen.getByRole('link', { name: 'host02' });
    expect(linkHost02).toHaveAttribute('href', '/souls/host02');
  });

  it('[LINKS] при отсутствии summary hosts ссылок на souls нет', async () => {
    const viewNoHosts = { ...SAMPLE_VIEW, summary: null };
    installFetchMock([
      { method: 'GET', url: `/v1/push/${APPLY_ID}`, body: viewNoHosts },
    ]);
    renderAt(`/push-runs/${APPLY_ID}`);

    await waitFor(() => expect(screen.getByText('partial_failed')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /^host/ })).not.toBeInTheDocument();
  });
});
