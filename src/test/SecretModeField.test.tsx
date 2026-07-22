/**
 * Guard test for the dual-mode secret XOR invariant (ADR-064, NIM-11):
 *   - pickSecretField NEVER returns both fields — only the active mode's.
 *   - SecretModeField renders exactly one input (value XOR path) — XOR
 *     is structurally guaranteed by the toggle, both fields are never available at once.
 */
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pickSecretField, type SecretMode } from '../components/input/secretMode';
import { SecretModeField } from '../components/input/SecretModeField';

describe('pickSecretField — XOR guard', () => {
  it('mode=value → returns only the value field (never ref)', () => {
    const picked = pickSecretField('value', 'plaintext-secret', 'vault:secret/x');
    expect(picked).toEqual({ kind: 'value', value: 'plaintext-secret' });
  });

  it('mode=ref → returns only the ref field (never value)', () => {
    const picked = pickSecretField('ref', 'plaintext-secret', 'vault:secret/x');
    expect(picked).toEqual({ kind: 'ref', value: 'vault:secret/x' });
  });

  it('active input is empty (after trim) → null (field is not sent)', () => {
    expect(pickSecretField('value', '   ', 'vault:secret/x')).toBeNull();
    expect(pickSecretField('ref', 'plaintext', '  ')).toBeNull();
  });

  it('never returns both fields: for any mode kind matches the mode', () => {
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
      valueModeLabel="Value"
      refModeLabel="Path"
      value={value}
      onValueChange={setValue}
      refValue={ref}
      onRefChange={setRef}
      refType="password"
    />
  );
}

describe('SecretModeField — dual-mode switching (XOR structural)', () => {
  it('default=ref: only the ref input is visible, no value input', () => {
    render(<Harness />);
    expect(screen.getByTestId('sf-ref')).toBeInTheDocument();
    expect(screen.queryByTestId('sf-value')).not.toBeInTheDocument();
  });

  it('switching to "value" shows the value input and removes the ref input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('sf-mode-value'));
    expect(screen.getByTestId('sf-value')).toBeInTheDocument();
    expect(screen.queryByTestId('sf-ref')).not.toBeInTheDocument();
  });

  it('value input is masked (type=password) — the secret is not visible on screen', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('sf-mode-value'));
    expect(screen.getByTestId('sf-value')).toHaveAttribute('type', 'password');
  });

  it('aria-checked reflects the active mode', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByTestId('sf-mode-ref')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sf-mode-value')).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByTestId('sf-mode-value'));
    expect(screen.getByTestId('sf-mode-value')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sf-mode-ref')).toHaveAttribute('aria-checked', 'false');
  });
});
