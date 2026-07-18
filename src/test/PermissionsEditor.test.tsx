import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock } from './fetchMock';
import { PermissionsEditor } from '../pages/rbac/PermissionsEditor';
import type { PermissionResource } from '../api/keeper';

// Controlled wrapper: value is updated via onChange (for checks that need a
// re-render with a new set — clearing a wildcard, accumulating duplicates).
function Controlled({ initial, catalog }: { initial: string[]; catalog: PermissionResource[] }) {
  const [v, setV] = useState<string[]>(initial);
  return <PermissionsEditor value={v} onChange={setV} catalog={catalog} />;
}

// Catalog fixture (not the hardcoded prod catalog — a test set).
// incarnation.* → union selector_keys = ['service']; soul.* → ['coven','sid'].
const CATALOG: PermissionResource[] = [
  {
    resource: 'incarnation',
    actions: [
      { action: 'read', selector_keys: ['service'] },
      { action: 'run', selector_keys: ['service'] },
      { action: 'destroy', selector_keys: ['service'] },
    ],
  },
  {
    resource: 'service',
    actions: [
      { action: 'list', selector_keys: [] },
      { action: 'read', selector_keys: [] },
    ],
  },
];

const SOUL_CATALOG: PermissionResource[] = [
  {
    resource: 'soul',
    actions: [
      { action: 'list', selector_keys: ['coven', 'sid'] },
      { action: 'read', selector_keys: ['coven', 'sid'] },
      { action: 'exec', selector_keys: ['coven', 'sid'] },
    ],
  },
];

// Autocomplete endpoints of the scope pickers — empty (so we don't break queries).
function mockScopeEndpoints() {
  installFetchMock([
    { method: 'GET', url: '/v1/incarnations', body: { items: [], offset: 0, limit: 200, total: 0 } },
    { method: 'GET', url: '/v1/services', body: { items: [] } },
    { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 500, total: 0 } },
  ]);
}

describe('PermissionsEditor — action-wildcard (NIM-79)', () => {
  beforeEach(() => mockScopeEndpoints());

  it('clicking "All actions" on incarnation → onChange(["incarnation.*"]), not an enumeration', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={[]} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();

    const wildcard = screen.getByRole('checkbox', { name: /incarnation\.\*/ });
    await user.click(wildcard);

    expect(onChange).toHaveBeenLastCalledWith(['incarnation.*']);
    // Exactly the wildcard, not 3 action strings.
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toHaveLength(1);
  });

  it('role with "incarnation.*" → wildcard checkbox checked, NOT a read-only preserved chip', () => {
    renderWithProviders(
      <PermissionsEditor value={['incarnation.*']} onChange={vi.fn()} catalog={CATALOG} />,
    );
    const wildcard = screen.getByRole('checkbox', { name: /incarnation\.\*/ }) as HTMLInputElement;
    expect(wildcard).toBeChecked();
    // The preserved section (permissions outside the catalog) must not mention incarnation.*.
    expect(screen.queryByText(/Permissions outside the catalog/i)).not.toBeInTheDocument();
  });

  it('with wildcard enabled the individual actions are hidden (covered incl. future)', async () => {
    renderWithProviders(
      <PermissionsEditor value={['incarnation.*']} onChange={vi.fn()} catalog={CATALOG} />,
    );
    const user = userEvent.setup();
    // incarnation is the active resource; wildcard on → individual actions are hidden.
    expect(screen.queryByRole('checkbox', { name: 'incarnation.read' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'incarnation.destroy' })).not.toBeInTheDocument();
    // The wildcard checkbox itself stays checked.
    expect(screen.getByRole('checkbox', { name: /incarnation\.\*/ })).toBeChecked();
    // Switching to the neighbouring resource shows its actions, enabled.
    await user.click(screen.getByRole('button', { name: 'resource service' }));
    expect(screen.getByRole('checkbox', { name: 'service.list' })).not.toBeDisabled();
  });

  it('scope on wildcard: incarnation.* + service=redis → "incarnation.* on service=redis"', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor value={['incarnation.*']} onChange={onChange} catalog={CATALOG} />,
    );
    const user = userEvent.setup();

    // The scope picker under the wildcard uses the resource union selector_keys = ['service'].
    const keySelect = screen.getByRole('combobox', { name: /^scope selector key$/i });
    await user.selectOptions(keySelect, 'service');
    const valueInput = screen.getByRole('textbox', { name: /value for service$/i });
    await user.type(valueInput, 'redis');

    expect(onChange).toHaveBeenLastCalledWith(['incarnation.* on service=redis']);
  });

  it('full "*" stays a read-only preserved chip (does not turn into a checkbox)', () => {
    renderWithProviders(<PermissionsEditor value={['*']} onChange={vi.fn()} catalog={CATALOG} />);
    expect(screen.getByText(/Permissions outside the catalog/i)).toBeInTheDocument();
    // No checkbox named exactly "*".
    expect(screen.queryByRole('checkbox', { name: '*' })).not.toBeInTheDocument();
  });
});

describe('PermissionsEditor — bulk-scope (NIM-79)', () => {
  beforeEach(() => mockScopeEndpoints());

  it('bulk-apply: 2 checked permissions → shared scope coven=ops applied to all', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor value={['soul.list', 'soul.read']} onChange={onChange} catalog={SOUL_CATALOG} />,
    );
    const user = userEvent.setup();

    // The bulk bar appears with ≥2 checked and non-empty selector_keys.
    const bulkKey = screen.getByRole('combobox', { name: /scope selector key for selected/i });
    await user.selectOptions(bulkKey, 'coven');
    const bulkValue = screen.getByRole('textbox', { name: /value coven for selected/i });
    await user.type(bulkValue, 'ops');
    await user.click(screen.getByRole('button', { name: /Apply/i }));

    expect(onChange).toHaveBeenLastCalledWith(['soul.list on coven=ops', 'soul.read on coven=ops']);
  });

  it('bulk bar is hidden with <2 checked permissions', () => {
    renderWithProviders(
      <PermissionsEditor value={['soul.list']} onChange={vi.fn()} catalog={SOUL_CATALOG} />,
    );
    expect(
      screen.queryByRole('combobox', { name: /scope selector key for selected/i }),
    ).not.toBeInTheDocument();
  });

  it('bulk-clear: resets scope of the checked group permissions', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor
        value={['soul.list on coven=ops', 'soul.read on coven=ops']}
        onChange={onChange}
        catalog={SOUL_CATALOG}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Clear/i }));
    expect(onChange).toHaveBeenLastCalledWith(['soul.list', 'soul.read']);
  });
});

describe('PermissionsEditor — compatibility with plain actions', () => {
  beforeEach(() => mockScopeEndpoints());

  it('a plain action checkbox still yields a bare permission', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={[]} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'resource service' }));
    const grp = screen.getByRole('checkbox', { name: 'service.read' });
    await user.click(grp);
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toContain('service.read');
    expect(within(document.body).queryByText(' on ')).not.toBeInTheDocument();
  });
});

// Heterogeneous selector_keys within a group: action-a supports coven, action-b — sid.
const HETERO_CATALOG: PermissionResource[] = [
  {
    resource: 'thing',
    actions: [
      { action: 'alpha', selector_keys: ['coven'] },
      { action: 'beta', selector_keys: ['sid'] },
    ],
  },
];

describe('PermissionsEditor — review regressions (NIM-79)', () => {
  beforeEach(() => mockScopeEndpoints());

  it('#1: role with "*" + clicking a catalog action → "*" is emitted ONCE (not duplicated)', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={['*']} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'resource service' }));
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg.filter((p) => p === '*')).toHaveLength(1);
    expect(arg).toContain('service.read');
  });

  it('#1: no accumulation of `*` duplicates across repeated edits (controlled)', async () => {
    renderWithProviders(<Controlled initial={['*']} catalog={CATALOG} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'resource service' }));
    // Three toggles in a row — `*` must not multiply in the preserved chips.
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    await user.click(screen.getByRole('checkbox', { name: 'service.list' }));
    // A single preserved `*` chip (text exactly "*" in the mono chip).
    const stars = screen.getAllByText('*');
    expect(stars).toHaveLength(1);
  });

  it('#2: two scoped wildcards of the same base round-trip through preserved (not lost)', async () => {
    const onChange = vi.fn();
    const dup = ['incarnation.* on service=redis', 'incarnation.* on coven=ops'];
    renderWithProviders(<PermissionsEditor value={dup} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();
    // Duplicate base → not adapted: the wildcard checkbox is NOT checked, both go to preserved.
    expect(screen.getByText(/Permissions outside the catalog/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /incarnation\.\*/ })).not.toBeChecked();
    // Touch an unrelated permission — both scoped wildcards are preserved (replace-safe).
    await user.click(screen.getByRole('button', { name: 'resource service' }));
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toContain('incarnation.* on service=redis');
    expect(arg).toContain('incarnation.* on coven=ops');
    expect(arg).toContain('service.read');
  });

  it('#8: clearing the wildcard re-shows the individual actions (controlled)', async () => {
    renderWithProviders(<Controlled initial={['incarnation.*']} catalog={CATALOG} />);
    const user = userEvent.setup();
    expect(screen.queryByRole('checkbox', { name: 'incarnation.read' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /incarnation\.\*/ }));
    expect(screen.getByRole('checkbox', { name: 'incarnation.read' })).not.toBeDisabled();
  });

  it('#8: bulk applies a key only to the actions that support it (heterogeneous selector_keys)', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor value={['thing.alpha', 'thing.beta']} onChange={onChange} catalog={HETERO_CATALOG} />,
    );
    const user = userEvent.setup();
    // union = ['coven','sid']; 'coven' is supported only by thing.alpha.
    const bulkKey = screen.getByRole('combobox', { name: /scope selector key for selected/i });
    await user.selectOptions(bulkKey, 'coven');
    const bulkValue = screen.getByRole('textbox', { name: /value coven for selected/i });
    await user.type(bulkValue, 'ops');
    await user.click(screen.getByRole('button', { name: /Apply/i }));

    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toContain('thing.alpha on coven=ops'); // applied
    expect(arg).toContain('thing.beta');               // skipped — stayed bare
    expect(arg.some((p) => p.startsWith('thing.beta on'))).toBe(false);
  });
});
