import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  it('typed form for core.beacon.file_changed → POST /v1/vigils → redirect to detail', async () => {
    const postSpy = vi.fn();
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/vigils',
        status: 201,
        body: {
          id: 'config-changed',
          check: 'core.beacon.file_changed',
          interval: '15s',
          params: { path: '/etc/redis.conf', recursive: false },
          enabled: true,
          subject: { sid: ['host01.example.com'] },
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
        },
      },
      {
        method: 'GET',
        url: '/v1/vigils/config-changed',
        body: {
          id: 'config-changed',
          check: 'core.beacon.file_changed',
          interval: '15s',
          params: { path: '/etc/redis.conf', recursive: false },
          enabled: true,
          subject: { sid: ['host01.example.com'] },
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
    await user.type(screen.getByLabelText(/^ID/), 'config-changed');
    await user.clear(screen.getByLabelText(/Interval/i));
    await user.type(screen.getByLabelText(/Interval/i), '15s');
    // typed mode is already selected by default -- fill in path.
    await user.type(screen.getByLabelText(/^path$/i), '/etc/redis.conf');
    // subject: the sid dimension is the default. The chips container carries
    // the test id; the input is nested inside it.
    const sidChips = screen.getByTestId('subject-sid');
    await user.type(sidChips.querySelector('input') as HTMLInputElement, 'host01.example.com ');

    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalled();
    });
    const payload = postSpy.mock.calls[0][0];
    expect(payload.id).toBe('config-changed');
    expect(payload.check).toBe('core.beacon.file_changed');
    expect(payload.interval).toBe('15s');
    expect(payload.params).toEqual({ path: '/etc/redis.conf', recursive: false });
    expect(payload.enabled).toBe(true);
    expect(payload.subject).toEqual({ sid: ['host01.example.com'] });
  });

  it('a subject is required: submitting with an empty one sends nothing', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if ((init?.method ?? 'GET') === 'POST' && url.startsWith('/v1/vigils')) postSpy();
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/vigils/new" element={<VigilNewForm />} />
      </Routes>,
      '/vigils/new',
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^ID/), 'config-changed');
    await user.type(screen.getByLabelText(/^path$/i), '/etc/redis.conf');
    // every other field is valid; the subject is left empty on purpose.
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least one SID is required/i)).toBeInTheDocument();
    });
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('every dimension is offered, and each one builds its own subject', async () => {
    const postSpy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if ((init?.method ?? 'GET') === 'POST' && url.startsWith('/v1/vigils')) {
        postSpy(JSON.parse(String(init?.body ?? '{}')));
      }
      return new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } });
    }));

    renderWithProviders(
      <Routes>
        <Route path="/vigils/new" element={<VigilNewForm />} />
      </Routes>,
      '/vigils/new',
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^ID/), 'config-changed');
    await user.type(screen.getByLabelText(/^path$/i), '/etc/redis.conf');
    const picker = screen.getByLabelText('dimension');
    expect([...picker.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual([
      'sid', 'incarnation', 'coven', 'trait',
    ]);

    await user.selectOptions(picker, 'incarnation');
    await user.type(screen.getByLabelText('service'), 'redis');
    await user.type(screen.getByLabelText('name'), 'redis-prod');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0][0].subject).toEqual({
      incarnation: { service: 'redis', name: 'redis-prod' },
    });

    await user.selectOptions(picker, 'coven');
    const covenChips = screen.getByTestId('subject-coven');
    await user.type(covenChips.querySelector('input') as HTMLInputElement, 'prod ');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(2));
    expect(postSpy.mock.calls[1][0].subject).toEqual({ coven: ['prod'] });

    await user.selectOptions(picker, 'trait');
    await user.type(screen.getByLabelText('key'), 'owner');
    await user.type(screen.getByLabelText('value'), 'dba');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(3));
    expect(postSpy.mock.calls[2][0].subject).toEqual({ trait: { key: 'owner', value: 'dba' } });
  });

  it('validation: empty id blocks submit (no 422 sent)', async () => {
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
    // submit without filling in the id
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));
    // Inline error must appear, fetch must NOT be called
    await waitFor(() => {
      expect(screen.getByText('id is required')).toBeInTheDocument();
    });
    expect(postSpy).not.toHaveBeenCalled();
  });
});
