import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { installFetchMock } from './fetchMock';
import { PermissionsEditor } from '../pages/rbac/PermissionsEditor';
import type { PermissionResource } from '../api/keeper';

// Controlled-обёртка: value обновляется по onChange (для проверок, где нужен
// re-render с новым набором — снятие wildcard, накопление дублей).
function Controlled({ initial, catalog }: { initial: string[]; catalog: PermissionResource[] }) {
  const [v, setV] = useState<string[]>(initial);
  return <PermissionsEditor value={v} onChange={setV} catalog={catalog} />;
}

// Каталог-фикстура (не хардкод прод-каталога — тестовый набор).
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

// Autocomplete-эндпоинты scope-пикеров — пустые (не роняем queries).
function mockScopeEndpoints() {
  installFetchMock([
    { method: 'GET', url: '/v1/incarnations', body: { items: [], offset: 0, limit: 200, total: 0 } },
    { method: 'GET', url: '/v1/services', body: { items: [] } },
    { method: 'GET', url: '/v1/souls', body: { items: [], offset: 0, limit: 500, total: 0 } },
  ]);
}

describe('PermissionsEditor — action-wildcard (NIM-79)', () => {
  beforeEach(() => mockScopeEndpoints());

  it('клик «Все действия» на incarnation → onChange(["incarnation.*"]), не перечисление', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={[]} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();

    const wildcard = screen.getByRole('checkbox', { name: /incarnation\.\*/ });
    await user.click(wildcard);

    expect(onChange).toHaveBeenLastCalledWith(['incarnation.*']);
    // Именно wildcard, а не 3 строки действий.
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toHaveLength(1);
  });

  it('роль с "incarnation.*" → wildcard-чекбокс checked, НЕ read-only preserved-чип', () => {
    renderWithProviders(
      <PermissionsEditor value={['incarnation.*']} onChange={vi.fn()} catalog={CATALOG} />,
    );
    const wildcard = screen.getByRole('checkbox', { name: /incarnation\.\*/ }) as HTMLInputElement;
    expect(wildcard).toBeChecked();
    // Preserved-секция (права вне каталога) не должна упоминать incarnation.*.
    expect(screen.queryByText(/Права вне каталога/i)).not.toBeInTheDocument();
  });

  it('при включённом wildcard индивидуальные чекбоксы группы disabled (глушатся)', () => {
    renderWithProviders(
      <PermissionsEditor value={['incarnation.*']} onChange={vi.fn()} catalog={CATALOG} />,
    );
    expect(screen.getByRole('checkbox', { name: 'incarnation.read' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'incarnation.destroy' })).toBeDisabled();
    // Соседняя группа (service) не затронута.
    expect(screen.getByRole('checkbox', { name: 'service.list' })).not.toBeDisabled();
  });

  it('scope на wildcard: incarnation.* + service=redis → "incarnation.* on service=redis"', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor value={['incarnation.*']} onChange={onChange} catalog={CATALOG} />,
    );
    const user = userEvent.setup();

    // Scope-пикер под wildcard использует union selector_keys ресурса = ['service'].
    const keySelect = screen.getByRole('combobox', { name: /^ключ селектора scope$/i });
    await user.selectOptions(keySelect, 'service');
    const valueInput = screen.getByRole('textbox', { name: /значение service$/i });
    await user.type(valueInput, 'redis');

    expect(onChange).toHaveBeenLastCalledWith(['incarnation.* on service=redis']);
  });

  it('full "*" остаётся read-only preserved-чипом (не превращается в галку)', () => {
    renderWithProviders(<PermissionsEditor value={['*']} onChange={vi.fn()} catalog={CATALOG} />);
    expect(screen.getByText(/Права вне каталога/i)).toBeInTheDocument();
    // Нет чекбокса с именем ровно "*".
    expect(screen.queryByRole('checkbox', { name: '*' })).not.toBeInTheDocument();
  });
});

describe('PermissionsEditor — bulk-scope (NIM-79)', () => {
  beforeEach(() => mockScopeEndpoints());

  it('bulk-apply: 2 отмеченных права → общий scope coven=ops применяется ко всем', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor value={['soul.list', 'soul.read']} onChange={onChange} catalog={SOUL_CATALOG} />,
    );
    const user = userEvent.setup();

    // Bulk-bar появляется при ≥2 отмеченных и непустых selector_keys.
    const bulkKey = screen.getByRole('combobox', { name: /ключ селектора scope для отмеченных/i });
    await user.selectOptions(bulkKey, 'coven');
    const bulkValue = screen.getByRole('textbox', { name: /значение coven для отмеченных/i });
    await user.type(bulkValue, 'ops');
    await user.click(screen.getByRole('button', { name: /Применить/i }));

    expect(onChange).toHaveBeenLastCalledWith(['soul.list on coven=ops', 'soul.read on coven=ops']);
  });

  it('bulk-bar скрыт при <2 отмеченных прав', () => {
    renderWithProviders(
      <PermissionsEditor value={['soul.list']} onChange={vi.fn()} catalog={SOUL_CATALOG} />,
    );
    expect(
      screen.queryByRole('combobox', { name: /ключ селектора scope для отмеченных/i }),
    ).not.toBeInTheDocument();
  });

  it('bulk-clear: сбрасывает scope у отмеченных прав группы', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor
        value={['soul.list on coven=ops', 'soul.read on coven=ops']}
        onChange={onChange}
        catalog={SOUL_CATALOG}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Сбросить/i }));
    expect(onChange).toHaveBeenLastCalledWith(['soul.list', 'soul.read']);
  });
});

describe('PermissionsEditor — совместимость с обычными действиями', () => {
  beforeEach(() => mockScopeEndpoints());

  it('обычный чекбокс действия по-прежнему даёт голое право', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={[]} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();

    const grp = screen.getByRole('checkbox', { name: 'service.read' });
    await user.click(grp);
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toContain('service.read');
    expect(within(document.body).queryByText(' on ')).not.toBeInTheDocument();
  });
});

// Разнородные selector_keys внутри группы: action-a поддерживает coven, action-b — sid.
const HETERO_CATALOG: PermissionResource[] = [
  {
    resource: 'thing',
    actions: [
      { action: 'alpha', selector_keys: ['coven'] },
      { action: 'beta', selector_keys: ['sid'] },
    ],
  },
];

describe('PermissionsEditor — регрессы review (NIM-79)', () => {
  beforeEach(() => mockScopeEndpoints());

  it('#1: роль с "*" + клик действия каталога → "*" эмитится ОДИН раз (не дублируется)', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionsEditor value={['*']} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg.filter((p) => p === '*')).toHaveLength(1);
    expect(arg).toContain('service.read');
  });

  it('#1: накопление дублей `*` не происходит при повторных правках (controlled)', async () => {
    renderWithProviders(<Controlled initial={['*']} catalog={CATALOG} />);
    const user = userEvent.setup();
    // Три toggle подряд — `*` не должен размножаться в preserved-чипах.
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    await user.click(screen.getByRole('checkbox', { name: 'service.list' }));
    // Единственный preserved-чип `*` (текст ровно "*" в mono-чипе).
    const stars = screen.getAllByText('*');
    expect(stars).toHaveLength(1);
  });

  it('#2: два scoped-wildcard одной базы round-trip через preserved (не теряются)', async () => {
    const onChange = vi.fn();
    const dup = ['incarnation.* on service=redis', 'incarnation.* on coven=ops'];
    renderWithProviders(<PermissionsEditor value={dup} onChange={onChange} catalog={CATALOG} />);
    const user = userEvent.setup();
    // Дубль базы → не адаптирован: wildcard-чекбокс НЕ отмечен, оба в preserved.
    expect(screen.getByText(/Права вне каталога/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /incarnation\.\*/ })).not.toBeChecked();
    // Тронуть несвязанное право — оба scoped-wildcard сохраняются (replace-safe).
    await user.click(screen.getByRole('checkbox', { name: 'service.read' }));
    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toContain('incarnation.* on service=redis');
    expect(arg).toContain('incarnation.* on coven=ops');
    expect(arg).toContain('service.read');
  });

  it('#8: снятие wildcard снова включает индивидуальные чекбоксы группы (controlled)', async () => {
    renderWithProviders(<Controlled initial={['incarnation.*']} catalog={CATALOG} />);
    const user = userEvent.setup();
    expect(screen.getByRole('checkbox', { name: 'incarnation.read' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /incarnation\.\*/ }));
    expect(screen.getByRole('checkbox', { name: 'incarnation.read' })).not.toBeDisabled();
  });

  it('#8: bulk применяет ключ только к поддерживающим его действиям (разнородные selector_keys)', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PermissionsEditor value={['thing.alpha', 'thing.beta']} onChange={onChange} catalog={HETERO_CATALOG} />,
    );
    const user = userEvent.setup();
    // union = ['coven','sid']; 'coven' поддерживает только thing.alpha.
    const bulkKey = screen.getByRole('combobox', { name: /ключ селектора scope для отмеченных/i });
    await user.selectOptions(bulkKey, 'coven');
    const bulkValue = screen.getByRole('textbox', { name: /значение coven для отмеченных/i });
    await user.type(bulkValue, 'ops');
    await user.click(screen.getByRole('button', { name: /Применить/i }));

    const arg = onChange.mock.lastCall?.[0] as string[];
    expect(arg).toContain('thing.alpha on coven=ops'); // применилось
    expect(arg).toContain('thing.beta');               // пропущено — осталось голым
    expect(arg.some((p) => p.startsWith('thing.beta on'))).toBe(false);
  });
});
