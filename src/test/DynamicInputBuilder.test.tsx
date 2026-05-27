import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DynamicInputBuilder } from '../components/input/DynamicInputBuilder';

// Тестовая обёртка с controlled state + последняя версия value на эл-те для
// удобной проверки emit-объекта.
function Harness({
  initial,
  allowRawJsonToggle = true,
}: {
  initial?: Record<string, unknown>;
  allowRawJsonToggle?: boolean;
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initial ?? {});
  return (
    <div>
      <DynamicInputBuilder
        value={value}
        onChange={setValue}
        allowRawJsonToggle={allowRawJsonToggle}
      />
      <pre data-testid="snapshot">{JSON.stringify(value)}</pre>
    </div>
  );
}

function snapshot(): unknown {
  const raw = screen.getByTestId('snapshot').textContent ?? '{}';
  return JSON.parse(raw);
}

describe('DynamicInputBuilder', () => {
  it('TestAddField: добавление строки и ввод key/value emit-ит правильный объект', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // Пустое состояние — кнопка "Add first field".
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    const keyInputs = screen.getAllByRole('textbox', { name: /field key/i });
    expect(keyInputs).toHaveLength(1);

    await user.type(keyInputs[0], 'name');
    const valueInputs = screen.getAllByRole('textbox', { name: /field value/i });
    await user.type(valueInputs[0], 'redis-prod');

    expect(snapshot()).toEqual({ name: 'redis-prod' });
  });

  it('TestDeleteField: удаление строки убирает её из объекта', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ a: '1', b: '2' }} />);
    const keyInputs = screen.getAllByRole('textbox', { name: /field key/i });
    expect(keyInputs).toHaveLength(2);

    // Удаляем первую строку.
    const deleteBtns = screen.getAllByRole('button', { name: /delete field/i });
    await user.click(deleteBtns[0]);

    const remaining = screen.getAllByRole('textbox', { name: /field key/i });
    expect(remaining).toHaveLength(1);
    expect(snapshot()).toEqual({ b: '2' });
  });

  it('TestTypeChange: смена string → integer коэрсит value в число', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ port: '6379' }} />);
    const typeSelect = screen.getByRole('combobox', { name: /field type/i });
    await user.selectOptions(typeSelect, 'integer');
    expect(snapshot()).toEqual({ port: 6379 });
  });

  it('TestTypeChange: boolean toggling emit-ит boolean', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    await user.type(screen.getByRole('textbox', { name: /field key/i }), 'enabled');
    await user.selectOptions(screen.getByRole('combobox', { name: /field type/i }), 'boolean');
    // После смены типа value-input стал checkbox.
    const checkbox = screen.getByRole('checkbox', { name: /field value/i });
    await user.click(checkbox);
    expect(snapshot()).toEqual({ enabled: true });
  });

  it('TestRawJsonToggle: переключение в raw + редактирование + обратно конвертирует структуру', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ greeting: 'hello' }} />);

    // Переключаемся в raw.
    await user.click(screen.getByRole('button', { name: /raw JSON/i }));
    const rawArea = screen.getByRole('textbox', { name: /Raw JSON input/i });
    expect((rawArea as HTMLTextAreaElement).value).toContain('"greeting"');

    // Заменяем содержимое целиком на новое.
    await user.clear(rawArea);
    // userEvent.type интерпретирует { как special, поэтому подменяем через fireEvent.
    fireEvent.change(rawArea, { target: { value: '{"a": 1, "b": true}' } });
    expect(snapshot()).toEqual({ a: 1, b: true });

    // Обратно в form-режим.
    await user.click(screen.getByRole('button', { name: /^form/i }));
    const keyInputs = screen.getAllByRole('textbox', { name: /field key/i });
    expect(keyInputs).toHaveLength(2);
    // a — integer, b — boolean (определяется по типу в parseRawJsonToFields).
    const types = screen.getAllByRole('combobox', { name: /field type/i });
    expect((types[0] as HTMLSelectElement).value).toBe('integer');
    expect((types[1] as HTMLSelectElement).value).toBe('boolean');
  });

  it('TestRawJsonInvalid: невалидный JSON показывает inline-ошибку и не дёргает onChange', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ x: 1 }} />);
    await user.click(screen.getByRole('button', { name: /raw JSON/i }));
    const rawArea = screen.getByRole('textbox', { name: /Raw JSON input/i });
    fireEvent.change(rawArea, { target: { value: '{ broken' } });
    expect(screen.getByText(/JSON:/i)).toBeInTheDocument();
    // value не должен измениться.
    expect(snapshot()).toEqual({ x: 1 });
  });

  it('TestSubmit: финальный объект собирается из всех валидных строк, дубликаты не emit-ятся', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ host: 'example.com', port: 443 }} />);

    // Преконфигурация — типы определились по значениям (port → integer).
    expect(snapshot()).toEqual({ host: 'example.com', port: 443 });

    // Добавляем третью строку с тем же ключом `host` — дубликат → не emit-ится,
    // прежний валидный объект сохраняется.
    await user.click(screen.getByRole('button', { name: /^Add field$/i }));
    const keys = screen.getAllByRole('textbox', { name: /field key/i });
    // Через fireEvent — атомарно, без промежуточных «hos» / «ho» состояний.
    fireEvent.change(keys[2], { target: { value: 'host' } });

    expect(screen.getAllByText(/дубликат ключа/i).length).toBeGreaterThan(0);
    expect(snapshot()).toEqual({ host: 'example.com', port: 443 });
  });

  it('TestHideRawToggle: allowRawJsonToggle=false скрывает кнопку режима', () => {
    render(<Harness allowRawJsonToggle={false} />);
    expect(screen.queryByRole('button', { name: /raw JSON/i })).toBeNull();
  });

  it('Preview показывает JSON, когда есть валидные строки', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    await user.type(screen.getByRole('textbox', { name: /field key/i }), 'k');
    await user.type(screen.getByRole('textbox', { name: /field value/i }), 'v');
    const preview = screen.getByLabelText('JSON preview');
    expect(within(preview).getByText(/"k": "v"/)).toBeInTheDocument();
  });
});
