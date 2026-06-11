import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from './renderWithProviders';
import { DecreeNewForm } from '../pages/beacons/DecreeNewForm';
import { DecreeDetail } from '../pages/beacons/DecreeDetail';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

const EMPTY_VIGILS = { items: [], offset: 0, limit: 200, total: 0 };
const EMPTY_INCS = { items: [], offset: 0, limit: 200, total: 0 };

describe('DecreeNewForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    tokenStore.clear();
  });

  it('default-deny: чекбокс enabled выключен по умолчанию', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/vigils', body: EMPTY_VIGILS },
      { method: 'GET', url: '/v1/incarnations', body: EMPTY_INCS },
    ]);
    renderWithProviders(<DecreeNewForm />, '/decrees/new');
    const enabled = await screen.findByLabelText(/Enabled \(default-deny\)/i);
    expect((enabled as HTMLInputElement).checked).toBe(false);
  });

  it('POST с минимальными полями → redirect на detail', async () => {
    const created = {
      name: 'restart-on-config',
      on_beacon: 'redis-config-changed',
      incarnation_name: 'redis-prod',
      action_scenario: 'restart',
      action_input: {},
      cooldown: '',
      enabled: false,
      created_at: '2026-05-27T00:00:00Z',
      updated_at: '2026-05-27T00:00:00Z',
    };
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input.toString();
      if (method === 'POST' && url.startsWith('/v1/decrees')) {
        postSpy(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.startsWith('/v1/decrees/restart-on-config')) {
        return new Response(JSON.stringify(created), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.startsWith('/v1/vigils')) {
        return new Response(JSON.stringify(EMPTY_VIGILS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.startsWith('/v1/incarnations')) {
        return new Response(JSON.stringify(EMPTY_INCS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/decrees/new" element={<DecreeNewForm />} />
        <Route path="/decrees/:name" element={<DecreeDetail />} />
      </Routes>,
      '/decrees/new',
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Name \(kebab-case\)/i), 'restart-on-config');
    await user.type(screen.getByLabelText(/on_beacon/i), 'redis-config-changed');
    await user.type(screen.getByLabelText(/^Incarnation$/i), 'redis-prod');
    await user.type(screen.getByLabelText(/action_scenario/i), 'restart');

    await user.click(screen.getByRole('button', { name: /Create Decree/i }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalled();
    });
    const payload = postSpy.mock.calls[0][0];
    expect(payload.name).toBe('restart-on-config');
    expect(payload.on_beacon).toBe('redis-config-changed');
    expect(payload.incarnation_name).toBe('redis-prod');
    expect(payload.action_scenario).toBe('restart');
    expect(payload.enabled).toBe(false);
  });
});
