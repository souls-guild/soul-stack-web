import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RegisterServiceModal } from '../pages/services/RegisterServiceModal';
import { tokenStore } from '../api/tokenStore';

interface Captured {
  method: string;
  url: string;
  body: unknown;
}

// fetch-mock capturing the request body (standard installFetchMock doesn't record the body).
function installCapturingMock(status: number, responseBody: unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, url, body });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
  return calls;
}

describe('RegisterServiceModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });
  it('valid form sends POST /v1/services with the correct body', async () => {
    const calls = installCapturingMock(201, {
      id: 'redis',
      git: 'https://git.example.com/service-redis.git',
      ref: 'main',
      created_at: '2026-05-28T00:00:00Z',
      updated_at: '2026-05-28T00:00:00Z',
    });
    const onClose = vi.fn();
    renderWithProviders(<RegisterServiceModal open onClose={onClose} />, '/services');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('redis'), 'redis');
    await user.type(
      screen.getByPlaceholderText(/git\.example\.com\/service-redis/i),
      'https://git.example.com/service-redis.git',
    );
    // ref already = 'main' via defaultValues.

    const submit = screen.getByRole('button', { name: /^Register$/ });
    await waitFor(() => expect(submit).not.toBeDisabled());
    await user.click(submit);

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/v1/services'));
      expect(post).toBeTruthy();
      // The create body carries no label: the keeper accepts the field there and
      // drops it, so the caption goes out on PUT /v1/services/{id}/label instead.
      expect(post!.body).toEqual({
        id: 'redis',
        git: 'https://git.example.com/service-redis.git',
        ref: 'main',
      });
    });

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url === '/v1/services/redis/label');
      expect(put).toBeTruthy();
      // The operator typed the id, so it kept what they typed; the caption was
      // left alone and therefore followed the git path.
      expect(put!.body).toEqual({ label: 'Service-redis' });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('blocks submit on invalid name (not kebab-case)', async () => {
    installCapturingMock(201, {});
    renderWithProviders(<RegisterServiceModal open onClose={vi.fn()} />, '/services');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('redis'), 'Redis_Bad');
    await user.type(
      screen.getByPlaceholderText(/git\.example\.com\/service-redis/i),
      'https://git.example.com/service-redis.git',
    );

    expect(await screen.findByText(/kebab-case/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Register$/ })).toBeDisabled();
  });

  it('blocks submit on invalid git (not a git URL)', async () => {
    installCapturingMock(201, {});
    renderWithProviders(<RegisterServiceModal open onClose={vi.fn()} />, '/services');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('redis'), 'redis');
    await user.type(screen.getByPlaceholderText(/git\.example\.com\/service-redis/i), 'not-a-url');

    expect(await screen.findByText(/git URL/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Register$/ })).toBeDisabled();
  });

  it('file:// git is valid (dev file-repos are not blocked)', async () => {
    installCapturingMock(201, {});
    renderWithProviders(<RegisterServiceModal open onClose={vi.fn()} />, '/services');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('redis'), 'redis');
    await user.type(
      screen.getByPlaceholderText(/git\.example\.com\/service-redis/i),
      'file:///tmp/keeper-dev/repos/service-redis',
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Register$/ })).not.toBeDisabled(),
    );
  });

  it('409 already-exists → pretty-error, modal stays open', async () => {
    installCapturingMock(409, { title: 'conflict', detail: 'service-already-exists' });
    const onClose = vi.fn();
    renderWithProviders(<RegisterServiceModal open onClose={onClose} />, '/services');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('redis'), 'redis');
    await user.type(
      screen.getByPlaceholderText(/git\.example\.com\/service-redis/i),
      'https://git.example.com/service-redis.git',
    );
    const submit = screen.getByRole('button', { name: /^Register$/ });
    await waitFor(() => expect(submit).not.toBeDisabled());
    await user.click(submit);

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  // NIM-731: both identity fields are proposed from the git path. This is the
  // behaviour the ticket calls out as the one that breaks silently — a wrong
  // proposal accepted by reflex writes an immutable id.
  it('proposes id and label from the last segment of the git path', async () => {
    installCapturingMock(201, {});
    renderWithProviders(<RegisterServiceModal open onClose={vi.fn()} />, '/services');
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText(/git\.example\.com\/service-redis/i),
      'https://git.example.com/wb/service/redis.git',
    );

    await waitFor(() => expect(screen.getByPlaceholderText('redis')).toHaveValue('redis'));
    expect(screen.getByPlaceholderText('Redis')).toHaveValue('Redis');
  });

  it('a hand-edited id stops following the git path', async () => {
    installCapturingMock(201, {});
    renderWithProviders(<RegisterServiceModal open onClose={vi.fn()} />, '/services');
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText(/git\.example\.com\/service-redis/i),
      'https://git.example.com/wb/service/redis.git',
    );
    await waitFor(() => expect(screen.getByPlaceholderText('redis')).toHaveValue('redis'));

    await user.clear(screen.getByPlaceholderText('redis'));
    await user.type(screen.getByPlaceholderText('redis'), 'cache');
    // Extending the path must not overwrite what the operator chose.
    await user.type(screen.getByPlaceholderText(/git\.example\.com\/service-redis/i), 'x');

    expect(screen.getByPlaceholderText('redis')).toHaveValue('cache');
  });
});
