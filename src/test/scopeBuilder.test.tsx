import { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock } from './fetchMock';
import { ScopeBuilder } from '../pages/rbac/ScopeBuilder';
import { pruneScope } from '../pages/rbac/scopeBuilderModel';
import { serializeScope, type ScopeNode } from '../pages/rbac/scopeExpr';
import { buildPermission } from '../pages/rbac/permissions';

// Autocomplete endpoints are empty (we don't assert on options, just don't want a
// dangling fetch); the builder works without them.
function mockEndpoints() {
  installFetchMock([
    { method: 'GET', url: '/v1/incarnations', body: { items: [], offset: 0, limit: 200, total: 0 } },
    { method: 'GET', url: '/v1/services', body: { items: [] } },
    { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 500, total: 0 } },
  ]);
}

// Controlled harness — ScopeBuilder is controlled, so we hold the node and echo it
// to a spy for the wire-string assertions.
function Harness({ onNode }: { onNode: (n: ScopeNode | null) => void }) {
  const [v, setV] = useState<ScopeNode | null>(null);
  return (
    <ScopeBuilder
      value={v}
      ariaLabel="scope"
      onChange={(n) => {
        setV(n);
        onNode(n);
      }}
    />
  );
}

// canonical wire string of the last emitted node (pruned, as the editor serializes it).
function wire(spy: ReturnType<typeof vi.fn>): string {
  const last = spy.mock.lastCall?.[0] as ScopeNode | null;
  return serializeScope(pruneScope(last));
}

describe('ScopeBuilder (NIM-128)', () => {
  beforeEach(() => mockEndpoints());

  it('starts unrestricted — mode toggle on "No restriction", no preview', () => {
    renderWithProviders(<Harness onNode={vi.fn()} />);
    expect(screen.getByTestId('scope-mode-off')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-mode-on')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('scope-preview-code')).not.toBeInTheDocument();
  });

  it('switch to conditions + add a coven value → "coven=ops"', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('scope-mode-on'));
    // Fresh group with one empty coven condition → nothing on the wire yet.
    expect(wire(onNode)).toBe('');
    expect(screen.getByTestId('scope-preview-empty')).toBeInTheDocument();

    await user.type(screen.getByTestId('scope-add-value'), 'ops{Enter}');
    expect(wire(onNode)).toBe('coven=ops');

    // A second value → set form.
    await user.type(screen.getByTestId('scope-add-value'), 'dba{Enter}');
    expect(wire(onNode)).toBe('coven in (ops, dba)');
  });

  it('two conditions with ALL·AND then ANY·OR toggle', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('scope-mode-on'));
    await user.type(screen.getByTestId('scope-add-value'), 'ops{Enter}');
    await user.click(screen.getByTestId('scope-add-cond'));

    // Second condition → host / matches glob.
    await user.selectOptions(screen.getAllByTestId('scope-dim')[1], 'host');
    await user.selectOptions(screen.getByTestId('scope-host-mode'), 'matches');
    await user.type(screen.getByTestId('scope-glob'), 'redis-*');
    expect(wire(onNode)).toBe('coven=ops AND host matches redis-*');

    // Flip the group joiner to ANY · OR.
    await user.click(screen.getByTestId('scope-seg-any'));
    expect(wire(onNode)).toBe('coven=ops OR host matches redis-*');
  });

  it('nested group of traits → "coven=ops AND (trait.owner=dba OR trait.owner=platform)"', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('scope-mode-on'));
    await user.type(screen.getByTestId('scope-add-value'), 'ops{Enter}');

    // Add a nested group (defaults to OR) with one condition; make it trait.owner=dba.
    await user.click(screen.getByTestId('scope-add-group'));
    await user.selectOptions(screen.getAllByTestId('scope-dim')[1], 'trait');
    await user.type(screen.getByTestId('scope-trait-key'), 'owner');
    await user.type(screen.getByTestId('scope-trait-value'), 'dba');

    // Second condition inside the nested group → trait.owner=platform.
    // (the nested group's "+ Condition" precedes the root's in DOM order → index 0)
    await user.click(screen.getAllByTestId('scope-add-cond')[0]);
    await user.selectOptions(screen.getAllByTestId('scope-dim')[2], 'trait');
    await user.type(screen.getAllByTestId('scope-trait-key')[1], 'owner');
    await user.type(screen.getAllByTestId('scope-trait-value')[1], 'platform');

    expect(wire(onNode)).toBe('coven=ops AND (trait.owner=dba OR trait.owner=platform)');
  });

  it('removing a condition collapses back to the remaining one', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('scope-mode-on'));
    await user.type(screen.getByTestId('scope-add-value'), 'ops{Enter}');
    await user.click(screen.getByTestId('scope-add-cond'));
    await user.selectOptions(screen.getAllByTestId('scope-dim')[1], 'service');
    await user.type(screen.getAllByTestId('scope-add-value')[1], 'redis{Enter}');
    expect(wire(onNode)).toBe('coven=ops AND service=redis');

    // Remove the service condition.
    await user.click(screen.getAllByRole('button', { name: 'remove condition' })[1]);
    expect(wire(onNode)).toBe('coven=ops');
  });

  it('the live preview renders the highlighted expression', async () => {
    renderWithProviders(<Harness onNode={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('scope-mode-on'));
    await user.type(screen.getByTestId('scope-add-value'), 'payments{Enter}');
    expect(screen.getByTestId('scope-preview-code')).toHaveTextContent('coven = payments');
  });

  it('serializes into a permission via buildPermission', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('scope-mode-on'));
    await user.type(screen.getByTestId('scope-add-value'), 'ops{Enter}');

    const perm = buildPermission({ base: 'incarnation.run', scope: wire(onNode) || undefined });
    expect(perm).toBe('incarnation.run on coven=ops');
  });

  it('loads an existing tree in conditions mode', () => {
    const existing: ScopeNode = { kind: 'cond', dim: 'coven', match: 'in', values: ['ops'] };
    renderWithProviders(<ScopeBuilder value={existing} onChange={vi.fn()} ariaLabel="scope" />);
    expect(screen.getByTestId('scope-mode-on')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-preview-code')).toHaveTextContent('coven = ops');
  });

  it('incarnation offers the in/matches selector and serializes a glob', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('scope-mode-on'));
    await user.selectOptions(screen.getByTestId('scope-dim'), 'incarnation');
    // Same match-mode selector as host (NIM-128 incarnation-glob).
    await user.selectOptions(screen.getByTestId('scope-host-mode'), 'matches');
    await user.type(screen.getByTestId('scope-glob'), 'web-*');
    expect(wire(onNode)).toBe('incarnation matches web-*');
  });

  it('trait row is a glued key/value group with example placeholders', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('scope-mode-on'));
    await user.selectOptions(screen.getByTestId('scope-dim'), 'trait');

    const key = screen.getByTestId('scope-trait-key');
    const val = screen.getByTestId('scope-trait-value');
    expect(key).toHaveAttribute('placeholder', 'owner');
    expect(val).toHaveAttribute('placeholder', 'dba');

    await user.type(key, 'owner');
    await user.type(val, 'dba');
    expect(wire(onNode)).toBe('trait.owner=dba');
  });

  it('autocomplete does not fetch until the value field is focused (lazy)', async () => {
    const onNode = vi.fn();
    renderWithProviders(<Harness onNode={onNode} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('scope-mode-on'));
    const soulsCalls = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/v1/souls'));

    // Fresh coven condition mounted but the input isn't focused → no catalog fetch.
    expect(soulsCalls()).toHaveLength(0);

    await user.click(screen.getByTestId('scope-add-value'));
    await waitFor(() => expect(soulsCalls().length).toBeGreaterThan(0));
  });

  it('shows the inherited ceiling exprs for the edited base', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/me/permissions',
        body: {
          permissions: [
            { resource: 'incarnation', action: 'run', wildcard: false, scope: { unrestricted: false, exprs: ['coven=payments'] } },
          ],
        },
      },
      { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 500, total: 0 } },
    ]);
    const existing: ScopeNode = { kind: 'cond', dim: 'coven', match: 'in', values: ['payments'] };
    renderWithProviders(<ScopeBuilder value={existing} onChange={vi.fn()} ariaLabel="scope" base="incarnation.run" />);

    const block = await screen.findByTestId('scope-inherited-ceiling');
    expect(block).toHaveTextContent('coven=payments');
  });

  it('reports an unrestricted ceiling', async () => {
    installFetchMock([
      {
        method: 'GET',
        url: '/v1/me/permissions',
        body: { permissions: [{ resource: 'incarnation', action: 'run', wildcard: false, scope: { unrestricted: true } }] },
      },
    ]);
    renderWithProviders(<ScopeBuilder value={null} onChange={vi.fn()} ariaLabel="scope" base="incarnation.run" />);

    const block = await screen.findByTestId('scope-inherited-ceiling');
    expect(block).toHaveTextContent(/unrestricted/i);
  });

  it('hides the ceiling block gracefully when /me/permissions fails', async () => {
    installFetchMock([
      { method: 'GET', url: '/v1/me/permissions', status: 404, body: { title: 'not found' } },
    ]);
    renderWithProviders(<ScopeBuilder value={null} onChange={vi.fn()} ariaLabel="scope" base="incarnation.run" />);

    await waitFor(() =>
      expect(
        (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) =>
          String(c[0]).includes('/v1/me/permissions'),
        ),
      ).toBe(true),
    );
    expect(screen.queryByTestId('scope-inherited-ceiling')).not.toBeInTheDocument();
  });
});
