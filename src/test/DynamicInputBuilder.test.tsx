import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DynamicInputBuilder } from '../components/input/DynamicInputBuilder';

// Test wrapper with controlled state + the latest value on an element for
// convenient checking of the emitted object.
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
  it('TestAddField: adding a row and typing key/value emits the correct object', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // Empty state - "Add first field" button.
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    const keyInputs = screen.getAllByRole('textbox', { name: /field key/i });
    expect(keyInputs).toHaveLength(1);

    await user.type(keyInputs[0], 'name');
    const valueInputs = screen.getAllByRole('textbox', { name: /field value/i });
    await user.type(valueInputs[0], 'redis-prod');

    expect(snapshot()).toEqual({ name: 'redis-prod' });
  });

  it('TestDeleteField: deleting a row removes it from the object', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ a: '1', b: '2' }} />);
    const keyInputs = screen.getAllByRole('textbox', { name: /field key/i });
    expect(keyInputs).toHaveLength(2);

    // Delete the first row.
    const deleteBtns = screen.getAllByRole('button', { name: /delete field/i });
    await user.click(deleteBtns[0]);

    const remaining = screen.getAllByRole('textbox', { name: /field key/i });
    expect(remaining).toHaveLength(1);
    expect(snapshot()).toEqual({ b: '2' });
  });

  it('TestTypeChange: switching string → integer coerces the value to a number', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ port: '6379' }} />);
    const typeSelect = screen.getByRole('combobox', { name: /field type/i });
    await user.selectOptions(typeSelect, 'integer');
    expect(snapshot()).toEqual({ port: 6379 });
  });

  it('TestTypeChange: toggling boolean emits a boolean', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    await user.type(screen.getByRole('textbox', { name: /field key/i }), 'enabled');
    await user.selectOptions(screen.getByRole('combobox', { name: /field type/i }), 'boolean');
    // After the type change, the value-input became a checkbox.
    const checkbox = screen.getByRole('checkbox', { name: /field value/i });
    await user.click(checkbox);
    expect(snapshot()).toEqual({ enabled: true });
  });

  it('TestRawJsonToggle: switching to raw + editing + back converts the structure', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ greeting: 'hello' }} />);

    // Switch to raw.
    await user.click(screen.getByRole('button', { name: /raw JSON/i }));
    const rawArea = screen.getByRole('textbox', { name: /Raw JSON input/i });
    expect((rawArea as HTMLTextAreaElement).value).toContain('"greeting"');

    // Replace the whole content with new content.
    await user.clear(rawArea);
    // userEvent.type interprets { as special, so substitute via fireEvent.
    fireEvent.change(rawArea, { target: { value: '{"a": 1, "b": true}' } });
    expect(snapshot()).toEqual({ a: 1, b: true });

    // Back to form mode.
    await user.click(screen.getByRole('button', { name: /^form/i }));
    const keyInputs = screen.getAllByRole('textbox', { name: /field key/i });
    expect(keyInputs).toHaveLength(2);
    // a - integer, b - boolean (determined by type in parseRawJsonToFields).
    const types = screen.getAllByRole('combobox', { name: /field type/i });
    expect((types[0] as HTMLSelectElement).value).toBe('integer');
    expect((types[1] as HTMLSelectElement).value).toBe('boolean');
  });

  it('TestRawJsonInvalid: invalid JSON shows an inline error and does not fire onChange', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ x: 1 }} />);
    await user.click(screen.getByRole('button', { name: /raw JSON/i }));
    const rawArea = screen.getByRole('textbox', { name: /Raw JSON input/i });
    fireEvent.change(rawArea, { target: { value: '{ broken' } });
    expect(screen.getByText(/JSON:/i)).toBeInTheDocument();
    // value should not change.
    expect(snapshot()).toEqual({ x: 1 });
  });

  it('TestSubmit: the final object is assembled from all valid rows, duplicates are not emitted', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ host: 'example.com', port: 443 }} />);

    // Preconfiguration - types are determined by values (port -> integer).
    expect(snapshot()).toEqual({ host: 'example.com', port: 443 });

    // Add a third row with the same key `host` - a duplicate -> not emitted,
    // the previous valid object is preserved.
    await user.click(screen.getByRole('button', { name: /^Add field$/i }));
    const keys = screen.getAllByRole('textbox', { name: /field key/i });
    // Via fireEvent - atomic, without intermediate "hos" / "ho" states.
    fireEvent.change(keys[2], { target: { value: 'host' } });

    expect(screen.getAllByText(/duplicate key/i).length).toBeGreaterThan(0);
    expect(snapshot()).toEqual({ host: 'example.com', port: 443 });
  });

  it('TestHideRawToggle: allowRawJsonToggle=false hides the mode button', () => {
    render(<Harness allowRawJsonToggle={false} />);
    expect(screen.queryByRole('button', { name: /raw JSON/i })).toBeNull();
  });

  it('Preview shows JSON when there are valid rows', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Add first field/i }));
    await user.type(screen.getByRole('textbox', { name: /field key/i }), 'k');
    await user.type(screen.getByRole('textbox', { name: /field value/i }), 'v');
    const preview = screen.getByLabelText('JSON preview');
    expect(within(preview).getByText(/"k": "v"/)).toBeInTheDocument();
  });
});
