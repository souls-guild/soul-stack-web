import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RegisterServiceModal } from '../pages/services/RegisterServiceModal';
import { canonicalJson } from '../api/canonicalJson';
import { tokenStore } from '../api/tokenStore';

// The keeper accepts `label` in a create request and drops it (NIM-817), so every
// create form writes the caption afterwards through PUT /{id}/label. That makes a
// second request that can fail on its own — and the entity already exists when it
// does. These guard the two ways that goes wrong.

function stub(labelStatus: number) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : '' });
    if (method === 'POST' && url === '/v1/services') {
      return new Response(JSON.stringify({ id: 'redis', git: 'x', ref: 'main', created_at: '', updated_at: '' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'PUT' && url.endsWith('/label')) {
      return new Response(JSON.stringify({ title: 'forbidden', detail: 'needs service.label-set' }), {
        status: labelStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return calls;
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(
    screen.getByPlaceholderText(/git\.example\.com\/service-redis/i),
    'https://git.example.com/redis.git',
  );
  await waitFor(() => expect(screen.getByPlaceholderText('redis')).toHaveValue('redis'));
  const submit = screen.getByRole('button', { name: /^Register$/ });
  await waitFor(() => expect(submit).not.toBeDisabled());
  await user.click(submit);
  return { user, submit };
}

describe('a create whose caption write is refused', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  // The service was created. Offering Register again invites a 409 on an id that
  // is already taken — and for an incarnation the same shape would dispatch a
  // second run, which is why the flag is set at every create form, not just here.
  it('does not offer a resubmit that would 409 on the id it just took', async () => {
    const calls = stub(403);
    renderWithProviders(<RegisterServiceModal open onClose={vi.fn()} />, '/services');

    const { submit } = await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/label could not be saved/i));
    expect(submit).toBeDisabled();

    // Exactly one create reached the server, and it is not retried.
    expect(calls.filter((c) => c.method === 'POST' && c.url === '/v1/services')).toHaveLength(1);
  });

  it('the create body carries no label — the keeper would drop it', async () => {
    const calls = stub(403);
    renderWithProviders(<RegisterServiceModal open onClose={vi.fn()} />, '/services');
    await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const post = calls.find((c) => c.method === 'POST' && c.url === '/v1/services');
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(post!.body), 'label')).toBe(false);
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/v1/services/redis/label')).toBe(true);
  });
});

// The wide-write skip in HeraldModal/TidingModal compares two bodies built by
// different code paths. Raw JSON.stringify is key-order sensitive, so it reported
// "different" for identical payloads and the skip never fired.
describe('canonicalJson', () => {
  it('two identical payloads compare equal whatever order their keys were built in', () => {
    const fromForm = { type: 'webhook', config: { url: 'u', headers: { b: '2', a: '1' } }, enabled: true };
    const fromRecord = { enabled: true, config: { headers: { a: '1', b: '2' }, url: 'u' }, type: 'webhook' };
    expect(canonicalJson(fromForm)).toBe(canonicalJson(fromRecord));
    expect(JSON.stringify(fromForm)).not.toBe(JSON.stringify(fromRecord));
  });

  // Arrays are ordered data the operator can reorder; treating a reorder as a
  // no-op would discard a real edit.
  it('array order still counts as a difference', () => {
    expect(canonicalJson({ event_types: ['a', 'b'] })).not.toBe(canonicalJson({ event_types: ['b', 'a'] }));
  });

  it('an undefined member and an absent one are the same request', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('a changed value is still a difference', () => {
    expect(canonicalJson({ config: { url: 'a' } })).not.toBe(canonicalJson({ config: { url: 'b' } }));
  });
});
