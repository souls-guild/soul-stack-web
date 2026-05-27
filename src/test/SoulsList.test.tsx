import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { SoulsList } from '../pages/souls/SoulsList';
import {
  applyFilter,
  evalRule,
  parseSoulprintFilter,
} from '../pages/souls/soulprintFilter';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('SoulsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит список Souls из /v1/souls', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            {
              sid: 'host01.example.com',
              transport: 'agent',
              status: 'connected',
              covens: ['prod', 'redis-prod'],
              last_seen_at: new Date(Date.now() - 30_000).toISOString(),
              last_seen_by_kid: 'keeper-01',
              registered_at: '2026-05-01T00:00:00Z',
            },
          ],
          offset: 0,
          limit: 200,
          total: 1,
        },
      },
    ]);
    renderWithProviders(<SoulsList />, '/souls');
    expect(screen.getByRole('heading', { name: /Souls/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('host01.example.com')).toBeInTheDocument();
    });
    // 'connected' встречается и в <option> select-фильтра, и в Badge —
    // поэтому матчим все вхождения и убеждаемся, что Badge отрендерился.
    expect(screen.getAllByText('connected').length).toBeGreaterThanOrEqual(2);
  });

  it('soulprint-filter: lazy fetch + client-side фильтрация по фактам', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/souls/host-debian.local/soulprint',
        body: {
          sid: 'host-debian.local',
          typed_facts: {
            sid: 'host-debian.local',
            hostname: 'host-debian',
            os: { family: 'debian', distro: 'ubuntu', version: '22.04', pkg_mgr: 'apt' },
            memory: { total_mb: 8192 },
          },
        },
      },
      {
        method: 'GET',
        url: '/v1/souls/host-alpine.local/soulprint',
        body: {
          sid: 'host-alpine.local',
          typed_facts: {
            sid: 'host-alpine.local',
            hostname: 'host-alpine',
            os: { family: 'alpine', distro: 'alpine', version: '3.19', pkg_mgr: 'apk' },
            memory: { total_mb: 2048 },
          },
        },
      },
      {
        method: 'GET',
        url: '/v1/souls',
        body: {
          items: [
            {
              sid: 'host-debian.local',
              transport: 'agent',
              status: 'connected',
              covens: ['prod'],
              registered_at: '2026-05-01T00:00:00Z',
            },
            {
              sid: 'host-alpine.local',
              transport: 'agent',
              status: 'connected',
              covens: ['prod'],
              registered_at: '2026-05-01T00:00:00Z',
            },
          ],
          offset: 0,
          limit: 200,
          total: 2,
        },
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<SoulsList />, '/souls');
    await waitFor(() => {
      expect(screen.getByText('host-debian.local')).toBeInTheDocument();
      expect(screen.getByText('host-alpine.local')).toBeInTheDocument();
    });

    const input = screen.getByLabelText('search soulprint');
    await user.type(input, 'os.family=debian');

    await waitFor(() => {
      expect(screen.queryByText('host-alpine.local')).not.toBeInTheDocument();
    });
    expect(screen.getByText('host-debian.local')).toBeInTheDocument();
    expect(screen.getByText(/Matched 1 of 2/)).toBeInTheDocument();
  });
});

describe('soulprintFilter — parse', () => {
  it('одно простое правило', () => {
    const r = parseSoulprintFilter('os.family=debian');
    expect(r.invalid).toEqual([]);
    expect(r.rules).toEqual([{ path: 'os.family', op: '=', value: 'debian' }]);
  });

  it('compound AND через пробел и &', () => {
    const r = parseSoulprintFilter('os.family=debian & memory.total_mb>=4096');
    expect(r.invalid).toEqual([]);
    expect(r.rules).toEqual([
      { path: 'os.family', op: '=', value: 'debian' },
      { path: 'memory.total_mb', op: '>=', value: 4096 },
    ]);
  });

  it('wildcard в значении сохраняется как строка', () => {
    const r = parseSoulprintFilter('kernel.version=6.*');
    expect(r.rules).toEqual([{ path: 'kernel.version', op: '=', value: '6.*' }]);
  });

  it('невалидный токен попадает в invalid', () => {
    const r = parseSoulprintFilter('garbage');
    expect(r.rules).toEqual([]);
    expect(r.invalid).toEqual(['garbage']);
  });

  it('!= оператор', () => {
    const r = parseSoulprintFilter('os.distro!=ubuntu');
    expect(r.rules).toEqual([{ path: 'os.distro', op: '!=', value: 'ubuntu' }]);
  });
});

describe('soulprintFilter — eval', () => {
  const sp = {
    os: { family: 'debian', distro: 'ubuntu', pkg_mgr: 'apt' },
    kernel: { version: '6.1.0-26-generic', release: '6.1.0' },
    memory: { total_mb: 8192 },
    network: { primary_ip: '10.0.0.5' },
  };

  it('= по строке матчит', () => {
    expect(evalRule(sp, { path: 'os.family', op: '=', value: 'debian' })).toBe(true);
    expect(evalRule(sp, { path: 'os.family', op: '=', value: 'rhel' })).toBe(false);
  });

  it('wildcard 6.* матчит 6.1.0-26-generic', () => {
    expect(evalRule(sp, { path: 'kernel.version', op: '=', value: '6.*' })).toBe(true);
    expect(evalRule(sp, { path: 'kernel.version', op: '=', value: '5.*' })).toBe(false);
  });

  it('integer compare >=', () => {
    expect(evalRule(sp, { path: 'memory.total_mb', op: '>=', value: 4096 })).toBe(true);
    expect(evalRule(sp, { path: 'memory.total_mb', op: '>=', value: 16384 })).toBe(false);
  });

  it('network.primary_ip wildcard', () => {
    expect(evalRule(sp, { path: 'network.primary_ip', op: '=', value: '10.0.*' })).toBe(true);
    expect(evalRule(sp, { path: 'network.primary_ip', op: '=', value: '192.168.*' })).toBe(false);
  });

  it('неизвестный путь → false (хост исключается)', () => {
    expect(evalRule(sp, { path: 'os.codename', op: '=', value: 'jammy' })).toBe(false);
  });

  it('compound AND', () => {
    const ok = applyFilter(sp, [
      { path: 'os.family', op: '=', value: 'debian' },
      { path: 'memory.total_mb', op: '>=', value: 4096 },
    ]);
    expect(ok).toBe(true);
    const fail = applyFilter(sp, [
      { path: 'os.family', op: '=', value: 'debian' },
      { path: 'memory.total_mb', op: '>=', value: 16384 },
    ]);
    expect(fail).toBe(false);
  });

  it('пустой набор правил → всегда true', () => {
    expect(applyFilter(sp, [])).toBe(true);
  });
});
