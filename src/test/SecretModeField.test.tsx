/**
 * Guard-тест XOR-инварианта dual-mode секрета (ADR-064, NIM-11):
 *   - pickSecretField НИКОГДА не возвращает оба поля — только активного режима.
 *   - SecretModeField рендерит ровно один инпут (значение XOR путь) — XOR
 *     структурно гарантирован переключателем, оба поля одновременно недоступны.
 */
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pickSecretField, type SecretMode } from '../components/input/secretMode';
import { SecretModeField } from '../components/input/SecretModeField';

describe('pickSecretField — XOR guard', () => {
  it('mode=value → возвращает только value-поле (никогда ref)', () => {
    const picked = pickSecretField('value', 'plaintext-secret', 'vault:secret/x');
    expect(picked).toEqual({ kind: 'value', value: 'plaintext-secret' });
  });

  it('mode=ref → возвращает только ref-поле (никогда value)', () => {
    const picked = pickSecretField('ref', 'plaintext-secret', 'vault:secret/x');
    expect(picked).toEqual({ kind: 'ref', value: 'vault:secret/x' });
  });

  it('активный ввод пуст (после trim) → null (поле не отправляется)', () => {
    expect(pickSecretField('value', '   ', 'vault:secret/x')).toBeNull();
    expect(pickSecretField('ref', 'plaintext', '  ')).toBeNull();
  });

  it('никогда не отдаёт оба поля: для любого режима kind соответствует режиму', () => {
    const modes: SecretMode[] = ['value', 'ref'];
    for (const m of modes) {
      const picked = pickSecretField(m, 'v', 'r');
      expect(picked).not.toBeNull();
      expect(picked!.kind).toBe(m);
    }
  });
});

function Harness() {
  const [mode, setMode] = useState<SecretMode>('ref');
  const [value, setValue] = useState('');
  const [ref, setRef] = useState('');
  return (
    <SecretModeField
      label="Secret"
      mode={mode}
      onModeChange={setMode}
      testIdBase="sf"
      valueModeLabel="Значение"
      refModeLabel="Путь"
      value={value}
      onValueChange={setValue}
      refValue={ref}
      onRefChange={setRef}
      refType="password"
    />
  );
}

describe('SecretModeField — dual-mode переключение (XOR структурно)', () => {
  it('default=ref: виден только ref-инпут, value-инпута нет', () => {
    render(<Harness />);
    expect(screen.getByTestId('sf-ref')).toBeInTheDocument();
    expect(screen.queryByTestId('sf-value')).not.toBeInTheDocument();
  });

  it('переключение на «значение» показывает value-инпут и убирает ref-инпут', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('sf-mode-value'));
    expect(screen.getByTestId('sf-value')).toBeInTheDocument();
    expect(screen.queryByTestId('sf-ref')).not.toBeInTheDocument();
  });

  it('value-инпут маскируется (type=password) — секрет не виден на экране', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('sf-mode-value'));
    expect(screen.getByTestId('sf-value')).toHaveAttribute('type', 'password');
  });

  it('aria-checked отражает активный режим', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByTestId('sf-mode-ref')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sf-mode-value')).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByTestId('sf-mode-value'));
    expect(screen.getByTestId('sf-mode-value')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sf-mode-ref')).toHaveAttribute('aria-checked', 'false');
  });
});
