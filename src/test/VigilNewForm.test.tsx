import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { VigilNewForm } from '../pages/beacons/VigilNewForm';
import { VigilDetail } from '../pages/beacons/VigilDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('VigilNewForm', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('typed-форма для core.beacon.file_changed → POST /v1/vigils → redirect на detail', async () => {
    const postSpy = vi.fn();
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/vigils',
        status: 201,
        body: {
          name: 'config-changed',
          check: 'core.beacon.file_changed',
          interval: '15s',
          params: { path: '/etc/redis.conf', recursive: false },
          enabled: true,
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
        },
      },
      {
        method: 'GET',
        url: '/v1/vigils/config-changed',
        body: {
          name: 'config-changed',
          check: 'core.beacon.file_changed',
          interval: '15s',
          params: { path: '/etc/redis.conf', recursive: false },
          enabled: true,
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
        },
      },
    ]);
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if ((init?.method ?? 'GET') === 'POST' && url.startsWith('/v1/vigils')) {
        postSpy(JSON.parse(String(init?.body ?? '{}')));
      }
      return baseFetch(input, init);
    }));

    renderWithProviders(
      <Routes>
        <Route path="/vigils/new" element={<VigilNewForm />} />
        <Route path="/vigils/:name" element={<VigilDetail />} />
      </Routes>,
      '/vigils/new',
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Name \(kebab-case\)/i), 'config-changed');
    await user.clear(screen.getByLabelText(/Interval/i));
    await user.type(screen.getByLabelText(/Interval/i), '15s');
    // typed-режим уже выбран по дефолту — заполняем path.
    await user.type(screen.getByLabelText(/^path$/i), '/etc/redis.conf');

    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalled();
    });
    const payload = postSpy.mock.calls[0][0];
    expect(payload.name).toBe('config-changed');
    expect(payload.check).toBe('core.beacon.file_changed');
    expect(payload.interval).toBe('15s');
    expect(payload.params).toEqual({ path: '/etc/redis.conf', recursive: false });
    expect(payload.enabled).toBe(true);
  });

  it('валидация: пустое имя блокирует submit (422 не отправляется)', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if ((init?.method ?? 'GET') === 'POST' && url.startsWith('/v1/vigils')) {
        postSpy();
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/vigils/new" element={<VigilNewForm />} />
      </Routes>,
      '/vigils/new',
    );

    const user = userEvent.setup();
    // submit без заполнения name
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));
    // Должен показаться error inline, fetch НЕ должен быть вызван
    await waitFor(() => {
      expect(screen.getByText(/имя обязательно/i)).toBeInTheDocument();
    });
    expect(postSpy).not.toHaveBeenCalled();
  });
});
